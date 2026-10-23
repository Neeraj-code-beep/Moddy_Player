const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const multer = require('multer');
const ApiError = require('../utils/api-error');
const { validateAudioDeclaration, validateAudioFile, validateSongMetadata } = require('../utils/audio-validation');
const defaultSongModel = require('../models/song.model');

const DEFAULT_UPLOAD_LIMIT_BYTES = 25 * 1024 * 1024;
const MAX_UPLOAD_LIMIT_BYTES = 100 * 1024 * 1024;
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_PAGE = 1_000_000;
const MAX_CONCURRENT_UPLOADS = 1;

function getUploadLimitBytes(value = process.env.MAX_UPLOAD_SIZE_BYTES) {
  if (value === undefined || value === '') return DEFAULT_UPLOAD_LIMIT_BYTES;
  if (!/^\d+$/.test(String(value))) throw new Error('MAX_UPLOAD_SIZE_BYTES must be a positive integer.');
  const bytes = Number(value);
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_UPLOAD_LIMIT_BYTES) {
    throw new Error('MAX_UPLOAD_SIZE_BYTES must be between 1 byte and 100 MiB.');
  }
  return bytes;
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
  uploadFile: configuredUploadFile,
  deleteFile: configuredDeleteFile,
  uploadLimitBytes = getUploadLimitBytes(),
} = {}) {
  const uploadFile = configuredUploadFile || ((...args) => require('../service/storage.service')(...args));
  const deleteFile = configuredDeleteFile || ((fileId) => require('../service/storage.service').deleteFile(fileId));
  const router = express.Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: uploadLimitBytes,
      files: 1,
      fields: 3,
      // Busboy signals the limit on reaching the configured number, so 5 permits 4 parts.
      parts: 5,
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
  let activeUploads = 0;

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
    res.once('finish', releaseSlot);
    res.once('close', releaseSlot);
    next();
  }

  function parseUpload(req, res, next) {
    upload.single('audio')(req, res, (error) => {
      if (error) return next(mapMulterError(error));
      next();
    });
  }

  async function removeUploadedAsset(fileId) {
    if (typeof deleteFile !== 'function' || !fileId) return;
    try {
      await deleteFile(fileId);
    } catch (error) {
      console.error('[songs] ImageKit cleanup failed', { errorName: error?.name || 'Error' });
    }
  }

  router.post('/songs', limitConcurrentUploads, parseUpload, async (req, res) => {
    const metadata = validateSongMetadata(req.body);
    if (!req.file) throw new ApiError(400, 'AUDIO_REQUIRED', 'An audio file in the audio field is required.');
    validateAudioFile(req.file);

    const extension = path.extname(req.file.originalname).toLowerCase();
    const providerFileName = `${crypto.randomUUID()}${extension}`;
    let uploadedAsset;

    try {
      uploadedAsset = await uploadFile(req.file, providerFileName);
    } catch (error) {
      throw new ApiError(502, 'AUDIO_STORAGE_FAILED', 'The audio file could not be stored.', error);
    }

    if (!uploadedAsset?.fileId || typeof uploadedAsset.url !== 'string' || !uploadedAsset.url.startsWith('https://')) {
      await removeUploadedAsset(uploadedAsset?.fileId);
      throw new ApiError(502, 'AUDIO_STORAGE_FAILED', 'The audio storage provider returned an invalid result.');
    }

    let song;
    try {
      song = await songModel.create({ ...metadata, audio: uploadedAsset.url });
    } catch (error) {
      await removeUploadedAsset(uploadedAsset.fileId);
      throw new ApiError(500, 'SONG_SAVE_FAILED', 'The song could not be saved.', error);
    }

    res.status(201).json({ message: 'Song created successfully', song });
  });

  router.get('/songs', async (req, res) => {
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
    const filter = mood ? { mood } : {};
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

  return router;
}

module.exports = createSongRouter;
module.exports.getUploadLimitBytes = getUploadLimitBytes;
