const mongoose = require('mongoose');
const feedbackSessionQuotaModel = require('../models/feedback-session-quota.model');
const Feedback = require('../models/feedback.model');
const User = require('../models/user.model');
const AuthSession = require('../models/auth-session.model');
const Song = require('../models/song.model');
const Favorite = require('../models/favorite.model');
const Playlist = require('../models/playlist.model');
const SongAnalysisJob = require('../models/song-analysis-job.model');

function getConnectionTimeoutMs(value = process.env.MONGODB_CONNECT_TIMEOUT_MS) {
  if (value === undefined || value === '') return 10_000;
  if (!/^\d+$/.test(String(value))) {
    throw new Error('MONGODB_CONNECT_TIMEOUT_MS must be a positive integer.');
  }
  const timeout = Number(value);
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 120_000) {
    throw new Error('MONGODB_CONNECT_TIMEOUT_MS must be between 1 and 120000.');
  }
  return timeout;
}

async function connectToDB() {
  const mongoUrl = process.env.MONGODB_URL;
  if (!mongoUrl) throw new Error('MONGODB_URL is required.');

  try {
    await mongoose.connect(mongoUrl, {
      serverSelectionTimeoutMS: getConnectionTimeoutMs(),
    });
    // These unique and TTL indexes are security and quota invariants. Do not
    // start serving requests if MongoDB cannot create them.
    await Promise.all([feedbackSessionQuotaModel, Feedback, User, AuthSession, Song, Favorite, Playlist, SongAnalysisJob].map((model) => model.createIndexes()));
    console.log('Connected to MongoDB');
  } catch (error) {
    console.error('MongoDB startup preparation failed', { errorName: error?.name || 'Error' });
    throw error;
  }
}

module.exports = connectToDB;
