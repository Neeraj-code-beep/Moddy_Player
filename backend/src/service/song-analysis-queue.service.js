const Song = require('../models/song.model');
const SongAnalysisJob = require('../models/song-analysis-job.model');
const { getMusicIntelligenceConfig } = require('../config/music-intelligence');

async function enqueueSongAnalysis(song, {
  songModel = Song,
  jobModel = SongAnalysisJob,
  config = getMusicIntelligenceConfig(),
  requestedBy = song.uploadedBy || song.ownerId || null,
  requestSource = 'upload',
  reprocess = false,
} = {}) {
  if (!config.enabled) return { queued: false, reason: 'not_configured' };
  const songId = song._id;
  const now = new Date();
  const jobData = {
    songId,
    status: 'queued',
    requestedBy,
    requestSource,
    metadataRevision: song.metadataRevision || 0,
    attempts: 0,
    maxAttempts: config.maxAttempts,
    availableAt: now,
    leaseUntil: null,
    workerId: null,
    lastErrorCode: null,
    resultStatus: null,
    provider: config.provider,
    model: config.model,
    startedAt: null,
    completedAt: null,
  };
  let job;
  try {
    job = await jobModel.findOneAndUpdate({ songId }, { $setOnInsert: jobData }, { upsert: true, new: true, setDefaultsOnInsert: true });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    job = await jobModel.findOne({ songId });
  }
  if (!job) throw new Error('analysis_job_persistence_failed');
  if (reprocess && job.status === 'completed') {
    job = await jobModel.findOneAndUpdate({ songId, status: 'completed' }, { $set: jobData }, { new: true })
      || await jobModel.findOne({ songId });
  }
  if (!job) throw new Error('analysis_job_persistence_failed');
  if (job.status === 'queued' || job.status === 'processing') {
    await songModel.updateOne({ _id: songId }, {
      $set: {
        'analysis.status': job.status,
        'analysis.jobId': job._id,
        'analysis.requestedAt': job.createdAt || now,
        'analysis.errorCode': null,
        'aiSuggestions.status': job.status,
      },
    });
  }
  console.info('[music-ai] Job queued', { status: job.status, provider: job.provider });
  return { queued: job.status === 'queued' || job.status === 'processing', job };
}

async function retrySongAnalysis(song, {
  songModel = Song,
  jobModel = SongAnalysisJob,
  config = getMusicIntelligenceConfig(),
  requestedBy,
  requestSource = 'owner_retry',
} = {}) {
  if (!config.enabled) {
    const error = new Error('music_ai_not_configured');
    error.code = 'AI_NOT_CONFIGURED';
    throw error;
  }
  const now = new Date();
  const job = await jobModel.findOneAndUpdate({ songId: song._id, status: 'failed' }, {
    $set: {
      status: 'queued', requestedBy, requestSource, metadataRevision: song.metadataRevision || 0,
      attempts: 0, maxAttempts: config.maxAttempts, availableAt: now, leaseUntil: null,
      workerId: null, lastErrorCode: null, resultStatus: null, provider: config.provider,
      model: config.model, startedAt: null, completedAt: null,
    },
  }, { new: true });
  if (!job) {
    if (song.analysis?.status === 'failed' && song.analysis?.errorCode === 'queue_unavailable') {
      const result = await enqueueSongAnalysis(song, { songModel, jobModel, config, requestedBy, requestSource });
      if (result.queued) return result.job;
    }
    const error = new Error('analysis_job_not_retryable');
    error.code = 'ANALYSIS_NOT_RETRYABLE';
    throw error;
  }
  await songModel.updateOne({ _id: song._id }, {
    $set: {
      'analysis.status': 'queued', 'analysis.jobId': job._id,
      'analysis.requestedAt': now, 'analysis.completedAt': null,
      'analysis.errorCode': null, 'aiSuggestions.status': 'queued',
    },
  });
  console.info('[music-ai] Retry queued', { status: job.status, provider: job.provider });
  return job;
}

module.exports = { enqueueSongAnalysis, retrySongAnalysis };
