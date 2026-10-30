const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { test } = require('node:test');
const createApp = require('../src/app').createApp;
const {
  INTEGRATION_DATABASE_NAME,
  PROTECTED_DATABASE_NAMES,
  assertIntegrationDatabase,
  dropIntegrationDatabase,
  makeIsolatedMongoUrl,
  sanitizeMongoError,
} = require('./mongodb-test-safety');

const integrationUrl = process.env.MONGODB_INTEGRATION_URL;

test('MongoDB integration URI accepts only the dedicated test database', () => {
  const uri = makeIsolatedMongoUrl(`mongodb://example.invalid/${INTEGRATION_DATABASE_NAME}`);
  assert.equal(new URL(uri).pathname, `/${INTEGRATION_DATABASE_NAME}`);

  for (const databaseName of [...PROTECTED_DATABASE_NAMES, 'another_database']) {
    assert.throws(
      () => makeIsolatedMongoUrl(`mongodb://example.invalid/${databaseName}`),
      /must target moddy_player_integration_test/,
    );
  }
  assert.throws(
    () => makeIsolatedMongoUrl(`mongodb://example.invalid/${INTEGRATION_DATABASE_NAME}?dbName=second_db`),
    /must target moddy_player_integration_test/,
  );
  assert.throws(
    () => makeIsolatedMongoUrl(`mongodb://example.invalid/${INTEGRATION_DATABASE_NAME}?authSource=second_db`),
    /cannot authenticate against a protected application database/,
  );
});

test('MongoDB connection diagnostics redact hosts, credentials, and URI strings', () => {
  const cause = Object.assign(new Error('querySrv ENOTFOUND _mongodb._tcp.cluster0.example.net'), {
    code: 'ENOTFOUND',
  });
  const error = Object.assign(new Error('connection failed mongodb+srv://user:password@cluster0.example.net/db'), {
    name: 'MongoServerSelectionError',
    code: 'ETIMEDOUT',
    codeName: 'ServerSelectionTimeout',
    cause,
  });

  const diagnostic = sanitizeMongoError(error);
  assert.equal(diagnostic.name, 'MongoServerSelectionError');
  assert.equal(diagnostic.code, 'ETIMEDOUT');
  assert.equal(diagnostic.codeName, 'ServerSelectionTimeout');
  assert.equal(diagnostic.message, 'connection failed [redacted MongoDB URI]');
  assert.match(diagnostic.stack, /\[redacted MongoDB URI\]/);
  assert.equal(diagnostic.cause.name, 'Error');
  assert.equal(diagnostic.cause.code, 'ENOTFOUND');
  assert.equal(diagnostic.cause.message, 'querySrv ENOTFOUND [redacted host]');
  assert.equal(JSON.stringify(diagnostic).includes('cluster0.example.net'), false);
  assert.equal(JSON.stringify(diagnostic).includes('password@'), false);
});

