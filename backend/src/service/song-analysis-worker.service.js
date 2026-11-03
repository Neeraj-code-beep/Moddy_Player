const crypto = require('node:crypto');
const Song = require('../models/song.model');
const SongAnalysisJob = require('../models/song-analysis-job.model');
const { getMusicIntelligenceConfig } = require('../config/music-intelligence');
const { retrieveSongAudio } = require('./song-audio-asset.service');
const { analyzeAudioWithGemini } = require('./gemini-music-provider.service');

const REVIEWABLE_FIELDS = ['mood', 'secondaryMoods', 'genre', 'subgenres', 'energy', 'listeningContexts', 'instrumentation', 'vocalCharacteristics', 'language', 'tags'];

function errorDetails(error) {
  return {
    code: typeof error?.code === 'string' && /^[a-z0-9_]{1,60}$/.test(error.code) ? error.code : 'analysis_failed',
    retryable: error?.retryable === true,
  };
}

function delayForAttempt(attempt, baseMs, random = Math.random) {
  const exponential = Math.min(baseMs * (2 ** Math.max(0, attempt - 1)), 30 * 60 * 1000);
  return Math.floor(exponential * (0.8 + random() * 0.4));
}

async function claimNextJob({ jobModel = SongAnalysisJob, songModel = Song, config = getMusicIntelligenceConfig(), workerId = crypto.randomUUID(), now = new Date() } = {}) {
  const exhausted = await jobModel.find({ status: 'processing', leaseUntil: { $lte: now }, $expr: { $gte: ['$attempts', '$maxAttempts'] } }).select('songId').lean();
  await jobModel.updateMany({ status: 'processing', leaseUntil: { $lte: now }, $expr: { $gte: ['$attempts', '$maxAttempts'] } }, {
    $set: { status: 'failed', workerId: null, leaseUntil: null, lastErrorCode: 'worker_lease_expired', completedAt: now },
  });
  for (const job of exhausted) {
    await songModel.updateOne({ _id: job.songId }, { $set: { 'analysis.status': 'failed', 'analysis.errorCode': 'worker_lease_expired', 'analysis.completedAt': now, 'aiSuggestions.status': 'failed' } });
  }
  return jobModel.findOneAndUpdate({
    attempts: { $lt: config.maxAttempts },
    $or: [
      { status: 'queued', availableAt: { $lte: now } },
      { status: 'processing', leaseUntil: { $lte: now } },
    ],
  }, {
    $set: { status: 'processing', workerId, leaseUntil: new Date(now.getTime() + config.leaseMs), startedAt: now },
    $inc: { attempts: 1 },
  }, { new: true, sort: { availableAt: 1, createdAt: 1 } });
}

function initialReviewState() {
  return Object.fromEntries(REVIEWABLE_FIELDS.map((field) => [field, { status: 'pending' }]));
}

function mergeGeneratedSuggestions(existingValue, generated) {
  const existing = existingValue?.toObject?.() || existingValue || {};
  const merged = { ...generated, review: { ...initialReviewState() } };
  const oldReview = existing.review?.toObject?.() || existing.review || {};
  for (const field of REVIEWABLE_FIELDS) {
    const decision = oldReview[field]?.toObject?.() || oldReview[field] || {};
    const protectedDecision = ['accepted', 'rejected', 'overridden'].includes(decision.status) || ['user', 'admin'].includes(decision.source);
    if (protectedDecision) {
      if (existing[field] !== undefined) merged[field] = existing[field];
      merged.review[field] = decision;
    }
  }
  return merged;
}

