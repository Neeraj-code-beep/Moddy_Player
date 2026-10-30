const path = require('node:path');
const ApiError = require('./api-error');
const { normalizeMood } = require('../service/recommendation.service');

const AUDIO_TYPES = {
  '.mp3': ['audio/mpeg', 'audio/mp3'],
  '.wav': ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave'],
  '.flac': ['audio/flac', 'audio/x-flac'],
  '.ogg': ['audio/ogg', 'audio/vorbis', 'audio/opus'],
  '.oga': ['audio/ogg', 'audio/vorbis'],
  '.opus': ['audio/ogg', 'audio/opus'],
  '.m4a': ['audio/mp4', 'audio/x-m4a'],
  '.mp4': ['audio/mp4'],
  '.aac': ['audio/aac', 'audio/aacp', 'audio/x-aac'],
  '.webm': ['audio/webm'],
};

function hasSignature(extension, buffer) {
  if (extension === '.mp3') {
    return buffer.subarray(0, 3).toString() === 'ID3' ||
      (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0);
  }
  if (extension === '.wav') {
    return buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WAVE';
  }
  if (extension === '.flac') return buffer.subarray(0, 4).toString() === 'fLaC';
  if (['.ogg', '.oga', '.opus'].includes(extension)) return buffer.subarray(0, 4).toString() === 'OggS';
  if (['.m4a', '.mp4'].includes(extension)) return buffer.subarray(4, 8).toString() === 'ftyp';
  if (extension === '.aac') return buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xf6) === 0xf0;
  if (extension === '.webm') return buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  return false;
}

function validateAudioDeclaration(file) {
  const extension = path.extname(file.originalname || '').toLowerCase();
  const allowedMimeTypes = AUDIO_TYPES[extension];
  const mimeType = String(file.mimetype || '').toLowerCase();

  if (!allowedMimeTypes || !allowedMimeTypes.includes(mimeType)) {
    throw new ApiError(415, 'UNSUPPORTED_AUDIO_TYPE', 'Upload a supported audio file.');
  }
}

function validateAudioFile(file) {
  validateAudioDeclaration(file);
  const extension = path.extname(file.originalname || '').toLowerCase();
  if (!Buffer.isBuffer(file.buffer) || !hasSignature(extension, file.buffer)) {
    throw new ApiError(415, 'INVALID_AUDIO_FILE', 'The uploaded file does not match its declared audio type.');
  }
}

function validateSongMetadata(body) {
  const allowedFields = new Set(['title', 'artist', 'mood', 'genre', 'energy', 'tags']);
  const unexpectedFields = Object.keys(body || {}).filter((key) => !allowedFields.has(key));
  if (unexpectedFields.length > 0) {
    throw new ApiError(400, 'UNEXPECTED_FIELDS', 'Only title, artist, mood, genre, energy, and tags fields are accepted.');
  }

  const limits = { title: 120, artist: 120, mood: 40 };
  const metadata = {};

  for (const [field, maxLength] of Object.entries(limits)) {
    const value = body?.[field];
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new ApiError(400, 'INVALID_METADATA', `${field} is required.`);
    }

    const trimmedValue = value.trim();
    if (trimmedValue.length > maxLength) {
      throw new ApiError(400, 'INVALID_METADATA', `${field} must be ${maxLength} characters or fewer.`);
    }
    metadata[field] = trimmedValue;
  }

  const normalizedMood = normalizeMood(metadata.mood);
  if (normalizedMood) metadata.mood = normalizedMood;

  if (body.genre !== undefined && body.genre !== '') {
    if (typeof body.genre !== 'string' || body.genre.trim().length > 60) {
      throw new ApiError(400, 'INVALID_METADATA', 'genre must be 60 characters or fewer.');
    }
    if (body.genre.trim()) metadata.genre = body.genre.trim().toLowerCase().slice(0, 60);
  }

  if (body.energy !== undefined && body.energy !== '') {
    if (typeof body.energy !== 'string' || !['low', 'medium', 'high'].includes(body.energy.trim().toLowerCase())) {
      throw new ApiError(400, 'INVALID_METADATA', 'energy must be low, medium, or high.');
    }
    metadata.energy = body.energy.trim().toLowerCase();
  }

  if (body.tags !== undefined && body.tags !== '') {
    if (typeof body.tags !== 'string' && !Array.isArray(body.tags)) {
      throw new ApiError(400, 'INVALID_METADATA', 'tags must be a comma-separated string or list.');
    }
    const submittedTags = Array.isArray(body.tags) ? body.tags : String(body.tags).split(',');
    if (submittedTags.length > 5 || submittedTags.some((tag) => typeof tag !== 'string' || tag.trim().length > 30)) {
      throw new ApiError(400, 'INVALID_METADATA', 'tags must contain at most 5 values of 30 characters or fewer.');
    }
    const tags = [...new Set(submittedTags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
    if (tags.length) metadata.tags = tags;
  }

  return metadata;
}

module.exports = { validateAudioDeclaration, validateAudioFile, validateSongMetadata };