test('isolated MongoDB integration: startup, songs, catalog, recommendations, feedback, indexes, and disconnect', {
  skip: !integrationUrl,
}, async () => {
  const connection = mongoose.createConnection(makeIsolatedMongoUrl(integrationUrl), {
    serverSelectionTimeoutMS: 5_000,
  });
  let server;
  try {
    try {
      await connection.asPromise();
    } catch (error) {
      console.error('[mongodb-integration] Connection failed', sanitizeMongoError(error));
      throw new Error('Could not connect to the isolated MongoDB integration database.');
    }
    assertIntegrationDatabase(connection);

    const schemaForIntegration = (model) => {
      const schema = model.schema.clone();
      schema.set('bufferCommands', false);
      return schema;
    };
    const Song = connection.model('IntegrationSong', schemaForIntegration(require('../src/models/song.model')));
    const Feedback = connection.model('IntegrationFeedback', schemaForIntegration(require('../src/models/feedback.model')));
    const Quota = connection.model('IntegrationFeedbackSessionQuota', schemaForIntegration(require('../src/models/feedback-session-quota.model')));
    await Promise.all([Song.createIndexes(), Feedback.createIndexes(), Quota.createIndexes()]);
    for (const model of [Song, Feedback, Quota]) {
      assert.equal(model.db, connection);
      assert.equal(model.db.readyState, 1);
    }

    let providerFileName;
    const app = createApp({
      songModel: Song,
      feedbackModel: Feedback,
      feedbackSessionQuotaModel: Quota,
      onFeedbackDatabaseError: (operation, error) => {
        console.error('[mongodb-integration] Feedback database operation failed', {
          operation,
          error: sanitizeMongoError(error),
        });
      },
      isDatabaseReady: () => connection.readyState === 1,
      rateLimitConfig: { windowMs: 60_000, upload: 100, feedback: 100, recommendation: 100, catalog: 100, trustedProxyHops: 0 },
      uploadFile: async (_file, fileName) => {
        providerFileName = fileName;
        return { fileId: `integration-${fileName}`, url: `https://ik.example.invalid/${fileName}` };
      },
      deleteFile: async () => {},
    });
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const ready = await fetch(`${baseUrl}/health`);
    assert.equal(ready.status, 200);

    const form = new FormData();
    form.set('title', 'Integration Song');
    form.set('artist', 'Integration Artist');
    form.set('mood', 'happy');
    form.set('genre', 'ambient');
    form.set('energy', 'low');
    form.set('audio', new Blob([Buffer.from('RIFF0000WAVE')], { type: 'audio/wav' }), 'integration.wav');
    const created = await fetch(`${baseUrl}/songs`, { method: 'POST', body: form });
    assert.equal(created.status, 201);
    const song = (await created.json()).song;
    assert.equal(song.audio, `https://ik.example.invalid/${providerFileName}`);
    assert.match(providerFileName, /^[0-9a-f-]{36}\.wav$/i);
    const storedSong = await Song.findById(song._id).select('+storageFileId').lean();
    assert.equal(await Song.countDocuments({ _id: song._id }), 1);
    assert.equal(storedSong.storageFileId, `integration-${providerFileName}`);
    assert.equal(storedSong.audio, song.audio);

    const catalog = await fetch(`${baseUrl}/songs?page=1&limit=1`);
    const catalogBody = await catalog.json();
    assert.equal(catalog.status, 200);
    assert.equal(catalogBody.pagination.total, 1);
    assert.equal(catalogBody.songs[0]._id, song._id);
    assert.equal(catalogBody.songs[0].storageFileId, undefined);

    for (const intention of ['match', 'cheer_up', 'calm_down', 'surprise']) {
      const response = await fetch(`${baseUrl}/recommendations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mood: 'sad', intention, limit: 1 }),
      });
      const result = await response.json();
      assert.equal(response.status, 200, intention);
      assert.equal(result.recommendations.length, 1, intention);
      assert.equal(result.recommendations[0].song._id, song._id, intention);
    }

    const sessionId = crypto.randomUUID();
    const feedback = await fetch(`${baseUrl}/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, songId: song._id, event: 'like', intention: 'match' }),
    });
    assert.equal(feedback.status, 202);
    assert.equal(await Feedback.countDocuments({ sessionId }), 1);
    const invalidFeedback = await fetch(`${baseUrl}/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, songId: song._id, event: 'operator', intention: 'match', $where: 'true' }),
    });
    assert.equal(invalidFeedback.status, 400);

    const parallelSessionId = crypto.randomUUID();
    await Quota.create({
      sessionId: parallelSessionId,
      count: 490,
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    });
    const parallelWrites = await Promise.all(Array.from({ length: 20 }, () => fetch(`${baseUrl}/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: parallelSessionId, songId: song._id, event: 'skip', intention: 'match' }),
    })));
    assert.equal(parallelWrites.filter((response) => response.status === 202).length, 10);
    assert.equal(parallelWrites.filter((response) => response.status === 429).length, 10);
    assert.equal((await Quota.findOne({ sessionId: parallelSessionId }).lean()).count, 500);
    assert.equal(await Feedback.countDocuments({ sessionId: parallelSessionId }), 10);

    const songIndexes = await Song.collection.listIndexes().toArray();
    const moodCatalogIndex = songIndexes.find(({ key }) =>
      key.mood === 1 && key.createdAt === -1 && key._id === -1 && Object.keys(key).length === 3);
    const recentCatalogIndex = songIndexes.find(({ key }) =>
      key.createdAt === -1 && key._id === -1 && Object.keys(key).length === 2);
    assert.equal(moodCatalogIndex?.name, 'mood_1_createdAt_-1__id_-1');
    assert.equal(recentCatalogIndex?.name, 'createdAt_-1__id_-1');
    assert.notEqual(moodCatalogIndex?.unique, true);
    assert.notEqual(recentCatalogIndex?.unique, true);

    const feedbackIndexes = await Feedback.collection.listIndexes().toArray();
    const feedbackTtlIndex = feedbackIndexes.find((index) => index.key.createdAt === 1);
    assert.equal(feedbackTtlIndex?.expireAfterSeconds, 7_776_000);
    const quotaIndexes = await Quota.collection.listIndexes().toArray();
    assert.equal(quotaIndexes.find((index) => index.key.sessionId === 1)?.unique, true);
    assert.equal(quotaIndexes.find((index) => index.key.expiresAt === 1)?.expireAfterSeconds, 0);

    const firstWriteSessionId = crypto.randomUUID();
    assert.equal(await Quota.countDocuments({ sessionId: firstWriteSessionId }), 0);
    assert.equal(await Feedback.countDocuments({ sessionId: firstWriteSessionId }), 0);
    const firstWriteResponses = await Promise.all(Array.from({ length: 20 }, () => fetch(`${baseUrl}/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: firstWriteSessionId, songId: song._id, event: 'like', intention: 'match' }),
    })));
    assert.equal(firstWriteResponses.filter((response) => response.status === 202).length, 20);
    assert.equal(firstWriteResponses.filter((response) => response.status !== 202).length, 0);
    const firstWriteQuota = await Quota.findOne({ sessionId: firstWriteSessionId }).lean();
    assert.equal(firstWriteQuota.count, 20);
    assert.equal(await Quota.countDocuments({ sessionId: firstWriteSessionId }), 1);
    assert.equal(await Feedback.countDocuments({ sessionId: firstWriteSessionId }), 20);

    await dropIntegrationDatabase(connection);
    await connection.close();
    const notReady = await fetch(`${baseUrl}/health`);
    assert.equal(notReady.status, 503);
    const unavailableQuery = await fetch(`${baseUrl}/songs`);
    assert.equal(unavailableQuery.status, 500);
    assert.equal((await unavailableQuery.json()).error.code, 'INTERNAL_ERROR');
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    // The URI and connected database are both guarded to the dedicated test DB.
    // Clean it up even when an assertion fails.
    if (connection.readyState === 1) await dropIntegrationDatabase(connection).catch(() => {});
    if (connection.readyState !== 0) await connection.close().catch(() => {});
  }
});
