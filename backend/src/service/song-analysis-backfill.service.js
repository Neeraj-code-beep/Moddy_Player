const mongoose = require('mongoose');
const path = require('node:path');
const { GEMINI_MIME_TYPES } = require('./song-audio-asset.service');
const { enqueueSongAnalysis } = require('./song-analysis-queue.service');

const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 100;
const MIME_TYPE_BY_EXTENSION = Object.freeze({
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac',
  '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/opus',
  '.m4a': 'audio/m4a', '.mp4': 'audio/m4a', '.aac': 'audio/aac', '.webm': 'audio/webm',
});

function legacyCatalogRecord() {
  return {
    visibility: { $exists: false }, catalogStatus: { $exists: false }, uploadSource: { $exists: false },
    uploadedBy: { $exists: false }, ownerId: { $exists: false },
  };
}

function buildBackfillFilter(afterId) {
  const cursorFilter = afterId ? { _id: { $gt: new mongoose.Types.ObjectId(afterId) } } : { _id: { $exists: true } };
  return {
    $and: [
      { $or: [
        { visibility: 'public', uploadSource: { $in: ['admin', 'legacy'] } },
        legacyCatalogRecord(),
      ] },
      cursorFilter,
    ],
  };
}

function inferAudioMimeType(song) {
  if (typeof song.audioMimeType === 'string') return GEMINI_MIME_TYPES.has(song.audioMimeType) ? song.audioMimeType : null;
  try {
    const pathname = new URL(song.audio).pathname;
    const inferred = MIME_TYPE_BY_EXTENSION[path.extname(pathname).toLowerCase()];
    return GEMINI_MIME_TYPES.has(inferred) ? inferred : null;
  } catch {
    return null;
  }
}

function classifySong(song, job, { reprocess = false } = {}) {
  if (song.visibility !== 'public' && song.visibility !== undefined) return 'not_public';
  if (song.uploadSource === 'user' || song.uploadSource && !['admin', 'legacy'].includes(song.uploadSource)) return 'not_catalog_song';
  if (song.uploadSource === 'admin' && song.catalogStatus !== 'approved') return 'catalog_not_approved';
  if (song.catalogStatus === 'pending' || song.catalogStatus === 'rejected') return 'catalog_not_approved';
  // The catalog access filter treats pre-media-management records with no status
  // as active legacy assets. Keep the backfill eligibility rule consistent.
  if (song.mediaStatus !== undefined && song.mediaStatus !== 'active') return 'media_unavailable';
  if (typeof song.audio !== 'string' || !song.audio.trim() || typeof song.storageFileId !== 'string' || !song.storageFileId.trim()) return 'asset_not_retrievable';
  if (!inferAudioMimeType(song)) return 'audio_format_unsupported';
  if (['queued', 'processing'].includes(job?.status)) return 'job_already_active';
  if (job?.status === 'failed') return 'failed_job_requires_retry';
  const analysisStatus = song.analysis?.status || song.aiSuggestions?.status;
  if ((job?.status === 'completed' || ['completed', 'ready'].includes(analysisStatus)) && !reprocess) return 'already_analyzed';
  return null;
}

function validateBackfillOptions({ afterId = null, limit = DEFAULT_BATCH_SIZE, dryRun = true, reprocess = false } = {}) {
  if (afterId !== null && (typeof afterId !== 'string' || !/^[a-f\d]{24}$/i.test(afterId))) {
    throw new TypeError('afterId must be a valid MongoDB ObjectId.');
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_BATCH_SIZE) {
    throw new TypeError(`limit must be an integer from 1 to ${MAX_BATCH_SIZE}.`);
  }
  if (typeof dryRun !== 'boolean' || typeof reprocess !== 'boolean') {
    throw new TypeError('dryRun and reprocess must be boolean values.');
  }
  return { afterId, limit, dryRun, reprocess };
}

async function runSongAnalysisBackfill({
  songModel,
  jobModel,
  enqueueAnalysis = enqueueSongAnalysis,
  requestedBy,
  afterId = null,
  limit = DEFAULT_BATCH_SIZE,
  dryRun = true,
  reprocess = false,
} = {}) {
  const options = validateBackfillOptions({ afterId, limit, dryRun, reprocess });
  if (!songModel || !jobModel) throw new TypeError('Song and analysis job models are required.');
  const fetched = await songModel.find(buildBackfillFilter(options.afterId))
    .select('_id visibility uploadSource catalogStatus mediaStatus audio +audioMimeType +storageFileId +analysis +aiSuggestions +metadataRevision')
    .sort({ _id: 1 })
    .limit(options.limit + 1)
    .lean();
  const hasMore = fetched.length > options.limit;
  const songs = fetched.slice(0, options.limit);
  const jobRows = songs.length
    ? await jobModel.find({ songId: { $in: songs.map((song) => song._id) } }).select('songId status').lean()
    : [];
  const jobsBySong = new Map(jobRows.map((job) => [String(job.songId), job]));
  const counts = { scanned: songs.length, eligible: 0, wouldQueue: 0, skipped: 0, queued: 0, failed: 0 };
  const skipReasons = {};
  const skip = (reason) => {
    counts.skipped += 1;
    skipReasons[reason] = (skipReasons[reason] || 0) + 1;
  };

  for (const song of songs) {
    const job = jobsBySong.get(String(song._id));
    const reason = classifySong(song, job, options);
    if (reason) {
      skip(reason);
      continue;
    }
    counts.eligible += 1;
    counts.wouldQueue += 1;
    if (options.dryRun) continue;

    const audioMimeType = inferAudioMimeType(song);
    try {
      if (!song.audioMimeType && audioMimeType) {
        const update = await songModel.updateOne({
          _id: song._id,
          $and: [
            { $or: [{ mediaStatus: 'active' }, { mediaStatus: { $exists: false } }] },
            { $or: [
              { visibility: 'public', uploadSource: 'legacy' },
              { visibility: 'public', uploadSource: 'admin', catalogStatus: 'approved' },
              legacyCatalogRecord(),
            ] },
          ],
        }, { $set: { audioMimeType } });
        if (!update.matchedCount) {
          skip('song_changed_during_backfill');
          continue;
        }
        song.audioMimeType = audioMimeType;
      }
      const result = await enqueueAnalysis(song, {
        songModel,
        jobModel,
        requestedBy,
        requestSource: 'admin_backfill',
        reprocess: options.reprocess,
      });
      if (result?.queued) counts.queued += 1;
      else skip(result?.reason === 'not_configured' ? 'provider_not_configured' : 'job_not_queueable');
    } catch (error) {
      counts.failed += 1;
      console.error('[music-ai] Catalog backfill enqueue failed', {
        errorName: error?.name || 'Error',
        code: typeof error?.code === 'string' && /^[a-z0-9_]{1,60}$/i.test(error.code) ? error.code : 'backfill_enqueue_failed',
      });
    }
  }

  const lastSong = songs.at(-1);
  const result = {
    dryRun: options.dryRun,
    reprocess: options.reprocess,
    counts,
    skipReasons,
    nextAfterId: hasMore && lastSong ? String(lastSong._id) : null,
    hasMore,
  };
  console.info('[music-ai] Catalog backfill batch finished', { ...counts, dryRun: options.dryRun, reprocess: options.reprocess });
  return result;
}

module.exports = {
  DEFAULT_BATCH_SIZE,
  MAX_BATCH_SIZE,
  buildBackfillFilter,
  classifySong,
  inferAudioMimeType,
  runSongAnalysisBackfill,
  validateBackfillOptions,
};
