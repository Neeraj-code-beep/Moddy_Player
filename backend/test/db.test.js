const assert = require('node:assert/strict');
const { afterEach, mock, test } = require('node:test');
const mongoose = require('mongoose');
const connectToDB = require('../src/db/db');
const feedbackSessionQuotaModel = require('../src/models/feedback-session-quota.model');
const User = require('../src/models/user.model');
const AuthSession = require('../src/models/auth-session.model');
const Song = require('../src/models/song.model');

const originalMongoUrl = process.env.MONGODB_URL;
const originalTimeout = process.env.MONGODB_CONNECT_TIMEOUT_MS;

afterEach(() => {
  mock.restoreAll();
  if (originalMongoUrl === undefined) delete process.env.MONGODB_URL;
  else process.env.MONGODB_URL = originalMongoUrl;
  if (originalTimeout === undefined) delete process.env.MONGODB_CONNECT_TIMEOUT_MS;
  else process.env.MONGODB_CONNECT_TIMEOUT_MS = originalTimeout;
});

test('database module imports and rejects a missing MongoDB URL clearly', async () => {
  delete process.env.MONGODB_URL;
  await assert.rejects(connectToDB(), /MONGODB_URL is required/);
});

test('database connection uses the configured timeout and resolves only after connect', async () => {
  process.env.MONGODB_URL = 'mongodb://localhost/moddy_test';
  process.env.MONGODB_CONNECT_TIMEOUT_MS = '2500';
  let connectOptions;
  const indexedModels = new Set();
  mock.method(mongoose, 'connect', async (_url, options) => {
    connectOptions = options;
    return mongoose;
  });
  for (const model of [feedbackSessionQuotaModel, User, AuthSession, Song]) {
    mock.method(model, 'createIndexes', async () => { indexedModels.add(model.modelName); });
  }
  mock.method(console, 'log', () => {});

  await connectToDB();
  assert.deepEqual(connectOptions, { serverSelectionTimeoutMS: 2500 });
  assert.deepEqual([...indexedModels].sort(), ['AuthSession', 'FeedbackSessionQuota', 'Song', 'User']);
});

test('database connection failures are propagated to startup', async () => {
  process.env.MONGODB_URL = 'mongodb://localhost/moddy_test';
  mock.method(mongoose, 'connect', async () => { throw new Error('mock database failure'); });
  mock.method(console, 'error', () => {});

  await assert.rejects(connectToDB(), /mock database failure/);
});
