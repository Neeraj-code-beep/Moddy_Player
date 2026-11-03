const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const multer = require('multer');
const mongoose = require('mongoose');
const ApiError = require('../utils/api-error');
const { getGeminiAudioMimeType, validateAudioDeclaration, validateAudioFile, validateSongMetadata } = require('../utils/audio-validation');
const { createAuthenticate, requireRole } = require('../middleware/authentication');
const { ownedPrivateSongFilter, publicCatalogFilter, accessibleSongFilter, adminCatalogFilter } = require('../service/song-access.service');
const Song = require('../models/song.model');
const Favorite = require('../models/favorite.model');
const Playlist = require('../models/playlist.model');
const SongAnalysisJob = require('../models/song-analysis-job.model');
const { enqueueSongAnalysis } = require('../service/song-analysis-queue.service');
const { retrySongAnalysis } = require('../service/song-analysis-queue.service');
const { getMusicIntelligenceConfig } = require('../config/music-intelligence');

const MAX_PLAYLIST_SONGS = 500;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const PRIVATE_DELIVERY_SECONDS = 900;

function ownerId(req) {
  return new mongoose.Types.ObjectId(req.auth.userId);
}

function plain(document) {
  return document?.toObject ? document.toObject() : { ...document };
}

function publicSong(document) {
  const item = plain(document);
  delete item.storageFileId;
  delete item.ownerId;
  delete item.uploadedBy;
  delete item.uploadedByRole;
  delete item.aiSuggestions;
  delete item.metadataProvenance;
  delete item.reviewedBy;
  delete item.reviewedAt;
  delete item.mediaDeletedAt;
  delete item.uploadFingerprint;
  delete item.audioMimeType;
  delete item.analysis;
  delete item.metadataRevision;
  return item;
}

function validateMetadataPatch(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'INVALID_METADATA', 'Provide song metadata.');
  const allowed = new Set(['title', 'artist', 'mood', 'genre', 'energy', 'tags', 'secondaryMoods', 'subgenres', 'listeningContexts', 'instrumentation', 'vocalCharacteristics', 'language']);
  if (!Object.keys(body).length || Object.keys(body).some((key) => !allowed.has(key))) {
    throw new ApiError(400, 'INVALID_METADATA', 'Unsupported song metadata field.');
  }
  const input = { title: 'Current title', artist: 'Current artist', mood: 'happy' };
  for (const field of ['title', 'artist', 'mood', 'genre', 'energy', 'tags']) if (body[field] !== undefined) input[field] = body[field];
  const metadata = validateSongMetadata(input);
  for (const field of ['secondaryMoods', 'subgenres', 'listeningContexts', 'instrumentation']) {
    if (body[field] === undefined) continue;
    const submitted = typeof body[field] === 'string' ? body[field].split(',') : body[field];
    const max = field === 'instrumentation' ? 8 : field === 'secondaryMoods' ? 3 : 5;
    if (!Array.isArray(submitted) || submitted.length > max || submitted.some((value) => typeof value !== 'string' || !value.trim() || value.trim().length > 40)) {
      throw new ApiError(400, 'INVALID_METADATA', `${field} contains an invalid value.`);
    }
    const values = [...new Set(submitted.map((value) => value.trim().toLowerCase().replace(/[\s-]+/g, '_')))];
    if (field === 'secondaryMoods' && values.some((value) => !['angry', 'disgusted', 'fearful', 'happy', 'neutral', 'sad', 'surprised', 'romantic', 'energetic', 'calm', 'nostalgic', 'peaceful', 'motivational', 'melancholic'].includes(value))) throw new ApiError(400, 'INVALID_METADATA', 'secondaryMoods contains an unsupported mood.');
    if (field === 'listeningContexts' && values.some((value) => !['celebration', 'focus', 'late_night', 'relaxing', 'studying', 'travelling', 'workout'].includes(value))) throw new ApiError(400, 'INVALID_METADATA', 'listeningContexts contains an unsupported context.');
    metadata[field] = values;
  }
  if (body.vocalCharacteristics !== undefined) {
    if (!['instrumental', 'lead_vocals', 'group_vocals', 'spoken_word', 'unclear'].includes(body.vocalCharacteristics)) throw new ApiError(400, 'INVALID_METADATA', 'vocalCharacteristics is invalid.');
    metadata.vocalCharacteristics = body.vocalCharacteristics;
  }
  if (body.language !== undefined) {
    if (typeof body.language !== 'string' || body.language.trim().length > 40) throw new ApiError(400, 'INVALID_METADATA', 'language must be 40 characters or fewer.');
    metadata.language = body.language.trim();
  }
  return Object.fromEntries(Object.keys(body).map((key) => [key, metadata[key]]));
}

