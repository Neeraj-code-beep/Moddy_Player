const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { test } = require('node:test');
const createApp = require('../src/app').createApp;
const { createAuthService } = require('../src/service/auth.service');
const { hashPassword } = require('../src/service/password.service');
const { createAccessToken, hashOpaqueToken } = require('../src/service/token.service');
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

test('isolated MongoDB integration: authentication transactions, songs, catalog, recommendations, feedback, indexes, cleanup, and disconnect', {
  skip: !integrationUrl,
}, async () => {
  const connection = mongoose.createConnection(makeIsolatedMongoUrl(integrationUrl), {
    serverSelectionTimeoutMS: 5_000,
  });
  let server;
  let databaseConfirmedDisposable = false;
  try {
    try {
      await connection.asPromise();
    } catch (error) {
      console.error('[mongodb-integration] Connection failed', sanitizeMongoError(error));
      throw new Error('Could not connect to the isolated MongoDB integration database.');
    }
    assertIntegrationDatabase(connection);
    const existingCollections = await connection.db.listCollections({}, { nameOnly: true }).toArray();
    assert.deepEqual(existingCollections, [], 'dedicated integration database must be empty before the test starts');
    databaseConfirmedDisposable = true;

    const schemaForIntegration = (model) => {
      const schema = model.schema.clone();
      schema.set('bufferCommands', false);
      return schema;
    };
    const Song = connection.model('IntegrationSong', schemaForIntegration(require('../src/models/song.model')));
    const Feedback = connection.model('IntegrationFeedback', schemaForIntegration(require('../src/models/feedback.model')));
    const Quota = connection.model('IntegrationFeedbackSessionQuota', schemaForIntegration(require('../src/models/feedback-session-quota.model')));
    const User = connection.model('IntegrationUser', schemaForIntegration(require('../src/models/user.model')));
    const AuthSession = connection.model('IntegrationAuthSession', schemaForIntegration(require('../src/models/auth-session.model')));
    await Promise.all([Song.createIndexes(), Feedback.createIndexes(), Quota.createIndexes(), User.createIndexes(), AuthSession.createIndexes()]);
    for (const model of [Song, Feedback, Quota, User, AuthSession]) {
      assert.equal(model.db, connection);
      assert.equal(model.db.readyState, 1);
    }
    const userIndexes = await User.collection.listIndexes().toArray();
    assert.equal(userIndexes.find((index) => index.key.email === 1)?.unique, true);
    const authSessionIndexes = await AuthSession.collection.listIndexes().toArray();
    assert.equal(authSessionIndexes.find((index) => index.key.tokenHash === 1)?.unique, true);
    assert.equal(authSessionIndexes.find((index) => index.key.expiresAt === 1)?.expireAfterSeconds, 0);

    let providerFileName;
    const authConfig = {
      accessTokenSecret: crypto.randomBytes(32).toString('base64url'),
      accessTokenTtlSeconds: 600,
      refreshTtlDays: 30,
      cookie: { refreshName: 'moddy_refresh', csrfName: 'moddy_csrf', path: '/auth', csrfPath: '/', sameSite: 'lax', secure: false },
    };
    const adminPassword = 'Integration_Admin_2026!';
    const admin = await User.create({
      name: 'Integration Admin',
      email: `integration-admin-${crypto.randomUUID()}@example.test`,
      passwordHash: await hashPassword(adminPassword),
      role: 'admin',
    });
    const adminId = admin._id;
    const adminFamilyId = crypto.randomUUID();
    await AuthSession.create({
      userId: adminId,
      familyId: adminFamilyId,
      tokenHash: hashOpaqueToken(crypto.randomBytes(48).toString('base64url')),
      status: 'active',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    const adminToken = createAccessToken({ userId: adminId, familyId: adminFamilyId, role: 'admin' }, authConfig);
    let failNextSessionInsert = false;
    const sessionModelForService = new Proxy(AuthSession, {
      get(target, property) {
        if (property === 'create') {
          return (...args) => {
            if (failNextSessionInsert) {
              failNextSessionInsert = false;
              throw new Error('Injected integration session insert failure.');
            }
            return target.create(...args);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const authService = createAuthService({
      userModel: User,
      sessionModel: sessionModelForService,
      configProvider: () => authConfig,
      mongo: connection,
    });
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
      rateLimitConfig: { windowMs: 60_000, upload: 100, feedback: 100, recommendation: 100, catalog: 100, register: 100, login: 100, refresh: 100, password: 100, profile: 100, trustedProxyHops: 0 },
      uploadFile: async (_file, fileName) => {
        providerFileName = fileName;
        return { fileId: `integration-${fileName}`, url: `https://ik.example.invalid/${fileName}` };
      },
      deleteFile: async () => {},
      userModel: User,
      authSessionModel: AuthSession,
      authService,
      mongo: connection,
      authConfig,
    });
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const ready = await fetch(`${baseUrl}/health`);
    assert.equal(ready.status, 200);

    const testPassword = 'Integration_User_2026!';
    const testEmail = `integration-user-${crypto.randomUUID()}@example.test`;
    const registration = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Integration User', email: testEmail, password: testPassword }),
    });
    assert.equal(registration.status, 200);
    const registrationBody = await registration.json();
    const userId = registrationBody.user.id;
    const persistedUser = await User.findById(userId).select('+passwordHash');
    assert.ok(persistedUser);
    assert.match(persistedUser.passwordHash, /^\$argon2id\$/);
    assert.notEqual(persistedUser.passwordHash, testPassword);
    assert.equal(await AuthSession.countDocuments({ userId }), 1);
    assert.equal(registrationBody.user.passwordHash, undefined);
    const cookieValue = (response, name) => {
      const cookie = response.headers.getSetCookie().find((header) => header.startsWith(`${name}=`));
      assert.ok(cookie, `${name} cookie should be issued`);
      return cookie.split(';')[0].slice(name.length + 1);
    };
    const csrfCookieHeader = (csrf) => `moddy_csrf=${csrf}`;
    const csrfHeader = (csrf) => ({ 'x-csrf-token': csrf });
    const login = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: 'Incorrect_Password_2026!' }),
    });
    assert.equal(login.status, 401);
    assert.equal((await login.json()).error.code, 'AUTH_INVALID_CREDENTIALS');
    const loginResponse = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    assert.equal(loginResponse.status, 200);
    const loginBody = await loginResponse.json();
    const oldRefresh = cookieValue(loginResponse, 'moddy_refresh');
    const oldCsrf = cookieValue(loginResponse, 'moddy_csrf');
    const oldSession = await AuthSession.findOne({ tokenHash: hashOpaqueToken(oldRefresh) }).select('+tokenHash');
    assert.equal(oldSession.status, 'active');
    assert.notEqual(oldSession.tokenHash, oldRefresh);

    const refreshRequest = (refresh, csrf) => fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { origin: 'http://localhost:5173', cookie: `moddy_refresh=${refresh}; ${csrfCookieHeader(csrf)}`, ...csrfHeader(csrf) },
    });
    const rotatedResponse = await refreshRequest(oldRefresh, oldCsrf);
    assert.equal(rotatedResponse.status, 200);
    const rotatedBody = await rotatedResponse.json();
    const newRefresh = cookieValue(rotatedResponse, 'moddy_refresh');
    assert.notEqual(newRefresh, oldRefresh);
    assert.equal((await AuthSession.findById(oldSession._id)).status, 'rotated');
    const rotatedSession = await AuthSession.findOne({ tokenHash: hashOpaqueToken(newRefresh) }).select('+tokenHash');
    assert.equal(rotatedSession.status, 'active');
    assert.notEqual(rotatedSession.tokenHash, newRefresh);
    const reuseResponse = await refreshRequest(oldRefresh, oldCsrf);
    assert.equal(reuseResponse.status, 401);
    assert.equal((await AuthSession.countDocuments({ userId, familyId: oldSession.familyId, status: 'active' })), 0);
    const revokedTokenResponse = await fetch(`${baseUrl}/auth/me`, { headers: { authorization: `Bearer ${rotatedBody.accessToken}` } });
    assert.equal(revokedTokenResponse.status, 401);

    const logoutLogin = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    const logoutLoginBody = await logoutLogin.json();
    const logoutRefresh = cookieValue(logoutLogin, 'moddy_refresh');
    const logoutCsrf = cookieValue(logoutLogin, 'moddy_csrf');
    const logoutResponse = await fetch(`${baseUrl}/auth/logout`, {
      method: 'POST',
      headers: { origin: 'http://localhost:5173', cookie: `moddy_refresh=${logoutRefresh}; ${csrfCookieHeader(logoutCsrf)}`, ...csrfHeader(logoutCsrf) },
    });
    assert.equal(logoutResponse.status, 204);
    assert.equal((await fetch(`${baseUrl}/auth/me`, { headers: { authorization: `Bearer ${logoutLoginBody.accessToken}` } })).status, 401);

    const allSessionsOne = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST', headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    const allSessionsOneBody = await allSessionsOne.json();
    const allSessionsOneCsrf = cookieValue(allSessionsOne, 'moddy_csrf');
    const allSessionsTwo = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST', headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    const allSessionsTwoBody = await allSessionsTwo.json();
    const allSessionsTwoCsrf = cookieValue(allSessionsTwo, 'moddy_csrf');
    const logoutAll = await fetch(`${baseUrl}/auth/logout-all`, {
      method: 'POST',
      headers: {
        origin: 'http://localhost:5173',
        authorization: `Bearer ${allSessionsOneBody.accessToken}`,
        cookie: csrfCookieHeader(allSessionsOneCsrf),
        ...csrfHeader(allSessionsOneCsrf),
      },
    });
    assert.equal(logoutAll.status, 204);
    assert.equal(await AuthSession.countDocuments({ userId, status: 'active' }), 0);
    assert.equal((await fetch(`${baseUrl}/auth/me`, { headers: { authorization: `Bearer ${allSessionsTwoBody.accessToken}` } })).status, 401);

    for (const token of ['malformed', `${loginBody.accessToken}x`]) {
      const rejected = await fetch(`${baseUrl}/auth/me`, { headers: { authorization: `Bearer ${token}` } });
      assert.equal(rejected.status, 401);
    }
    const expiredToken = createAccessToken({ userId, familyId: crypto.randomUUID(), role: 'user' }, authConfig, new Date(Date.now() - 20 * 60_000));
    assert.equal((await fetch(`${baseUrl}/auth/me`, { headers: { authorization: `Bearer ${expiredToken}` } })).status, 401);
    const duplicateRegistration = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST', headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Duplicate', email: testEmail, password: testPassword }),
    });
    assert.equal(duplicateRegistration.status, 409);

    const beforeRollbackUsers = await User.countDocuments({ email: /rollback/ });
    failNextSessionInsert = true;
    const rollback = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Rollback User', email: `rollback-${crypto.randomUUID()}@example.test`, password: testPassword }),
    });
    assert.equal(rollback.status, 500);
    assert.equal(await User.countDocuments({ email: /rollback/ }), beforeRollbackUsers);

    const concurrentLogin = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST', headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    const concurrentBody = await concurrentLogin.json();
    const concurrentRefresh = cookieValue(concurrentLogin, 'moddy_refresh');
    const concurrentCsrf = cookieValue(concurrentLogin, 'moddy_csrf');
    const concurrentRotations = await Promise.all([
      refreshRequest(concurrentRefresh, concurrentCsrf),
      refreshRequest(concurrentRefresh, concurrentCsrf),
    ]);
    assert.equal(concurrentRotations.filter((response) => response.status === 200).length, 1);
    assert.equal(concurrentRotations.filter((response) => response.status === 401).length, 1);
    const concurrentSession = await AuthSession.findOne({ tokenHash: hashOpaqueToken(concurrentRefresh) });
    assert.equal(await AuthSession.countDocuments({ userId, familyId: concurrentSession.familyId, status: 'active' }), 0);
    assert.equal((await fetch(`${baseUrl}/auth/me`, { headers: { authorization: `Bearer ${concurrentBody.accessToken}` } })).status, 401);

    const form = new FormData();
    form.set('title', 'Integration Song');
    form.set('artist', 'Integration Artist');
    form.set('mood', 'happy');
    form.set('genre', 'ambient');
    form.set('energy', 'low');
    form.set('audio', new Blob([Buffer.from('RIFF0000WAVE')], { type: 'audio/wav' }), 'integration.wav');
    const created = await fetch(`${baseUrl}/songs`, { method: 'POST', headers: { authorization: `Bearer ${adminToken}` }, body: form });
    assert.equal(created.status, 201);
    const song = (await created.json()).song;
    assert.equal(song.audio, `https://ik.example.invalid/${providerFileName}`);
    assert.match(providerFileName, /^[0-9a-f-]{36}\.wav$/i);
    const storedSong = await Song.findById(song._id).select('+storageFileId').lean();
    assert.equal(await Song.countDocuments({ _id: song._id }), 1);
    assert.equal(storedSong.storageFileId, `integration-${providerFileName}`);
    assert.equal(storedSong.audio, song.audio);

    assert.equal(song.catalogStatus, 'pending');
    const pendingCatalog = await fetch(`${baseUrl}/songs?page=1&limit=1`);
    assert.equal((await pendingCatalog.json()).pagination.total, 0);
    const approved = await fetch(`${baseUrl}/admin/songs/${song._id}/catalog-status`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    });
    assert.equal(approved.status, 200);
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
    if (connection.readyState === 1 && databaseConfirmedDisposable) {
      await dropIntegrationDatabase(connection).catch(() => {});
    }
    if (connection.readyState !== 0) await connection.close().catch(() => {});
  }
});
