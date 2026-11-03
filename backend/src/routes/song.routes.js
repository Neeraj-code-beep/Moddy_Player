const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const multer = require('multer');
const mongoose = require('mongoose');
const ApiError = require('../utils/api-error');
const { getGeminiAudioMimeType, validateAudioDeclaration, validateAudioFile, validateSongMetadata } = require('../utils/audio-validation');
const defaultSongModel = require('../models/song.model');
const defaultFeedbackModel = require('../models/feedback.model');
const defaultFeedbackSessionQuotaModel = require('../models/feedback-session-quota.model');
const defaultFavoriteModel = require('../models/favorite.model');
const playlistModel = require('../models/playlist.model');
const defaultAnalysisJobModel = require('../models/song-analysis-job.model');
const { enqueueSongAnalysis } = require('../service/song-analysis-queue.service');
const { buildUserPreferenceProfile, getRecommendations, validateRecommendationRequest, normalizeIntention } = require('../service/recommendation.service');
const { reserveFeedbackSlot } = require('../service/feedback-quota.service');
const { accessibleSongFilter, publicCatalogFilter } = require('../service/song-access.service');
const { createAuthenticate, createOptionalAuthenticate, requireRole } = require('../middleware/authentication');

const DEFAULT_UPLOAD_LIMIT_BYTES = 25 * 1024 * 1024;
const MAX_UPLOAD_LIMIT_BYTES = 100 * 1024 * 1024;
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_PAGE = 1_000_000;
const MAX_CONCURRENT_UPLOADS = 1;
let activeUploads = 0;
const DEFAULT_IMAGEKIT_RESPONSE_TIMEOUT_MS = 30_000;
const MAX_IMAGEKIT_RESPONSE_TIMEOUT_MS = 120_000;

function getUploadLimitBytes(value = process.env.MAX_UPLOAD_SIZE_BYTES) {
  if (value === undefined || value === '') return DEFAULT_UPLOAD_LIMIT_BYTES;
  if (!/^\d+$/.test(String(value))) throw new Error('MAX_UPLOAD_SIZE_BYTES must be a positive integer.');
  const bytes = Number(value);
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_UPLOAD_LIMIT_BYTES) {
    throw new Error('MAX_UPLOAD_SIZE_BYTES must be between 1 byte and 100 MiB.');
  }
  return bytes;
}

function getImageKitResponseTimeoutMs(value = process.env.IMAGEKIT_UPLOAD_RESPONSE_TIMEOUT_MS) {
  if (value === undefined || value === '') return DEFAULT_IMAGEKIT_RESPONSE_TIMEOUT_MS;
  if (!/^\d+$/.test(String(value))) throw new Error('IMAGEKIT_UPLOAD_RESPONSE_TIMEOUT_MS must be a positive integer.');
  const timeout = Number(value);
  if (!Number.isSafeInteger(timeout) || timeout < 1_000 || timeout > MAX_IMAGEKIT_RESPONSE_TIMEOUT_MS) {
    throw new Error('IMAGEKIT_UPLOAD_RESPONSE_TIMEOUT_MS must be between 1000 and 120000.');
  }
  return timeout;
}