function validateSuggestionPatch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'INVALID_AI_SUGGESTIONS', 'AI suggestions must be an object.');
  const allowed = new Set(['mood', 'secondaryMoods', 'genre', 'subgenres', 'energy', 'listeningContexts', 'instrumentation', 'vocalCharacteristics', 'tags', 'language']);
  if (!Object.keys(value).length || Object.keys(value).some((key) => !allowed.has(key))) {
    throw new ApiError(400, 'INVALID_AI_SUGGESTIONS', 'Unsupported suggestion field.');
  }
  const limits = { mood: 40, genre: 60, language: 40 };
  for (const [key, max] of Object.entries(limits)) {
    if (value[key] !== undefined && (typeof value[key] !== 'string' || value[key].trim().length > max)) {
      throw new ApiError(400, 'INVALID_AI_SUGGESTIONS', `${key} suggestion is invalid.`);
    }
  }
  if (value.energy !== undefined && !['low', 'medium', 'high'].includes(value.energy)) throw new ApiError(400, 'INVALID_AI_SUGGESTIONS', 'energy suggestion is invalid.');
  const limitsByField = { secondaryMoods: 3, subgenres: 5, listeningContexts: 5, instrumentation: 8, tags: 8 };
  for (const [field, max] of Object.entries(limitsByField)) {
    if (value[field] !== undefined && (!Array.isArray(value[field]) || value[field].length > max || value[field].some((entry) => typeof entry !== 'string' || !entry.trim() || entry.trim().length > 40))) {
      throw new ApiError(400, 'INVALID_AI_SUGGESTIONS', `${field} suggestion is invalid.`);
    }
  }
  if (value.vocalCharacteristics !== undefined && !['instrumental', 'lead_vocals', 'group_vocals', 'spoken_word', 'unclear'].includes(value.vocalCharacteristics)) throw new ApiError(400, 'INVALID_AI_SUGGESTIONS', 'vocalCharacteristics suggestion is invalid.');
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, Array.isArray(entry) ? [...new Set(entry.map((item) => item.trim().toLowerCase().replace(/[\s-]+/g, '_')))] : typeof entry === 'string' ? entry.trim() : entry]));
}

function applySuggestionReview(song, fields, reviewerId, reviewerRole) {
  const allowed = new Set(['mood', 'secondaryMoods', 'genre', 'subgenres', 'energy', 'listeningContexts', 'instrumentation', 'vocalCharacteristics', 'language', 'tags']);
  if (!fields || typeof fields !== 'object' || Array.isArray(fields) || !Object.keys(fields).length || Object.keys(fields).some((field) => !allowed.has(field))) {
    throw new ApiError(400, 'INVALID_METADATA_REVIEW', 'Provide supported metadata fields to accept or reject.');
  }
  const suggestions = song.aiSuggestions?.toObject?.() || song.aiSuggestions;
  if (!suggestions || suggestions.status !== 'completed') throw new ApiError(409, 'ANALYSIS_NOT_READY', 'Completed music suggestions are required for review.');
  const now = new Date();
  const review = { ...(suggestions.review?.toObject?.() || suggestions.review || {}) };
  const provenance = { ...(song.metadataProvenance?.toObject?.() || song.metadataProvenance || {}) };
  const accepted = [];
  for (const [field, decision] of Object.entries(fields)) {
    if (!['accepted', 'rejected'].includes(decision)) throw new ApiError(400, 'INVALID_METADATA_REVIEW', 'Each field decision must be accepted or rejected.');
    const suggestion = suggestions[field];
    if (suggestion === undefined || suggestion === null) throw new ApiError(400, 'INVALID_METADATA_REVIEW', `No ${field} suggestion is available.`);
    review[field] = { source: 'ai', status: decision, reviewedBy: reviewerId, reviewedAt: now };
    if (decision === 'accepted') {
      song[field] = Array.isArray(suggestion) ? [...suggestion] : suggestion;
      provenance[field] = reviewerRole;
      accepted.push(field);
    }
  }
  song.aiSuggestions = { ...suggestions, review };
  song.metadataProvenance = provenance;
  song.metadataRevision = (song.metadataRevision || 0) + 1;
  return { fields: Object.keys(fields), accepted };
}

function safeAnalysis(song) {
  const suggestions = song.aiSuggestions?.toObject?.() || song.aiSuggestions || null;
  return {
    status: song.analysis?.status || suggestions?.status || 'not_configured',
    requestedAt: song.analysis?.requestedAt || null,
    completedAt: song.analysis?.completedAt || null,
    errorCode: song.analysis?.errorCode || null,
    model: song.analysis?.model || suggestions?.model || null,
    suggestions,
  };
}