async function processClaimedJob(job, {
  songModel = Song,
  jobModel = SongAnalysisJob,
  config = getMusicIntelligenceConfig(),
  retrieveAudio = retrieveSongAudio,
  analyzeAudio = analyzeAudioWithGemini,
  getDeliveryUrl,
  fetchImpl,
  now = () => new Date(),
  random = Math.random,
} = {}) {
  const song = await songModel.findById(job.songId).select('+storageFileId +uploadedBy +ownerId +analysis +metadataRevision +aiSuggestions').lean();
  if (!song || song.mediaStatus !== 'active' || !song.storageFileId) {
    const unavailableError = new Error('song_unavailable');
    unavailableError.code = 'song_unavailable';
    unavailableError.retryable = false;
    return finishFailure(job, unavailableError, { songModel, jobModel, retryable: false, now: now() });
  }
  if (song.analysis?.status === 'completed' && String(song.analysis?.jobId) === String(job._id)) {
    await jobModel.updateOne({ _id: job._id, status: 'processing', workerId: job.workerId }, { $set: { status: 'completed', resultStatus: 'applied', completedAt: now(), leaseUntil: null, workerId: null } });
    return { status: 'completed', idempotent: true };
  }
  if ((song.metadataRevision || 0) !== job.metadataRevision) {
    const staleError = new Error('metadata_changed_during_analysis');
    staleError.code = 'metadata_changed';
    return finishFailure(job, staleError, { songModel, jobModel, retryable: false, now: now() });
  }
  const started = await songModel.updateOne({ _id: song._id, metadataRevision: job.metadataRevision }, {
    $set: { 'analysis.jobId': job._id, 'analysis.status': 'processing', 'analysis.errorCode': null, 'aiSuggestions.status': 'processing' },
  });
  if (!started.matchedCount) {
    const staleError = new Error('metadata_changed_during_analysis');
    staleError.code = 'metadata_changed';
    return finishFailure(job, staleError, { songModel, jobModel, retryable: false, now: now() });
  }
  try {
    const asset = await retrieveAudio(song, { getDeliveryUrl, fetchImpl, timeoutMs: Math.min(config.timeoutMs, 30_000) });
    const suggestions = await analyzeAudio({ ...asset, config, fetchImpl });
    const generatedAt = now();
    const update = await songModel.updateOne({
      _id: song._id,
      metadataRevision: job.metadataRevision,
      'analysis.jobId': job._id,
    }, {
      $set: {
        aiSuggestions: { ...mergeGeneratedSuggestions(song.aiSuggestions, suggestions), status: 'completed', generatedAt, provider: config.provider, model: config.model },
        'analysis.status': 'completed', 'analysis.completedAt': generatedAt, 'analysis.errorCode': null, 'analysis.model': config.model,
      },
    });
    if (!update.modifiedCount) {
      const staleError = new Error('metadata_changed_during_analysis');
      staleError.code = 'metadata_changed';
      staleError.retryable = false;
      return finishFailure(job, staleError, { songModel, jobModel, retryable: false, now: generatedAt });
    }
    await jobModel.updateOne({ _id: job._id, status: 'processing', workerId: job.workerId }, {
      $set: { status: 'completed', resultStatus: 'applied', completedAt: generatedAt, leaseUntil: null, workerId: null, lastErrorCode: null },
    });
    console.info('[music-ai] Job completed', { attempt: job.attempts, provider: config.provider });
    return { status: 'completed' };
  } catch (error) {
    const details = errorDetails(error);
    return finishFailure(job, error, { songModel, jobModel, retryable: details.retryable, now: now(), config, random });
  }
}

async function finishFailure(job, error, { songModel = Song, jobModel = SongAnalysisJob, retryable = false, now = new Date(), config = getMusicIntelligenceConfig(), random = Math.random } = {}) {
  const details = errorDetails(error);
  const canRetry = retryable && job.attempts < Math.min(job.maxAttempts, config.maxAttempts);
  const nextStatus = canRetry ? 'queued' : 'failed';
  const availableAt = canRetry ? new Date(now.getTime() + delayForAttempt(job.attempts, config.retryBaseMs, random)) : now;
  const update = await jobModel.updateOne({ _id: job._id, status: 'processing', workerId: job.workerId }, {
    $set: {
      status: nextStatus, availableAt, leaseUntil: null, workerId: null,
      lastErrorCode: details.code, ...(canRetry ? {} : { completedAt: now }),
    },
  });
  if (update.modifiedCount) {
    await songModel.updateOne({ _id: job.songId, 'analysis.jobId': job._id }, {
      $set: {
        'analysis.status': nextStatus,
        'analysis.errorCode': canRetry ? null : details.code,
        'analysis.completedAt': canRetry ? null : now,
        'aiSuggestions.status': nextStatus,
      },
    });
    console.warn('[music-ai] Job attempt failed', { code: details.code, attempt: job.attempts, retrying: canRetry });
  }
  return { status: nextStatus, code: details.code, availableAt: canRetry ? availableAt : null };
}

function createAnalysisWorker({ config = getMusicIntelligenceConfig(), jobModel = SongAnalysisJob, songModel = Song, processJob = processClaimedJob, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), workerId = crypto.randomUUID() } = {}) {
  let stopped = false;
  async function runOne() {
    const job = await claimNextJob({ jobModel, songModel, config, workerId });
    if (!job) return false;
    await processJob(job, { config, jobModel, songModel });
    return true;
  }
  async function run() {
    if (!config.enabled) throw new Error('GEMINI_API_KEY is required to run the music analysis worker.');
    console.info('[music-ai] Worker started', { concurrency: config.concurrency });
    const loops = Array.from({ length: config.concurrency }, async () => {
      while (!stopped) {
        try {
          const didWork = await runOne();
          if (!didWork) await sleep(1_000);
        } catch (error) {
          console.error('[music-ai] Worker loop failed', { errorName: error?.name || 'Error' });
          await sleep(1_000);
        }
      }
    });
    await Promise.all(loops);
  }
  return { run, stop() { stopped = true; } };
}

module.exports = { REVIEWABLE_FIELDS, claimNextJob, createAnalysisWorker, delayForAttempt, errorDetails, finishFailure, initialReviewState, mergeGeneratedSuggestions, processClaimedJob };