function parsePositiveInteger(value, field, defaultValue, maxValue) {
  if (value === undefined) return defaultValue;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new ApiError(400, 'INVALID_QUERY', `${field} must be a positive integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maxValue) {
    throw new ApiError(400, 'INVALID_QUERY', `${field} must be between 1 and ${maxValue}.`);
  }
  return parsed;
}

function mapMulterError(error) {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return new ApiError(413, 'UPLOAD_TOO_LARGE', 'The audio file exceeds the configured upload size limit.');
  }
  if (error instanceof multer.MulterError) {
    return new ApiError(400, 'INVALID_MULTIPART', 'The multipart upload is invalid or contains unexpected fields.');
  }
  if (error instanceof ApiError) return error;
  return new ApiError(400, 'INVALID_MULTIPART', 'The multipart upload could not be parsed.');
}

function createSongRouter({
  songModel = defaultSongModel,
  feedbackModel = defaultFeedbackModel,
  feedbackSessionQuotaModel = defaultFeedbackSessionQuotaModel,
  favoriteModel = defaultFavoriteModel,
  analysisJobModel = defaultAnalysisJobModel,
  enqueueAnalysis = enqueueSongAnalysis,
  uploadFile: configuredUploadFile,
  deleteFile: configuredDeleteFile,
  uploadLimitBytes = getUploadLimitBytes(),
  imageKitResponseTimeoutMs = getImageKitResponseTimeoutMs(),
  rateLimiters = {},
  onFeedbackDatabaseError,
  userModel,
  authConfigProvider,
} = {}) {
  const uploadFile = configuredUploadFile || ((...args) => require('../service/storage.service')(...args));
  const deleteFile = configuredDeleteFile || ((fileId) => require('../service/storage.service').deleteFile(fileId));
  const router = express.Router();
  const authenticate = userModel && authConfigProvider
    ? createAuthenticate({ userModel, configProvider: authConfigProvider })
    : (req, res, next) => next(new ApiError(503, 'AUTH_UNAVAILABLE', 'Authentication is unavailable.'));
  const optionalAuthenticate = userModel && authConfigProvider
    ? createOptionalAuthenticate({ userModel, configProvider: authConfigProvider })
    : (req, res, next) => next();
  const requireAdmin = requireRole('admin');
  function visibleSongFilter() {
    return publicCatalogFilter();
  }
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: uploadLimitBytes,
      files: 1,
      fields: 6,
      // Busboy signals the limit at the configured count; 8 permits 7 actual parts.
      parts: 8,
      fieldNameSize: 50,
      fieldSize: 1024,
    },
    fileFilter: (req, file, callback) => {
      try {
        validateAudioDeclaration(file);
        callback(null, true);
      } catch (error) {
        callback(error);
      }
    },
  });
  function limitConcurrentUploads(req, res, next) {
    if (activeUploads >= MAX_CONCURRENT_UPLOADS) {
      return next(new ApiError(503, 'UPLOAD_BUSY', 'Another upload is in progress. Please retry shortly.'));
    }

    activeUploads += 1;
    let released = false;
    const releaseSlot = () => {
      if (released) return;
      released = true;
      activeUploads -= 1;
    };
    req.releaseUploadSlot = releaseSlot;
    next();
  }

  function parseUpload(req, res, next) {
    try {
      upload.single('audio')(req, res, (error) => {
        if (error) {
          req.releaseUploadSlot?.();
          return next(mapMulterError(error));
        }
        next();
      });
    } catch (error) {
      req.releaseUploadSlot?.();
      next(mapMulterError(error));
    }
  }

  async function removeUploadedAsset(fileId) {
    if (typeof deleteFile !== 'function' || !fileId) return;
    try {
      await deleteFile(fileId);
    } catch (error) {
      console.error('[songs] ImageKit cleanup failed', { errorName: error?.name || 'Error' });
    }
  }

  router.post('/songs', authenticate, requireAdmin, rateLimiters.upload || ((req, res, next) => next()), limitConcurrentUploads, parseUpload, async (req, res) => {
    try {
      if (req.aborted || res.destroyed) return;
      const metadata = validateSongMetadata(req.body);
      if (!req.file) throw new ApiError(400, 'AUDIO_REQUIRED', 'An audio file in the audio field is required.');
      validateAudioFile(req.file);
      const fingerprint = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
      if (typeof songModel.findOne === 'function') {
        const existing = await songModel.findOne({ uploadedBy: req.auth.userId, uploadSource: 'admin', uploadFingerprint: fingerprint })
          .select('+storageFileId +uploadedBy +ownerId');
        if (existing) {
          const existingResponse = existing.toObject?.() || { ...existing };
          delete existingResponse.storageFileId;
          delete existingResponse.uploadedBy;
          delete existingResponse.ownerId;
          delete existingResponse.uploadedByRole;
          delete existingResponse.uploadFingerprint;
          return res.status(200).json({ message: 'This catalog upload already exists.', song: existingResponse });
        }
      }

      const extension = path.extname(req.file.originalname).toLowerCase();
      const providerFileName = `${crypto.randomUUID()}${extension}`;
      let uploadedAsset;
      let providerTimeout;
      const providerResult = Promise.resolve().then(() => uploadFile(req.file, providerFileName)).then(
        (asset) => ({ type: 'success', asset }),
        (error) => ({ type: 'failure', error }),
      );
      const timeoutResult = new Promise((resolve) => {
        providerTimeout = setTimeout(() => resolve({ type: 'timeout' }), imageKitResponseTimeoutMs);
      });
      const outcome = await Promise.race([providerResult, timeoutResult]);
      if (outcome.type === 'timeout') {
        // The SDK cannot cancel the network call. Keep the slot until it settles,
        // and initiate cleanup for any asset that arrives after the timeout.
        req.deferUploadSlotRelease = true;
        providerResult
          .then((lateResult) => {
            if (lateResult.type === 'success') void removeUploadedAsset(lateResult.asset?.fileId);
          })
          .finally(() => req.releaseUploadSlot?.());
        if (res.destroyed) return;
        throw new ApiError(504, 'AUDIO_STORAGE_TIMEOUT', 'The audio storage provider did not respond in time.');
      }
      clearTimeout(providerTimeout);
      if (outcome.type === 'failure') {
        throw new ApiError(502, 'AUDIO_STORAGE_FAILED', 'The audio file could not be stored.', outcome.error);
      }
      uploadedAsset = outcome.asset;

      if (res.destroyed) {
        await removeUploadedAsset(uploadedAsset?.fileId);
        return;
      }
      if (!uploadedAsset?.fileId || typeof uploadedAsset.url !== 'string' || !uploadedAsset.url.startsWith('https://')) {
        await removeUploadedAsset(uploadedAsset?.fileId);
        throw new ApiError(502, 'AUDIO_STORAGE_FAILED', 'The audio storage provider returned an invalid result.');
      }

      let song;
      try {
        song = await songModel.create({
          ...metadata,
          visibility: 'public',
          audio: uploadedAsset.url,
          audioMimeType: getGeminiAudioMimeType(req.file),
          storageFileId: uploadedAsset.fileId,
          ownerId: req.auth.userId,
          uploadedBy: req.auth.userId,
          uploadedByRole: 'admin',
          uploadSource: 'admin',
          catalogStatus: 'pending',
          uploadFingerprint: fingerprint,
        });
      } catch (error) {
        await removeUploadedAsset(uploadedAsset.fileId);
        if (error?.code === 11000 && typeof songModel.findOne === 'function') {
          const existing = await songModel.findOne({ uploadedBy: req.auth.userId, uploadSource: 'admin', uploadFingerprint: fingerprint })
            .select('+storageFileId +uploadedBy +ownerId');
          if (existing) {
            const existingResponse = existing.toObject?.() || { ...existing };
            delete existingResponse.storageFileId;
            delete existingResponse.uploadedBy;
            delete existingResponse.ownerId;
            delete existingResponse.uploadedByRole;
            delete existingResponse.uploadFingerprint;
            return res.status(200).json({ message: 'This catalog upload already exists.', song: existingResponse });
          }
        }
        throw new ApiError(500, 'SONG_SAVE_FAILED', 'The song could not be saved.', error);
      }

      try {
        const queued = await enqueueAnalysis(song, { songModel, jobModel: analysisJobModel });
        if (queued.queued) {
          song.analysis = { status: 'queued', jobId: queued.job?._id, requestedAt: queued.job?.createdAt || new Date() };
          song.aiSuggestions = { status: 'queued' };
        }
      } catch (error) {
        await songModel.updateOne({ _id: song._id }, { $set: {
          'analysis.status': 'failed', 'analysis.errorCode': 'queue_unavailable',
          'aiSuggestions.status': 'failed',
        } }).catch(() => {});
        song.analysis = { ...song.analysis, status: 'failed', errorCode: 'queue_unavailable' };
        song.aiSuggestions = { ...song.aiSuggestions, status: 'failed' };
        console.error('[songs] Music analysis queue failed', { errorName: error?.name || 'Error', code: /^[a-z0-9_]{1,60}$/.test(String(error?.code || '')) ? error.code : 'analysis_queue_failed' });
      }

      const songResponse = typeof song?.toObject === 'function' ? song.toObject() : { ...song };
      delete songResponse.storageFileId;
      delete songResponse.ownerId;
      delete songResponse.uploadedBy;
      delete songResponse.aiSuggestions;
      delete songResponse.metadataProvenance;
      delete songResponse.uploadedByRole;
      delete songResponse.uploadSource;
      delete songResponse.uploadFingerprint;
      delete songResponse.audioMimeType;
      delete songResponse.analysis;
      delete songResponse.metadataRevision;
      delete songResponse.mediaStatus;
      delete songResponse.mediaDeletedAt;
      res.status(201).json({ message: 'Song created successfully', song: songResponse });
    } finally {
      if (!req.deferUploadSlotRelease) req.releaseUploadSlot?.();
    }
  });

  router.patch('/admin/songs/:id/catalog-status', authenticate, requireAdmin, async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id) || !req.body || Array.isArray(req.body) ||
        Object.keys(req.body).length !== 1 || !['pending', 'approved', 'rejected'].includes(req.body.status)) {
      throw new ApiError(400, 'INVALID_CATALOG_STATUS', 'Provide a valid catalog status.');
    }
    const song = await songModel.findOne({ _id: req.params.id, uploadSource: 'admin', visibility: 'public' });
    if (!song) throw new ApiError(404, 'SONG_NOT_FOUND', 'The song was not found.');
    song.catalogStatus = req.body.status;
    song.reviewedBy = req.auth.userId;
    song.reviewedAt = new Date();
    await song.save();
    if (song.catalogStatus !== 'approved') {
      await favoriteModel.deleteMany({ songId: song._id });
      await playlistModel.updateMany({ songIds: song._id }, { $pull: { songIds: song._id }, $inc: { revision: 1 } });
    }
    res.status(200).json({ song: { id: String(song._id), catalogStatus: song.catalogStatus, reviewedAt: song.reviewedAt } });
  });

  router.get('/songs', optionalAuthenticate, rateLimiters.catalog || ((req, res, next) => next()), async (req, res) => {
    const allowedParameters = new Set(['mood', 'page', 'limit']);
    if (Object.keys(req.query).some((key) => !allowedParameters.has(key))) {
      throw new ApiError(400, 'INVALID_QUERY', 'Only mood, page, and limit query parameters are accepted.');
    }

    let mood;
    if (req.query.mood !== undefined) {
      if (typeof req.query.mood !== 'string') {
        throw new ApiError(400, 'INVALID_QUERY', 'mood must be a single string value.');
      }
      mood = req.query.mood.trim();
      if (mood.length > 40) throw new ApiError(400, 'INVALID_QUERY', 'mood must be 40 characters or fewer.');
    }

    const page = parsePositiveInteger(req.query.page, 'page', DEFAULT_PAGE, MAX_PAGE);
    const limit = parsePositiveInteger(req.query.limit, 'limit', DEFAULT_LIMIT, MAX_LIMIT);
    const visibility = visibleSongFilter(req);
    const filter = mood ? { ...visibility, mood } : visibility;
    const skip = (page - 1) * limit;
    const [songs, total] = await Promise.all([
      songModel.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
      songModel.countDocuments(filter),
    ]);

    res.status(200).json({
      message: 'Songs fetched successfully',
      songs,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  });

  router.post('/recommendations', optionalAuthenticate, rateLimiters.recommendation || ((req, res, next) => next()), async (req, res) => {
    const validation = validateRecommendationRequest(req.body);
    if (validation.error) throw new ApiError(400, 'INVALID_RECOMMENDATION_REQUEST', validation.error);
    const request = validation.value;
    const visibility = visibleSongFilter(req);
    let preferences = null;
    if (req.auth?.userId) {
      const [favorites, feedback] = await Promise.all([
        favoriteModel.find({ userId: req.auth.userId }).select('songId').lean(),
        feedbackModel.find({ userId: req.auth.userId }).select('songId event createdAt').sort({ createdAt: -1 }).limit(100).lean(),
      ]);
      const ids = [...new Set([...favorites.map(({ songId }) => String(songId)), ...feedback.map(({ songId }) => String(songId))])];
      const preferenceSongs = ids.length ? await songModel.find(accessibleSongFilter(req.auth.userId, ids)).select('mood secondaryMoods genre energy tags listeningContexts').lean() : [];
      const songById = new Map(preferenceSongs.map((song) => [String(song._id), song]));
      preferences = buildUserPreferenceProfile({
        favorites: favorites.map(({ songId }) => songById.get(String(songId))).filter(Boolean),
        feedback: feedback.map((event) => ({ ...event, ...(songById.get(String(event.songId)) || {}) })),
      });
    }
    const recommendations = await getRecommendations(songModel, request, visibility, preferences);
    res.status(200).json({
      message: 'Recommendations generated successfully',
      recommendations,
      requestedMood: request.requestedMood,
      normalizedMood: request.mood,
      intention: request.intention,
    });
  });

  router.post('/feedback', optionalAuthenticate, rateLimiters.feedback || ((req, res, next) => next()), async (req, res) => {
    const runFeedbackDatabaseOperation = async (operation, run) => {
      try {
        return await run();
      } catch (error) {
        if (typeof onFeedbackDatabaseError === 'function') onFeedbackDatabaseError(operation, error);
        throw error;
      }
    };
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).some((key) => !['sessionId', 'songId', 'event', 'intention'].includes(key))) {
      throw new ApiError(400, 'INVALID_FEEDBACK', 'Feedback must contain only the supported fields.');
    }
    if (typeof body.sessionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.sessionId)) {
      throw new ApiError(400, 'INVALID_FEEDBACK', 'sessionId must be a valid version 4 UUID.');
    }
    if (typeof body.songId !== 'string' || !mongoose.Types.ObjectId.isValid(body.songId)) {
      throw new ApiError(400, 'INVALID_FEEDBACK', 'songId must be a valid song identifier.');
    }
    if (!['like', 'dislike', 'skip', 'completed'].includes(body.event)) {
      throw new ApiError(400, 'INVALID_FEEDBACK', 'event must be like, dislike, skip, or completed.');
    }
    const intention = normalizeIntention(body.intention);
    if (!intention) throw new ApiError(400, 'INVALID_FEEDBACK', 'intention must be match, cheer_up, calm_down, or surprise.');

    const sessionId = body.sessionId.toLowerCase();
    const songObjectId = new mongoose.Types.ObjectId(body.songId);
    const songVisibility = visibleSongFilter(req);
    const songExists = await runFeedbackDatabaseOperation('songModel.exists', () => songModel.exists({ _id: songObjectId, ...songVisibility }));
    if (!songExists) throw new ApiError(404, 'SONG_NOT_FOUND', 'The song was not found.');
    const quotaExists = await runFeedbackDatabaseOperation('feedbackSessionQuotaModel.exists', () => feedbackSessionQuotaModel.exists({ sessionId }));
    const existingFeedbackCount = quotaExists ? 0 : await runFeedbackDatabaseOperation(
      'feedbackModel.countDocuments',
      () => feedbackModel.countDocuments({ sessionId }),
    );
    const reservation = await runFeedbackDatabaseOperation(
      'feedbackSessionQuotaModel.findOneAndUpdate',
      () => reserveFeedbackSlot(feedbackSessionQuotaModel, sessionId, new Date(), existingFeedbackCount),
    );
    if (!reservation) {
      throw new ApiError(429, 'FEEDBACK_LIMIT_REACHED', 'This listening session has reached its feedback limit.');
    }
    await runFeedbackDatabaseOperation('feedbackModel.create', () => feedbackModel.create({
      sessionId,
      ...(req.auth?.userId ? { userId: new mongoose.Types.ObjectId(req.auth.userId) } : {}),
      songId: songObjectId,
      event: body.event,
      intention,
    }));
    res.status(202).json({ message: 'Feedback recorded.' });
  });

  return router;
}

module.exports = createSongRouter;
module.exports.getUploadLimitBytes = getUploadLimitBytes;
module.exports.getImageKitResponseTimeoutMs = getImageKitResponseTimeoutMs;