function createMusicManagementRouter({
  songModel = Song,
  favoriteModel = Favorite,
  playlistModel = Playlist,
  analysisJobModel = SongAnalysisJob,
  enqueueAnalysis = enqueueSongAnalysis,
  userModel,
  authConfigProvider,
  uploadFile: configuredUploadFile,
  deleteFile: configuredDeleteFile,
  getDeliveryUrl: configuredGetDeliveryUrl,
  uploadLimitBytes = MAX_AUDIO_BYTES,
  imageKitResponseTimeoutMs = 30_000,
  rateLimiters = {},
} = {}) {
  const router = express.Router();
  const authenticate = userModel && authConfigProvider
    ? createAuthenticate({ userModel, configProvider: authConfigProvider })
    : (_req, _res, next) => next(new ApiError(503, 'AUTH_UNAVAILABLE', 'Authentication is unavailable.'));
  const requireAdmin = requireRole('admin');
  const uploadFile = configuredUploadFile || ((...args) => require('../service/storage.service')(...args));
  const deleteFile = configuredDeleteFile || ((fileId) => require('../service/storage.service').deleteFile(fileId));
  const getDeliveryUrl = configuredGetDeliveryUrl || ((url) => require('../service/storage.service').getDeliveryUrl(url));
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: uploadLimitBytes, files: 1, fields: 6, parts: 8, fieldNameSize: 50, fieldSize: 1024 },
    fileFilter(_req, file, callback) {
      try { validateAudioDeclaration(file); callback(null, true); } catch (error) { callback(error); }
    },
  });

  async function signedPrivateSong(document) {
    const result = publicSong(document);
    result.audio = document.mediaStatus && document.mediaStatus !== 'active' ? null : await getDeliveryUrl(result.audio, PRIVATE_DELIVERY_SECONDS);
    if (document.aiSuggestions) result.aiSuggestions = {
      ...(document.aiSuggestions.toObject?.() || document.aiSuggestions),
      status: document.aiSuggestions.status || 'not_configured',
    };
    if (document.analysis) result.analysis = {
      status: document.analysis.status || 'not_configured',
      requestedAt: document.analysis.requestedAt,
      completedAt: document.analysis.completedAt,
      errorCode: document.analysis.errorCode,
    };
    if (document.metadataProvenance) result.metadataProvenance = document.metadataProvenance.toObject?.() || document.metadataProvenance;
    return result;
  }

  async function cleanupUploadedAsset(fileId) {
    if (!fileId) return;
    try { await deleteFile(fileId); }
    catch (error) { console.error('[library] ImageKit cleanup failed', { errorName: error?.name || 'Error' }); }
  }

  async function songForViewer(document) {
    return document.visibility === 'private' ? signedPrivateSong(document) : publicSong(document);
  }

  async function uploadPrivateAsset(file, fileName) {
    const providerPromise = Promise.resolve().then(() => uploadFile(file, fileName, { isPrivateFile: true })).then(
      (asset) => ({ type: 'success', asset }),
      (error) => ({ type: 'failure', error }),
    );
    let timer;
    const timeoutPromise = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ type: 'timeout' }), imageKitResponseTimeoutMs);
    });
    const outcome = await Promise.race([providerPromise, timeoutPromise]);
    if (outcome.type === 'timeout') {
      providerPromise.then((late) => {
        if (late.type === 'success' && late.asset?.fileId) {
          void cleanupUploadedAsset(late.asset.fileId);
        }
      });
      throw new ApiError(504, 'AUDIO_STORAGE_TIMEOUT', 'The audio storage provider did not respond in time.');
    }
    clearTimeout(timer);
    if (outcome.type === 'failure') throw new ApiError(502, 'AUDIO_STORAGE_FAILED', 'The audio file could not be stored.', outcome.error);
    return outcome.asset;
  }

  async function getOwnedSong(req, id, { allowDeletionRetry = false } = {}) {
    if (!mongoose.isValidObjectId(id)) throw new ApiError(404, 'SONG_NOT_FOUND', 'The song was not found.');
    const ownership = ownedPrivateSongFilter(req.auth.userId);
    if (allowDeletionRetry) ownership.mediaStatus = { $in: ['active', 'deleting', 'deletion_failed', 'deleted'] };
    const song = await songModel.findOne({ _id: id, ...ownership })
      .select('+storageFileId +mediaDeletedAt +uploadedBy +ownerId +aiSuggestions +metadataProvenance +analysis +metadataRevision');
    if (!song) throw new ApiError(404, 'SONG_NOT_FOUND', 'The song was not found.');
    return song;
  }

  router.get('/songs', authenticate, async (req, res) => {
    const allowed = new Set(['q', 'mood', 'page', 'limit']);
    if (Object.keys(req.query).some((key) => !allowed.has(key))) throw new ApiError(400, 'INVALID_QUERY', 'Unsupported library query parameter.');
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 50);
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new ApiError(400, 'INVALID_QUERY', 'page and limit are outside the supported range.');
    }
    const privateSongs = ownedPrivateSongFilter(req.auth.userId);
    privateSongs.mediaStatus = { $in: ['active', 'deletion_failed'] };
    const filter = { $and: [privateSongs] };
    if (req.query.mood) filter.$and.push({ mood: String(req.query.mood).slice(0, 40) });
    if (req.query.q) {
      const escaped = String(req.query.q).slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$and.push({ $or: [{ title: { $regex: escaped, $options: 'i' } }, { artist: { $regex: escaped, $options: 'i' } }] });
    }
    const [songs, total] = await Promise.all([
      songModel.find(filter).select('+storageFileId +uploadedBy +ownerId +aiSuggestions +metadataProvenance +analysis +metadataRevision').sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      songModel.countDocuments(filter),
    ]);
    res.json({ songs: await Promise.all(songs.map(signedPrivateSong)), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  });

  router.post('/songs', authenticate, rateLimiters.upload || ((_req, _res, next) => next()), upload.single('audio'), async (req, res) => {
    const metadata = validateSongMetadata(req.body);
    if (!req.file) throw new ApiError(400, 'AUDIO_REQUIRED', 'An audio file in the audio field is required.');
    validateAudioFile(req.file);
    const fingerprint = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    if (typeof songModel.findOne === 'function') {
      const existing = await songModel.findOne({ uploadedBy: ownerId(req), uploadSource: 'user', uploadFingerprint: fingerprint, mediaStatus: 'active' })
        .select('+storageFileId +uploadedBy +ownerId +aiSuggestions +metadataProvenance');
      if (existing) return res.status(200).json({ song: await signedPrivateSong(existing) });
    }
    const fileName = `${crypto.randomUUID()}${path.extname(req.file.originalname).toLowerCase()}`;
    let asset;
    try {
      asset = await uploadPrivateAsset(req.file, fileName);
      if (!asset?.fileId || typeof asset.url !== 'string' || !asset.url.startsWith('https://')) {
        throw new ApiError(502, 'AUDIO_STORAGE_FAILED', 'The audio storage provider returned an invalid result.');
      }
      if (req.aborted || res.destroyed) {
        await cleanupUploadedAsset(asset.fileId);
        return;
      }
      const created = await songModel.create({
        ...metadata,
        audio: asset.url,
        audioMimeType: getGeminiAudioMimeType(req.file),
        storageFileId: asset.fileId,
        uploadedBy: ownerId(req),
        ownerId: ownerId(req),
        uploadedByRole: 'user',
        uploadSource: 'user',
        visibility: 'private',
        uploadFingerprint: fingerprint,
        aiSuggestions: { status: 'not_configured' },
        metadataProvenance: Object.fromEntries(['mood', 'genre', 'energy', 'tags'].map((field) => [field, metadata[field] === undefined ? 'legacy' : 'user'])),
      });
      try {
        const queued = await enqueueAnalysis(created, { songModel, jobModel: analysisJobModel });
        if (queued.queued) {
          created.analysis = { status: 'queued', jobId: queued.job?._id, requestedAt: queued.job?.createdAt || new Date() };
          created.aiSuggestions = { status: 'queued' };
        }
      } catch (error) {
        await songModel.updateOne({ _id: created._id }, { $set: {
          'analysis.status': 'failed', 'analysis.errorCode': 'queue_unavailable',
          'aiSuggestions.status': 'failed',
        } }).catch(() => {});
        created.analysis = { ...created.analysis, status: 'failed', errorCode: 'queue_unavailable' };
        created.aiSuggestions = { ...created.aiSuggestions, status: 'failed' };
        console.error('[library] Music analysis queue failed', { errorName: error?.name || 'Error', code: /^[a-z0-9_]{1,60}$/.test(String(error?.code || '')) ? error.code : 'analysis_queue_failed' });
      }
      res.status(201).json({ song: await signedPrivateSong(created) });
    } catch (error) {
      if (asset?.fileId) await cleanupUploadedAsset(asset.fileId);
      if (error?.code === 11000 && typeof songModel.findOne === 'function') {
        const existing = await songModel.findOne({ uploadedBy: ownerId(req), uploadSource: 'user', uploadFingerprint: fingerprint, mediaStatus: 'active' })
          .select('+storageFileId +uploadedBy +ownerId +aiSuggestions +metadataProvenance');
        if (existing) return res.status(200).json({ song: await signedPrivateSong(existing) });
      }
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'SONG_SAVE_FAILED', 'The song could not be saved.', error);
    }
  });

  router.patch('/songs/:id', authenticate, async (req, res) => {
    const song = await getOwnedSong(req, req.params.id);
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).some((key) => !['title', 'artist', 'mood', 'genre', 'energy', 'tags', 'aiSuggestions'].includes(key))) {
      throw new ApiError(400, 'INVALID_METADATA', 'Only song metadata and owner-edited AI suggestions are accepted.');
    }
    const { aiSuggestions, ...metadataBody } = req.body;
    const metadata = Object.keys(metadataBody).length ? validateMetadataPatch(metadataBody) : {};
    const validatedSuggestions = aiSuggestions === undefined ? null : validateSuggestionPatch(aiSuggestions);
    if (!Object.keys(metadata).length && !validatedSuggestions) throw new ApiError(400, 'INVALID_METADATA', 'Provide metadata or AI suggestions to update.');
    Object.assign(song, metadata);
    song.metadataRevision = (song.metadataRevision || 0) + 1;
    song.metadataProvenance = { ...song.metadataProvenance?.toObject?.(), ...Object.fromEntries(Object.keys(metadata).map((field) => [field, 'user'])) };
    if (validatedSuggestions) {
      const existing = song.aiSuggestions?.toObject?.() || song.aiSuggestions || {};
      const review = { ...(existing.review || {}) };
      for (const field of Object.keys(validatedSuggestions)) review[field] = { source: 'user', status: 'overridden', reviewedBy: ownerId(req), reviewedAt: new Date() };
      song.aiSuggestions = { ...existing, ...validatedSuggestions, review, status: existing.status || 'not_configured' };
    }
    await song.save();
    console.info('[music-ai] Metadata manually edited', { role: 'user', fields: Object.keys(metadata).length + Object.keys(validatedSuggestions || {}).length });
    res.json({ song: await signedPrivateSong(song) });
  });

  router.get('/songs/:id/analysis', authenticate, async (req, res) => {
    const song = await getOwnedSong(req, req.params.id);
    res.json({ analysis: safeAnalysis(song) });
  });

  router.post('/songs/:id/analysis/retry', authenticate, rateLimiters.analysis || ((_req, _res, next) => next()), async (req, res) => {
    const song = await getOwnedSong(req, req.params.id);
    try {
      const job = await retrySongAnalysis(song, { songModel, jobModel: analysisJobModel, requestedBy: ownerId(req), requestSource: 'owner_retry' });
      res.status(202).json({ analysis: { status: 'queued', requestedAt: job.availableAt } });
    } catch (error) {
      if (error?.code === 'AI_NOT_CONFIGURED') throw new ApiError(503, 'AI_NOT_CONFIGURED', 'Music analysis is not configured.');
      if (error?.code === 'ANALYSIS_NOT_RETRYABLE') throw new ApiError(409, 'ANALYSIS_NOT_RETRYABLE', 'Only failed analyses can be retried.');
      throw error;
    }
  });

  router.patch('/songs/:id/metadata-review', authenticate, async (req, res) => {
    const song = await getOwnedSong(req, req.params.id);
    if (!req.body || Object.keys(req.body).some((key) => key !== 'fields')) throw new ApiError(400, 'INVALID_METADATA_REVIEW', 'Only per-field review decisions are accepted.');
    const reviewed = applySuggestionReview(song, req.body.fields, ownerId(req), 'user');
    await song.save();
    console.info('[music-ai] Metadata suggestions reviewed', { role: 'user', acceptedFields: reviewed.accepted.length, reviewedFields: reviewed.fields.length });
    res.json({ song: await signedPrivateSong(song), reviewed });
  });

  router.delete('/songs/:id', authenticate, async (req, res) => {
    const song = await getOwnedSong(req, req.params.id, { allowDeletionRetry: true });
    song.mediaStatus = 'deleting';
    await song.save();
    if (!song.mediaDeletedAt) {
      if (!song.storageFileId) {
        song.mediaStatus = 'deletion_failed';
        await song.save();
        throw new ApiError(503, 'MEDIA_CLEANUP_REQUIRED', 'Media cleanup cannot be confirmed; the song is retained for retry.');
      }
      try {
        await deleteFile(song.storageFileId);
      } catch (error) {
        if (error?.statusCode === 404 || error?.status === 404) {
          song.mediaDeletedAt = new Date();
        } else {
          song.mediaStatus = 'deletion_failed';
          await song.save();
          throw new ApiError(502, 'MEDIA_DELETE_FAILED', 'The media could not be deleted. Retry this request later.', error);
        }
      }
      song.mediaDeletedAt ||= new Date();
      song.mediaStatus = 'deleted';
      await song.save();
    }
    await favoriteModel.deleteMany({ userId: ownerId(req), songId: song._id });
    await playlistModel.updateMany({ userId: ownerId(req) }, { $pull: { songIds: song._id }, $inc: { revision: 1 } });
    await song.deleteOne();
    res.status(204).end();
  });

  router.get('/favorites', authenticate, async (req, res) => {
    const favorites = await favoriteModel.find({ userId: ownerId(req) }).sort({ createdAt: -1 }).lean();
    const ids = favorites.map(({ songId }) => songId);
    const songs = ids.length ? await songModel.find({ _id: { $in: ids }, ...accessibleSongFilter(req.auth.userId, ids) })
      .select('+storageFileId +uploadedBy +ownerId +aiSuggestions').lean() : [];
    const byId = new Map(songs.map((song) => [String(song._id), song]));
    res.json({ favorites: (await Promise.all(ids.map(async (id) => byId.has(String(id)) ? songForViewer(byId.get(String(id))) : null))).filter(Boolean) });
  });

  router.post('/favorites/:songId', authenticate, async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.songId)) throw new ApiError(404, 'SONG_NOT_FOUND', 'The song was not found.');
    const song = await songModel.findOne({ _id: req.params.songId, ...accessibleSongFilter(req.auth.userId, [req.params.songId]) })
      .select('+uploadedBy +ownerId +storageFileId +aiSuggestions');
    if (!song) throw new ApiError(404, 'SONG_NOT_FOUND', 'The song was not found.');
    try {
      await favoriteModel.updateOne({ userId: ownerId(req), songId: song._id }, { $setOnInsert: { userId: ownerId(req), songId: song._id } }, { upsert: true });
    } catch (error) {
      if (error?.code !== 11000) throw error;
    }
    res.status(201).json({ favorite: await songForViewer(song) });
  });

  router.delete('/favorites/:songId', authenticate, async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.songId)) return res.status(204).end();
    await favoriteModel.deleteOne({ userId: ownerId(req), songId: req.params.songId });
    res.status(204).end();
  });

  router.get('/playlists', authenticate, async (req, res) => {
    const playlists = await playlistModel.find({ userId: ownerId(req) }).sort({ updatedAt: -1 }).lean();
    res.json({ playlists: playlists.map(({ _id, name, revision, songIds, createdAt, updatedAt }) => ({ id: String(_id), name, revision, songCount: songIds.length, createdAt, updatedAt })) });
  });

  router.post('/playlists', authenticate, async (req, res) => {
    if (!req.body || typeof req.body.name !== 'string' || req.body.name.trim().length < 1 || req.body.name.trim().length > 80 || Object.keys(req.body).some((key) => key !== 'name')) {
      throw new ApiError(400, 'INVALID_PLAYLIST', 'A playlist name of 1 to 80 characters is required.');
    }
    const playlist = await playlistModel.create({ userId: ownerId(req), name: req.body.name.trim(), songIds: [] });
    res.status(201).json({ playlist: { id: String(playlist._id), name: playlist.name, revision: playlist.revision, songIds: [] } });
  });

  router.get('/playlists/:id', authenticate, async (req, res) => {
    const playlist = await playlistModel.findOne({ _id: req.params.id, userId: ownerId(req) }).lean();
    if (!playlist) throw new ApiError(404, 'PLAYLIST_NOT_FOUND', 'The playlist was not found.');
    const songs = playlist.songIds.length ? await songModel.find({ _id: { $in: playlist.songIds }, ...accessibleSongFilter(req.auth.userId, playlist.songIds) })
      .select('+storageFileId +uploadedBy +ownerId +aiSuggestions').lean() : [];
    const byId = new Map(songs.map((song) => [String(song._id), song]));
    res.json({ playlist: { id: String(playlist._id), name: playlist.name, revision: playlist.revision, songs: (await Promise.all(playlist.songIds.map((id) => byId.has(String(id)) ? songForViewer(byId.get(String(id))) : null))).filter(Boolean) } });
  });

  router.patch('/playlists/:id', authenticate, async (req, res) => {
    const { name, songIds, revision } = req.body || {};
    if (Object.keys(req.body || {}).some((key) => !['name', 'songIds', 'revision'].includes(key))) throw new ApiError(400, 'INVALID_PLAYLIST', 'Unsupported playlist fields.');
    if (!Number.isSafeInteger(revision) || revision < 0) throw new ApiError(400, 'INVALID_REVISION', 'A playlist revision is required.');
    const update = {};
    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) throw new ApiError(400, 'INVALID_PLAYLIST', 'A playlist name of 1 to 80 characters is required.');
      update.name = name.trim();
    }
    if (songIds !== undefined) {
      if (!Array.isArray(songIds) || songIds.length > MAX_PLAYLIST_SONGS || songIds.some((id) => !mongoose.isValidObjectId(id)) || new Set(songIds.map(String)).size !== songIds.length) {
        throw new ApiError(400, 'INVALID_PLAYLIST', 'songIds must be a unique list of at most 500 valid song IDs.');
      }
      const accessible = await songModel.countDocuments({ _id: { $in: songIds }, ...accessibleSongFilter(req.auth.userId, songIds) });
      if (accessible !== songIds.length) throw new ApiError(404, 'SONG_NOT_FOUND', 'One or more songs were not found.');
      update.songIds = songIds.map((id) => new mongoose.Types.ObjectId(id));
    }
    if (!Object.keys(update).length) throw new ApiError(400, 'INVALID_PLAYLIST', 'Provide a playlist name or song order.');
    const playlist = await playlistModel.findOneAndUpdate({ _id: req.params.id, userId: ownerId(req), revision }, { $set: update, $inc: { revision: 1 } }, { new: true, runValidators: true });
    if (!playlist) throw new ApiError(409, 'PLAYLIST_CHANGED', 'The playlist changed or is unavailable. Reload it and retry.');
    res.json({ playlist: { id: String(playlist._id), name: playlist.name, revision: playlist.revision, songIds: playlist.songIds.map(String) } });
  });

  router.delete('/playlists/:id', authenticate, async (req, res) => {
    await playlistModel.deleteOne({ _id: req.params.id, userId: ownerId(req) });
    res.status(204).end();
  });

  router.get('/admin/songs', authenticate, requireAdmin, async (req, res) => {
    const status = req.query.status || 'pending';
    if (!['pending', 'approved', 'rejected'].includes(status)) throw new ApiError(400, 'INVALID_CATALOG_STATUS', 'Provide a valid catalog status.');
    const songs = await songModel.find(adminCatalogFilter(status)).sort({ createdAt: 1, _id: 1 }).select('+storageFileId +analysis +aiSuggestions').lean();
    res.json({ songs: songs.map((song) => ({ ...publicSong(song), analysis: safeAnalysis(song) })) });
  });

  router.get('/admin/analysis/jobs', authenticate, requireAdmin, rateLimiters.analysis || ((_req, _res, next) => next()), async (req, res) => {
    const allowed = new Set(['status', 'page', 'limit']);
    if (Object.keys(req.query).some((key) => !allowed.has(key))) throw new ApiError(400, 'INVALID_QUERY', 'Unsupported analysis jobs query parameter.');
    const status = req.query.status || '';
    if (status && !['queued', 'processing', 'completed', 'failed'].includes(status)) throw new ApiError(400, 'INVALID_QUERY', 'Provide a valid analysis status.');
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 25);
    if (!Number.isSafeInteger(page) || page < 1 || page > 100_000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new ApiError(400, 'INVALID_QUERY', 'page and limit are outside the supported range.');
    const filter = status ? { status } : {};
    const [jobs, total] = await Promise.all([
      analysisJobModel.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      analysisJobModel.countDocuments(filter),
    ]);
    res.json({ jobs: jobs.map((job) => ({
      id: String(job._id), songId: String(job.songId), status: job.status,
      attempts: job.attempts, maxAttempts: job.maxAttempts, availableAt: job.availableAt,
      startedAt: job.startedAt, completedAt: job.completedAt, lastErrorCode: job.lastErrorCode,
      resultStatus: job.resultStatus, provider: job.provider, model: job.model,
    })), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  });

  router.post('/admin/analysis/jobs/:id/retry', authenticate, requireAdmin, rateLimiters.analysis || ((_req, _res, next) => next()), async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(404, 'ANALYSIS_JOB_NOT_FOUND', 'The analysis job was not found.');
    const job = await analysisJobModel.findById(req.params.id).lean();
    if (!job) throw new ApiError(404, 'ANALYSIS_JOB_NOT_FOUND', 'The analysis job was not found.');
    const song = await songModel.findById(job.songId).select('+analysis +metadataRevision +aiSuggestions +uploadedBy +ownerId');
    if (!song || song.mediaStatus !== 'active') throw new ApiError(404, 'SONG_NOT_FOUND', 'The song was not found.');
    try {
      const retried = await retrySongAnalysis(song, { songModel, jobModel: analysisJobModel, requestedBy: ownerId(req), requestSource: 'admin_retry' });
      res.status(202).json({ job: { id: String(retried._id), status: retried.status, availableAt: retried.availableAt } });
    } catch (error) {
      if (error?.code === 'AI_NOT_CONFIGURED') throw new ApiError(503, 'AI_NOT_CONFIGURED', 'Music analysis is not configured.');
      if (error?.code === 'ANALYSIS_NOT_RETRYABLE') throw new ApiError(409, 'ANALYSIS_NOT_RETRYABLE', 'Only failed analyses can be retried.');
      throw error;
    }
  });

  router.get('/admin/songs/:id/analysis', authenticate, requireAdmin, rateLimiters.analysis || ((_req, _res, next) => next()), async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(404, 'SONG_NOT_FOUND', 'The song was not found.');
    const song = await songModel.findById(req.params.id).select('+analysis +aiSuggestions +uploadedBy +ownerId');
    if (!song) throw new ApiError(404, 'SONG_NOT_FOUND', 'The song was not found.');
    res.json({ analysis: safeAnalysis(song) });
  });

  router.patch('/admin/songs/:id/metadata-review', authenticate, requireAdmin, rateLimiters.analysis || ((_req, _res, next) => next()), async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id) || !req.body || Object.keys(req.body).some((key) => key !== 'fields')) throw new ApiError(400, 'INVALID_METADATA_REVIEW', 'Only per-field review decisions are accepted.');
    const song = await songModel.findOne({ _id: req.params.id, visibility: 'public', uploadSource: { $in: ['admin', 'legacy'] } })
      .select('+analysis +aiSuggestions +metadataProvenance +metadataRevision +uploadedBy +ownerId');
    if (!song) throw new ApiError(404, 'SONG_NOT_FOUND', 'The catalog song was not found.');
    const reviewed = applySuggestionReview(song, req.body.fields, ownerId(req), 'admin');
    await song.save();
    console.info('[music-ai] Metadata suggestions reviewed', { role: 'admin', acceptedFields: reviewed.accepted.length, reviewedFields: reviewed.fields.length });
    res.json({ song: publicSong(song), analysis: safeAnalysis(song), reviewed });
  });

  router.patch('/admin/songs/:id', authenticate, requireAdmin, async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id) || !req.body || Object.keys(req.body).some((key) => !['status', 'metadata'].includes(key)) || !Object.keys(req.body).length) {
      throw new ApiError(400, 'INVALID_CATALOG_UPDATE', 'Provide catalog metadata and/or review status.');
    }
    const song = await songModel.findOne({ _id: req.params.id, uploadSource: { $in: ['admin', 'legacy'] }, visibility: 'public' }).select('+uploadedBy +ownerId +metadataProvenance +metadataRevision');
    if (!song) throw new ApiError(404, 'SONG_NOT_FOUND', 'The catalog song was not found.');
    let catalogUnavailable = false;
    if (req.body.status !== undefined) {
      if (!['pending', 'approved', 'rejected'].includes(req.body.status)) throw new ApiError(400, 'INVALID_CATALOG_STATUS', 'Provide a valid catalog status.');
      song.catalogStatus = req.body.status;
      catalogUnavailable = req.body.status !== 'approved';
      song.reviewedBy = ownerId(req);
      song.reviewedAt = new Date();
    }
    if (req.body.metadata !== undefined) {
      Object.assign(song, validateMetadataPatch(req.body.metadata));
      song.metadataRevision = (song.metadataRevision || 0) + 1;
      song.metadataProvenance = { ...song.metadataProvenance?.toObject?.(), ...Object.fromEntries(Object.keys(req.body.metadata).map((field) => [field, 'admin'])) };
      console.info('[music-ai] Metadata manually edited', { role: 'admin', fields: Object.keys(req.body.metadata).length });
    }
    await song.save();
    if (catalogUnavailable) {
      await favoriteModel.deleteMany({ songId: song._id });
      await playlistModel.updateMany({ songIds: song._id }, { $pull: { songIds: song._id }, $inc: { revision: 1 } });
    }
    res.json({ song: publicSong(song) });
  });

  router.get('/catalog', authenticate, async (req, res) => {
    const songs = await songModel.find({ $or: [publicCatalogFilter(), ownedPrivateSongFilter(req.auth.userId)] })
      .sort({ createdAt: -1, _id: -1 }).limit(100).lean();
    res.json({ songs: await Promise.all(songs.map(async (song) => song.visibility === 'private' ? signedPrivateSong(song) : publicSong(song))) });
  });

  return router;
}

module.exports = createMusicManagementRouter;
