const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const createApp = require('../src/app').createApp;
const getCorsOrigins = require('../src/app').getCorsOrigins;
const getUploadLimitBytes = require('../src/routes/song.routes').getUploadLimitBytes;

const validAudio = Buffer.from('RIFF0000WAVE');
const audioFields = { title: '  Test Song  ', artist: '  Test Artist ', mood: ' happy ' };

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
    headers: { 'content-type': `multipart/form-data; boundary=${multipart.boundary}` },
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
  app = createApp({
    songModel: model,
    uploadLimitBytes: 1024,
    uploadFile: async (file, fileName) => {
      uploadCalls.push({ file, fileName });
      return { fileId: 'provider-file-1', url: 'https://ik.example.invalid/songs/provider-file-1' };
    },
    deleteFile: async (fileId) => deleteCalls.push(fileId),
    isDatabaseReady: () => true,
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

test('upload size configuration defaults to 25 MiB and rejects unreasonable values', () => {
  assert.equal(getUploadLimitBytes(''), 25 * 1024 * 1024);
  assert.equal(getUploadLimitBytes('1048576'), 1024 * 1024);
  assert.throws(() => getUploadLimitBytes('0'), /between 1 byte and 100 MiB/);
  assert.throws(() => getUploadLimitBytes('104857601'), /between 1 byte and 100 MiB/);
});

test('readiness reports unavailable database state as not ready', async () => {
  const notReadyApp = createApp({ isDatabaseReady: () => false });
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
  assert.deepEqual([...getCorsOrigins('')], ['http://localhost:5173', 'http://127.0.0.1:5173']);
  assert.deepEqual([...getCorsOrigins('https://player.example.com, https://admin.example.com')], [
    'https://player.example.com',
    'https://admin.example.com',
  ]);
  const corsApp = createApp({
    corsOrigins: new Set(['http://localhost:5173']),
    isDatabaseReady: () => true,
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
  assert.match(uploadCalls.at(-1).fileName, /^[0-9a-f-]{36}\.wav$/i);
  assert.equal(body.song.fileId, undefined);
});

test('upload rejects whitespace-only metadata before provider upload', async () => {
  const callsBefore = uploadCalls.length;
  const response = await sendUpload(baseUrl, { ...audioFields, title: '   ' });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error.code, 'INVALID_METADATA');
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
  const wrongMime = await sendUpload(baseUrl, audioFields, { name: 'track.wav', type: 'text/plain', data: validAudio });
  assert.equal(wrongMime.status, 415);
  assert.equal((await wrongMime.json()).error.code, 'UNSUPPORTED_AUDIO_TYPE');

  const wrongSignature = await sendUpload(baseUrl, audioFields, { name: 'track.wav', type: 'audio/wav', data: Buffer.from('not audio') });
  assert.equal(wrongSignature.status, 415);
  assert.equal((await wrongSignature.json()).error.code, 'INVALID_AUDIO_FILE');
});

test('upload rejects an unexpected file field', async () => {
  const boundary = 'moddy-extra-field';
  const body = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="cover"; filename="cover.wav"\r\nContent-Type: audio/wav\r\n\r\nRIFF0000WAVE\r\n--${boundary}--\r\n`);
  const response = await fetch(`${baseUrl}/songs`, {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    body,
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'INVALID_MULTIPART');
});

test('malformed multipart requests return a controlled client error', async () => {
  const response = await fetch(`${baseUrl}/songs`, {
    method: 'POST',
    headers: { 'content-type': 'multipart/form-data; boundary=unfinished' },
    body: '--unfinished\r\nContent-Disposition: form-data; name="title"\r\n',
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'INVALID_MULTIPART');
});

test('upload enforces the configured size limit', async () => {
  const oversized = Buffer.concat([validAudio, Buffer.alloc(1024)]);
  const response = await sendUpload(baseUrl, audioFields, { name: 'track.wav', type: 'audio/wav', data: oversized });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, 'UPLOAD_TOO_LARGE');
});

test('upload concurrency cap rejects a second in-progress upload before provider submission', async () => {
  let providerCalls = 0;
  let notifyProviderStarted;
  const providerStarted = new Promise((resolve) => { notifyProviderStarted = resolve; });
  let releaseProvider;
  const providerGate = new Promise((resolve) => { releaseProvider = resolve; });
  const limitedApp = createApp({
    songModel: model,
    uploadLimitBytes: 1024,
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
  const failingApp = createApp({
    songModel: model,
    uploadFile: async () => { throw new Error('provider secret detail'); },
    deleteFile: async () => {},
    uploadLimitBytes: 1024,
    isDatabaseReady: () => true,
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
  const failingApp = createApp({
    songModel: createSongModel({ createError: new Error('database detail') }),
    uploadFile: async () => ({ fileId: 'orphan-candidate', url: 'https://ik.example.invalid/audio' }),
    deleteFile: async (fileId) => deleteCalls.push(fileId),
    uploadLimitBytes: 1024,
    isDatabaseReady: () => true,
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

test('song retrieval applies mood filtering and default pagination', async () => {
  const response = await fetch(`${baseUrl}/songs?mood=happy`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(model.calls.filters.at(-1), { mood: 'happy' });
  assert.deepEqual(body.pagination, { page: 1, limit: 50, total: 2, totalPages: 1 });
  assert.equal(body.songs.length, 2);
});

test('song retrieval treats a missing or empty mood as an unfiltered catalog query', async () => {
  const response = await fetch(`${baseUrl}/songs?mood=&page=1&limit=2`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(model.calls.filters.at(-1), {});
  assert.deepEqual(body.pagination, { page: 1, limit: 2, total: 3, totalPages: 2 });
  assert.equal(body.songs.length, 2);
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
  const queryFailureApp = createApp({
    songModel: createSongModel({ findError: new Error('database details must stay private') }),
    isDatabaseReady: () => true,
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
    headers: { 'content-type': 'application/json' },
    body: '{',
  });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.error.code, 'INVALID_JSON');
  assert.equal(typeof body.error.message, 'string');
});
