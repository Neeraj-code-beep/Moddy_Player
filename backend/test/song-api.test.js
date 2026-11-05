const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const createApp = require('../src/app').createApp;
const getCorsOrigins = require('../src/app').getCorsOrigins;
const getUploadLimitBytes = require('../src/routes/song.routes').getUploadLimitBytes;
const getImageKitResponseTimeoutMs = require('../src/routes/song.routes').getImageKitResponseTimeoutMs;
const { createAccessToken } = require('../src/service/token.service');
const testAuthConfig = { accessTokenSecret: 'test-secret-that-is-at-least-32-bytes-long', accessTokenTtlSeconds: 600, cookie: { refreshName: 'moddy_refresh', csrfName: 'moddy_csrf', path: '/auth', csrfPath: '/', sameSite: 'lax', secure: false }, refreshTtlDays: 30 };
const adminId = '507f1f77bcf86cd799439011';
const regularUserId = '507f1f77bcf86cd799439012';
const testAdmin = { _id: adminId, id: adminId, name: 'Test Admin', email: 'admin@example.test', role: 'admin', status: 'active' };
const testRegularUser = { _id: regularUserId, id: regularUserId, name: 'Test User', email: 'user@example.test', role: 'user', status: 'active' };
const testUserModel = { async findById(id) { return String(id) === adminId ? testAdmin : String(id) === regularUserId ? testRegularUser : null; } };
const testAuthSessionModel = {
  findOne(filter) {
    const value = [adminId, regularUserId].includes(String(filter.userId)) &&
      filter.familyId === 'b6c0f7cc-8c9d-4b1e-a9f2-30a6a6466ce6' && filter.status === 'active'
      ? { _id: 'active-session' }
      : null;
    return { select() { return this; }, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } };
  },
};
const adminToken = createAccessToken({ userId: adminId, familyId: 'b6c0f7cc-8c9d-4b1e-a9f2-30a6a6466ce6', role: 'admin' }, testAuthConfig);
const userToken = createAccessToken({ userId: regularUserId, familyId: 'b6c0f7cc-8c9d-4b1e-a9f2-30a6a6466ce6', role: 'user' }, testAuthConfig);
const makeApp = (options = {}) => createApp({ userModel: testUserModel, authSessionModel: testAuthSessionModel, authConfig: testAuthConfig, ...options });

const validAudio = Buffer.from('RIFF0000WAVE');
const audioFields = { title: '  Test Song  ', artist: '  Test Artist ', mood: ' happy ' };
const highTestRateLimits = {
  windowMs: 60_000,
  upload: 100,
  feedback: 100,
  recommendation: 100,
  catalog: 100,
  trustedProxyHops: 0,
};

function createSongModel({ records = [], createError, findError, countError } = {}) {
  const calls = { filters: [], created: [] };
  return {
    calls,
    async create(data) {
      if (createError) throw createError;
      calls.created.push(data);
      return { _id: 'song-1', ...data };
    },
    find(filter) {
      if (findError) throw findError;
      calls.filters.push(filter);
      const query = { offset: 0, limitValue: records.length };
      query.select = () => query;
      query.sort = () => query;
      query.skip = (value) => { query.offset = value; return query; };
      query.limit = (value) => { query.limitValue = value; return query; };
      query.lean = async () => records
        .filter((record) => !filter.mood || record.mood === filter.mood)
        .slice(query.offset, query.offset + query.limitValue);
      return query;
    },
    async countDocuments(filter) {
      if (countError) throw countError;
      return records.filter((record) => !filter.mood || record.mood === filter.mood).length;
    },
  };
}

function makeMultipart(fields = audioFields, file = { name: 'track.wav', type: 'audio/wav', data: validAudio }) {
  const boundary = `----moddy-${Math.random().toString(16).slice(2)}`;
  const chunks = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  if (file) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`));
    chunks.push(file.data);
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { boundary, body: Buffer.concat(chunks) };
}

async function sendUpload(baseUrl, fields, file) {
  const multipart = makeMultipart(fields, file);
  return fetch(`${baseUrl}/songs`, {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${multipart.boundary}`, authorization: `Bearer ${adminToken}` },
    body: multipart.body,
  });
}

const model = createSongModel({
  records: [
    { _id: '1', title: 'Happy 1', mood: 'happy' },
    { _id: '2', title: 'Sad 1', mood: 'sad' },
    { _id: '3', title: 'Happy 2', mood: 'happy' },
  ],
});
const uploadCalls = [];
const deleteCalls = [];
let app;
let server;
let baseUrl;

before(async () => {
  app = makeApp({
    songModel: model,
    uploadLimitBytes: 1024,
    uploadFile: async (file, fileName) => {
      uploadCalls.push({ file, fileName });
      return { fileId: 'provider-file-1', url: 'https://ik.example.invalid/songs/provider-file-1' };
    },
    deleteFile: async (fileId) => deleteCalls.push(fileId),
    isDatabaseReady: () => true,
    rateLimitConfig: highTestRateLimits,
    getDeliveryUrl: async (url) => `${url}?signed=true`,
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test('readiness reports database state', async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ready' });
});

test('song uploads require an administrator account', async () => {
  const multipart = makeMultipart();
  const anonymous = await fetch(`${baseUrl}/songs`, { method: 'POST', headers: { 'content-type': `multipart/form-data; boundary=${multipart.boundary}` }, body: multipart.body });
  assert.equal(anonymous.status, 401);
  const regular = await fetch(`${baseUrl}/songs`, { method: 'POST', headers: { 'content-type': `multipart/form-data; boundary=${multipart.boundary}`, authorization: `Bearer ${userToken}` }, body: multipart.body });
  assert.equal(regular.status, 403);
});

test('catalog approval is admin-only and rejects invalid status transitions', async () => {
  const songId = '507f1f77bcf86cd799439099';
  const song = { _id: songId, uploadSource: 'admin', visibility: 'public', catalogStatus: 'pending', reviewedBy: null, reviewedAt: null };
  const reviewModel = {
    async findOne(filter) {
      if (filter._id !== songId || filter.uploadSource !== 'admin' || filter.visibility !== 'public') return null;
      return { ...song, async save() { Object.assign(song, this); return song; } };
    },
  };
  const reviewApp = makeApp({ songModel: reviewModel });
  const reviewServer = reviewApp.listen(0, '127.0.0.1');
  await new Promise((resolve) => reviewServer.once('listening', resolve));
  const url = `http://127.0.0.1:${reviewServer.address().port}/admin/songs/${songId}/catalog-status`;
  try {
    const denied = await fetch(url, {
      method: 'PATCH', headers: { authorization: `Bearer ${userToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    });
    assert.equal(denied.status, 403);
    const invalid = await fetch(url, {
      method: 'PATCH', headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'published' }),
    });
    assert.equal(invalid.status, 400);
    const approved = await fetch(url, {
      method: 'PATCH', headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    });
    assert.equal(approved.status, 200);
    assert.equal(song.catalogStatus, 'approved');
    const missing = await fetch(`http://127.0.0.1:${reviewServer.address().port}/admin/songs/507f1f77bcf86cd799439098/catalog-status`, {
      method: 'PATCH', headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    });
    assert.equal(missing.status, 404);
    const privateSubmission = await fetch(`http://127.0.0.1:${reviewServer.address().port}/admin/songs/507f1f77bcf86cd799439097/catalog-status`, {
      method: 'PATCH', headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    });
    assert.equal(privateSubmission.status, 404);
  } finally {
    reviewServer.closeAllConnections();
    await new Promise((resolve, reject) => reviewServer.close((error) => error ? reject(error) : resolve()));
  }
});

test('upload size configuration defaults to 25 MiB and rejects unreasonable values', () => {
  assert.equal(getUploadLimitBytes(''), 25 * 1024 * 1024);
  assert.equal(getUploadLimitBytes('1048576'), 1024 * 1024);
  assert.throws(() => getUploadLimitBytes('0'), /between 1 byte and 100 MiB/);
  assert.throws(() => getUploadLimitBytes('104857601'), /between 1 byte and 100 MiB/);
});

test('ImageKit response wait configuration is bounded and defaults to 30 seconds', () => {
  assert.equal(getImageKitResponseTimeoutMs(''), 30_000);
  assert.equal(getImageKitResponseTimeoutMs('5000'), 5_000);
  assert.throws(() => getImageKitResponseTimeoutMs('999'), /between 1000 and 120000/);
  assert.throws(() => getImageKitResponseTimeoutMs('120001'), /between 1000 and 120000/);
});

test('readiness reports unavailable database state as not ready', async () => {
  const notReadyApp = makeApp({ isDatabaseReady: () => false, rateLimitConfig: highTestRateLimits });
  const notReadyServer = notReadyApp.listen(0, '127.0.0.1');
  await new Promise((resolve) => notReadyServer.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${notReadyServer.address().port}/health`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { status: 'not_ready' });
  } finally {
    notReadyServer.closeAllConnections();
    await new Promise((resolve) => notReadyServer.close(resolve));
  }
});

test('CORS allows the configured frontend and omits access for other browser origins', async () => {
  assert.deepEqual([...getCorsOrigins('', 'development')], ['http://localhost:5173', 'http://127.0.0.1:5173']);
  assert.deepEqual([...getCorsOrigins('https://player.example.com, https://admin.example.com')], [
    'https://player.example.com',
    'https://admin.example.com',
  ]);
  assert.throws(() => getCorsOrigins('', 'production'), /required in production/);
  assert.throws(() => getCorsOrigins('http://player.example.com', 'production'), /exact HTTPS origins/);
  assert.throws(() => getCorsOrigins('https://player.example.com/path', 'production'), /exact HTTPS origins/);
  const corsApp = makeApp({
    corsOrigins: new Set(['http://localhost:5173']),
    isDatabaseReady: () => true,
    rateLimitConfig: highTestRateLimits,
  });
  const corsServer = corsApp.listen(0, '127.0.0.1');
  await new Promise((resolve) => corsServer.once('listening', resolve));
  try {
    const url = `http://127.0.0.1:${corsServer.address().port}/health`;
    const allowed = await fetch(url, { headers: { Origin: 'http://localhost:5173' } });
    const rejected = await fetch(url, { headers: { Origin: 'https://untrusted.example' } });
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.equal(rejected.headers.get('access-control-allow-origin'), null);
  } finally {
    corsServer.closeAllConnections();
    await new Promise((resolve, reject) => corsServer.close((error) => error ? reject(error) : resolve()));
  }
});

test('upload trims required metadata and uses a unique provider filename', async () => {
  const response = await sendUpload(baseUrl);
  const body = await response.json();

  assert.equal(response.status, 201, JSON.stringify(body));
  assert.equal(body.song.title, 'Test Song');
  assert.equal(body.song.artist, 'Test Artist');
  assert.equal(body.song.mood, 'happy');
  assert.equal(body.song.visibility, 'public');
  assert.equal(body.song.catalogStatus, 'pending');
  assert.equal(model.calls.created.at(-1).uploadedByRole, 'admin');
  assert.equal(model.calls.created.at(-1).uploadSource, 'admin');
  assert.equal(String(model.calls.created.at(-1).uploadedBy), adminId);
  assert.match(uploadCalls.at(-1).fileName, /^[0-9a-f-]{36}\.wav$/i);
  assert.equal(model.calls.created.at(-1).storageFileId, 'provider-file-1');
  assert.equal(body.song.fileId, undefined);
  assert.equal(body.song.storageFileId, undefined);
});

test('upload accepts optional structured song metadata without changing legacy upload fields', async () => {
  const response = await sendUpload(baseUrl, {
    ...audioFields,
    genre: ' Ambient ',
    energy: ' LOW ',
    tags: 'Calm, relaxing',
  });
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  assert.equal(body.song.genre, 'ambient');
  assert.equal(body.song.energy, 'low');
  assert.deepEqual(body.song.tags, ['calm', 'relaxing']);
});

test('upload rejects whitespace-only metadata before provider upload', async () => {
  const callsBefore = uploadCalls.length;
  const response = await sendUpload(baseUrl, { ...audioFields, title: '   ' });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error.code, 'INVALID_METADATA');
  assert.equal(uploadCalls.length, callsBefore);
});

test('catalog upload does not accept client-controlled visibility', async () => {
  const callsBefore = uploadCalls.length;
  const response = await sendUpload(baseUrl, { ...audioFields, visibility: 'private' });
  assert.equal(response.status, 400);
  assert.equal(uploadCalls.length, callsBefore);
});

test('upload rejects metadata beyond the documented length limits', async () => {
  const response = await sendUpload(baseUrl, { ...audioFields, title: 't'.repeat(121) });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'INVALID_METADATA');
});

test('upload rejects a missing audio file', async () => {
  const response = await sendUpload(baseUrl, audioFields, null);
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.error.code, 'AUDIO_REQUIRED');
});

test('upload rejects unsupported MIME types and mismatched signatures', async () => {
  const callsBefore = uploadCalls.length;
  const wrongMime = await sendUpload(baseUrl, audioFields, { name: 'track.wav', type: 'text/plain', data: validAudio });
  assert.equal(wrongMime.status, 415);
  assert.equal((await wrongMime.json()).error.code, 'UNSUPPORTED_AUDIO_TYPE');

  const wrongSignature = await sendUpload(baseUrl, audioFields, { name: 'track.wav', type: 'audio/wav', data: Buffer.from('not audio') });
  assert.equal(wrongSignature.status, 415);
  assert.equal((await wrongSignature.json()).error.code, 'INVALID_AUDIO_FILE');
  assert.equal(uploadCalls.length, callsBefore);
});

test('upload rejects an unexpected file field', async () => {
  const boundary = 'moddy-extra-field';
  const body = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="cover"; filename="cover.wav"\r\nContent-Type: audio/wav\r\n\r\nRIFF0000WAVE\r\n--${boundary}--\r\n`);
  const response = await fetch(`${baseUrl}/songs`, {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, authorization: `Bearer ${adminToken}` },
    body,
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'INVALID_MULTIPART');
});

test('malformed multipart requests return a controlled client error', async () => {
  const response = await fetch(`${baseUrl}/songs`, {
    method: 'POST',
    headers: { 'content-type': 'multipart/form-data; boundary=unfinished', authorization: `Bearer ${adminToken}` },
    body: '--unfinished\r\nContent-Disposition: form-data; name="title"\r\n',
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'INVALID_MULTIPART');
});

test('upload enforces the configured size limit', async () => {
  const callsBefore = uploadCalls.length;
  const oversized = Buffer.concat([validAudio, Buffer.alloc(1024)]);
  const response = await sendUpload(baseUrl, audioFields, { name: 'track.wav', type: 'audio/wav', data: oversized });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, 'UPLOAD_TOO_LARGE');
  assert.equal(uploadCalls.length, callsBefore);
});

test('upload concurrency cap rejects a second in-progress upload before provider submission', async () => {
  let providerCalls = 0;
  let notifyProviderStarted;
  const providerStarted = new Promise((resolve) => { notifyProviderStarted = resolve; });
  let releaseProvider;
  const providerGate = new Promise((resolve) => { releaseProvider = resolve; });
  const limitedApp = makeApp({
    songModel: model,
    uploadLimitBytes: 1024,
    rateLimitConfig: highTestRateLimits,
    uploadFile: async () => {
      providerCalls += 1;
      notifyProviderStarted();
      await providerGate;
      return { fileId: 'limited-upload', url: 'https://ik.example.invalid/audio' };
    },
    deleteFile: async () => {},
    isDatabaseReady: () => true,
  });
  const limitedServer = limitedApp.listen(0, '127.0.0.1');
  await new Promise((resolve) => limitedServer.once('listening', resolve));
  const limitedUrl = `http://127.0.0.1:${limitedServer.address().port}`;
  const firstUpload = sendUpload(limitedUrl);
  try {
    await providerStarted;
    const secondResponse = await sendUpload(limitedUrl);
    const secondBody = await secondResponse.json();
    assert.equal(secondResponse.status, 503);
    assert.equal(secondBody.error.code, 'UPLOAD_BUSY');
    assert.equal(providerCalls, 1);

    releaseProvider();
    const firstResponse = await firstUpload;
    assert.equal(firstResponse.status, 201);
  } finally {
    releaseProvider();
    limitedServer.closeAllConnections();
    await new Promise((resolve, reject) => limitedServer.close((error) => error ? reject(error) : resolve()));
  }
});

test('provider failures return a safe error response', async () => {
  const failingApp = makeApp({
    songModel: model,
    uploadFile: async () => { throw new Error('provider secret detail'); },
    deleteFile: async () => {},
    uploadLimitBytes: 1024,
    isDatabaseReady: () => true,
    rateLimitConfig: highTestRateLimits,
  });
  const failingServer = failingApp.listen(0, '127.0.0.1');
  await new Promise((resolve) => failingServer.once('listening', resolve));
  try {
    const response = await sendUpload(`http://127.0.0.1:${failingServer.address().port}`);
    const body = await response.json();
    assert.equal(response.status, 502);
    assert.deepEqual(body.error, { code: 'AUDIO_STORAGE_FAILED', message: 'The audio file could not be stored.' });
    assert.equal(JSON.stringify(body).includes('provider secret detail'), false);
  } finally {
    failingServer.closeAllConnections();
    await new Promise((resolve) => failingServer.close(resolve));
  }
});

test('database create failure attempts to delete the uploaded provider asset', async () => {
  const failingApp = makeApp({
    songModel: createSongModel({ createError: new Error('database detail') }),
    uploadFile: async () => ({ fileId: 'orphan-candidate', url: 'https://ik.example.invalid/audio' }),
    deleteFile: async (fileId) => deleteCalls.push(fileId),
    uploadLimitBytes: 1024,
    isDatabaseReady: () => true,
    rateLimitConfig: highTestRateLimits,
  });
  const failingServer = failingApp.listen(0, '127.0.0.1');
  await new Promise((resolve) => failingServer.once('listening', resolve));
  try {
    const response = await sendUpload(`http://127.0.0.1:${failingServer.address().port}`);
    const body = await response.json();
    assert.equal(response.status, 500);
    assert.equal(body.error.code, 'SONG_SAVE_FAILED');
    assert.ok(deleteCalls.includes('orphan-candidate'));
  } finally {
    failingServer.closeAllConnections();
    await new Promise((resolve) => failingServer.close(resolve));
  }
});

test('upload concurrency slot is released after parse, validation, provider, database, and cleanup failures', async () => {
  let providerShouldFail = true;
  let databaseShouldFail = true;
  const failurePathModel = {
    ...model,
    async create(data) {
      if (databaseShouldFail) throw new Error('private database detail');
      return { _id: 'recovered-song', ...data };
    },
  };
  const failurePathApp = makeApp({
    songModel: failurePathModel,
    uploadLimitBytes: 1024,
    rateLimitConfig: highTestRateLimits,
    uploadFile: async () => {
      if (providerShouldFail) {
        providerShouldFail = false;
        throw new Error('private provider detail');
      }
      return { fileId: 'cleanup-fails', url: 'https://ik.example.invalid/audio' };
    },
    deleteFile: async () => { throw new Error('private cleanup detail'); },
    isDatabaseReady: () => true,
  });
  const failurePathServer = failurePathApp.listen(0, '127.0.0.1');
  await new Promise((resolve) => failurePathServer.once('listening', resolve));
  const failurePathUrl = `http://127.0.0.1:${failurePathServer.address().port}`;
  try {
    const malformed = await fetch(`${failurePathUrl}/songs`, {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=unfinished', authorization: `Bearer ${adminToken}` },
      body: '--unfinished\r\nContent-Disposition: form-data; name="title"\r\n',
    });
    assert.equal(malformed.status, 400);

    const invalidMetadata = await sendUpload(failurePathUrl, { ...audioFields, title: '' });
    assert.equal(invalidMetadata.status, 400);
    assert.equal((await invalidMetadata.json()).error.code, 'INVALID_METADATA');

    const providerFailure = await sendUpload(failurePathUrl);
    assert.equal(providerFailure.status, 502);
    assert.equal((await providerFailure.json()).error.code, 'AUDIO_STORAGE_FAILED');

    const databaseFailure = await sendUpload(failurePathUrl);
    assert.equal(databaseFailure.status, 500);
    assert.equal((await databaseFailure.json()).error.code, 'SONG_SAVE_FAILED');

    databaseShouldFail = false;
    const recovered = await sendUpload(failurePathUrl);
    assert.equal(recovered.status, 201);
    assert.equal((await recovered.json()).song._id, 'recovered-song');
  } finally {
    failurePathServer.closeAllConnections();
    await new Promise((resolve, reject) => failurePathServer.close((error) => error ? reject(error) : resolve()));
  }
});

test('provider response timeout keeps the upload slot until late provider completion and starts cleanup', async () => {
  let notifyProviderStarted;
  const providerStarted = new Promise((resolve) => { notifyProviderStarted = resolve; });
  let finishProvider;
  const providerGate = new Promise((resolve) => { finishProvider = resolve; });
  let notifyCleanupStarted;
  const cleanupStarted = new Promise((resolve) => { notifyCleanupStarted = resolve; });
  let finishCleanup;
  const cleanupGate = new Promise((resolve) => { finishCleanup = resolve; });
  let providerCalls = 0;
  const deleted = [];
  const timeoutApp = makeApp({
    songModel: model,
    uploadLimitBytes: 1024,
    imageKitResponseTimeoutMs: 10,
    rateLimitConfig: highTestRateLimits,
    uploadFile: async () => {
      providerCalls += 1;
      if (providerCalls === 1) {
        notifyProviderStarted();
        return providerGate;
      }
      return { fileId: 'recovered-after-timeout', url: 'https://ik.example.invalid/audio' };
    },
    deleteFile: async (fileId) => {
      deleted.push(fileId);
      notifyCleanupStarted();
      await cleanupGate;
    },
    isDatabaseReady: () => true,
  });
  const timeoutServer = timeoutApp.listen(0, '127.0.0.1');
  await new Promise((resolve) => timeoutServer.once('listening', resolve));
  const timeoutUrl = `http://127.0.0.1:${timeoutServer.address().port}`;
  const firstUpload = sendUpload(timeoutUrl);
  try {
    await providerStarted;
    const timedOut = await firstUpload;
    assert.equal(timedOut.status, 504);
    assert.equal((await timedOut.json()).error.code, 'AUDIO_STORAGE_TIMEOUT');

    const whileProviderActive = await sendUpload(timeoutUrl);
    assert.equal(whileProviderActive.status, 503);
    assert.equal((await whileProviderActive.json()).error.code, 'UPLOAD_BUSY');
    assert.equal(providerCalls, 1);

    finishProvider({ fileId: 'late-provider-asset', url: 'https://ik.example.invalid/late-audio' });
    await cleanupStarted;
    assert.deepEqual(deleted, ['late-provider-asset']);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const recovered = await sendUpload(timeoutUrl);
    assert.equal(recovered.status, 201);
    assert.equal(providerCalls, 2);
    finishCleanup();
  } finally {
    finishProvider({ fileId: 'late-provider-asset', url: 'https://ik.example.invalid/late-audio' });
    finishCleanup();
    timeoutServer.closeAllConnections();
    await new Promise((resolve, reject) => timeoutServer.close((error) => error ? reject(error) : resolve()));
  }
});

test('song retrieval applies mood filtering and default pagination', async () => {
  const response = await fetch(`${baseUrl}/songs?mood=happy`);
  const body = await response.json();
  assert.equal(response.status, 200);
  const filter = model.calls.filters.at(-1);
  assert.equal(filter.mood, 'happy');
  assert.equal(filter.$and.length, 4);
  assert.deepEqual(body.pagination, { page: 1, limit: 50, total: 2, totalPages: 1 });
  assert.equal(body.songs.length, 2);
});

test('song retrieval treats a missing or empty mood as an unfiltered catalog query', async () => {
  const response = await fetch(`${baseUrl}/songs?mood=&page=1&limit=2`);
  const body = await response.json();
  assert.equal(response.status, 200);
  const filter = model.calls.filters.at(-1);
  assert.equal(filter.mood, undefined);
  assert.equal(filter.$and.length, 4);
  assert.deepEqual(body.pagination, { page: 1, limit: 2, total: 3, totalPages: 2 });
  assert.equal(body.songs.length, 2);
});

test('public catalog excludes private uploads for regular users and administrators', async () => {
  for (const token of [userToken, adminToken]) {
    const response = await fetch(`${baseUrl}/songs`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    const filter = model.calls.filters.at(-1);
    assert.equal(filter.$and.length, 4);
    assert.equal(filter.visibility, undefined);
    assert.equal(filter.ownerId, undefined);
  }
});

test('personal uploads are private and use the authenticated owner identity', async () => {
  const multipart = makeMultipart();
  const response = await fetch(`${baseUrl}/library/songs`, {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${multipart.boundary}`, authorization: `Bearer ${userToken}` },
    body: multipart.body,
  });
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  assert.equal(model.calls.created.at(-1).visibility, 'private');
  assert.equal(model.calls.created.at(-1).uploadSource, 'user');
  assert.equal(String(model.calls.created.at(-1).uploadedBy), regularUserId);
  assert.equal(body.song.storageFileId, undefined);
  assert.equal(body.song.uploadedBy, undefined);
});

test('personal library queries are scoped to the authenticated user and sign private media URLs', async () => {
  const ownerSong = { _id: '507f1f77bcf86cd799439101', uploadedBy: regularUserId, ownerId: regularUserId, title: 'My track', artist: 'Me', mood: 'calm', audio: 'https://media.example.test/private-a', visibility: 'private', uploadSource: 'user', mediaStatus: 'active' };
  const otherSong = { _id: '507f1f77bcf86cd799439102', uploadedBy: adminId, ownerId: adminId, title: 'Other track', artist: 'Other', mood: 'calm', audio: 'https://media.example.test/private-b', visibility: 'private', uploadSource: 'user', mediaStatus: 'active' };
  let observedFilter;
  const libraryModel = {
    find(filter) {
      observedFilter = filter;
      const query = { select: () => query, sort: () => query, skip: () => query, limit: () => query, lean: async () => [ownerSong, otherSong].filter((song) =>
        song.visibility === filter.$and[0].visibility && song.uploadSource === filter.$and[0].uploadSource &&
        (Array.isArray(filter.$and[0].mediaStatus.$in) ? filter.$and[0].mediaStatus.$in.includes(song.mediaStatus) : song.mediaStatus === filter.$and[0].mediaStatus) && filter.$and[0].$or.some((owner) =>
          String(song.uploadedBy) === String(owner.uploadedBy || '') || String(song.ownerId) === String(owner.ownerId || '')),
      ) };
      return query;
    },
    async countDocuments() { return 1; },
  };
  const libraryApp = makeApp({ songModel: libraryModel, getDeliveryUrl: async (url) => `${url}?signed=short-lived` });
  const libraryServer = libraryApp.listen(0, '127.0.0.1');
  await new Promise((resolve) => libraryServer.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${libraryServer.address().port}/library/songs`, { headers: { authorization: `Bearer ${userToken}` } });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.songs.length, 1);
    assert.equal(body.songs[0].title, 'My track');
    assert.equal(body.songs[0].audio, `${ownerSong.audio}?signed=short-lived`);
    assert.equal(body.songs[0].uploadedBy, undefined);
    assert.equal(body.songs[0].ownerId, undefined);
    assert.deepEqual(observedFilter.$and[0].$or, [{ uploadedBy: regularUserId }, { ownerId: regularUserId }]);
  } finally {
    libraryServer.closeAllConnections();
    await new Promise((resolve, reject) => libraryServer.close((error) => error ? reject(error) : resolve()));
  }
});

test('song retrieval rejects invalid pagination and duplicate mood parameters', async () => {
  for (const query of ['page=0', 'page=1.5', 'limit=101', 'limit=-1', 'mood=happy&mood=sad']) {
    const response = await fetch(`${baseUrl}/songs?${query}`);
    const body = await response.json();
    assert.equal(response.status, 400, query);
    assert.equal(body.error.code, 'INVALID_QUERY', query);
  }
});

test('database query failures return a safe common error response', async () => {
  const queryFailureApp = makeApp({
    songModel: createSongModel({ findError: new Error('database details must stay private') }),
    isDatabaseReady: () => true,
    rateLimitConfig: highTestRateLimits,
  });
  const queryFailureServer = queryFailureApp.listen(0, '127.0.0.1');
  await new Promise((resolve) => queryFailureServer.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${queryFailureServer.address().port}/songs`);
    const body = await response.json();
    assert.equal(response.status, 500);
    assert.equal(body.error.code, 'INTERNAL_ERROR');
    assert.equal(JSON.stringify(body).includes('database details must stay private'), false);
  } finally {
    queryFailureServer.closeAllConnections();
    await new Promise((resolve) => queryFailureServer.close(resolve));
  }
});

test('malformed JSON uses the common error response shape', async () => {
  const response = await fetch(`${baseUrl}/songs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
    body: '{',
  });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.error.code, 'INVALID_JSON');
  assert.equal(typeof body.error.message, 'string');
});
