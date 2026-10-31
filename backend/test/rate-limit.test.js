const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { createApp } = require('../src/app');
const { getRateLimitConfig, InMemoryRateLimitStore } = require('../src/middleware/rate-limit');

let server;
let baseUrl;

const songModel = {
  find() {
    const query = { sort: () => query, skip: () => query, limit: () => query, async lean() { return []; } };
    return query;
  },
  async countDocuments() { return 0; },
};

before(async () => {
  const app = createApp({
    songModel,
    isDatabaseReady: () => false,
    rateLimitConfig: {
      windowMs: 60_000,
      upload: 1,
      feedback: 1,
      recommendation: 1,
      catalog: 1,
      trustedProxyHops: 0,
    },
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

test('rate limit returns a consistent 429 with reset and retry headers', async () => {
  const first = await fetch(`${baseUrl}/songs`);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('ratelimit-limit'), '1');
  assert.equal(first.headers.get('ratelimit-remaining'), '0');

  const blocked = await fetch(`${baseUrl}/songs`);
  const body = await blocked.json();
  assert.equal(blocked.status, 429);
  assert.deepEqual(body.error, {
    code: 'RATE_LIMITED',
    message: 'Too many requests. Please retry after the current limit window.',
  });
  assert.equal(blocked.headers.get('ratelimit-limit'), '1');
  assert.equal(blocked.headers.get('ratelimit-remaining'), '0');
  assert.ok(Number(blocked.headers.get('ratelimit-reset')) >= 0);
  assert.ok(Number(blocked.headers.get('retry-after')) >= 1);
});

test('limits are scoped by endpoint and forwarded IP is ignored by default', async () => {
  let capturedKey;
  const app = createApp({
    songModel,
    rateLimitConfig: { windowMs: 60_000, upload: 1, feedback: 1, recommendation: 1, catalog: 1, trustedProxyHops: 0 },
    rateLimitStore: { async consume(key) { capturedKey = key; return { count: 1, resetAt: Date.now() + 60_000 }; } },
    isDatabaseReady: () => true,
  });
  const testServer = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => testServer.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${testServer.address().port}/songs`, {
      headers: { 'X-Forwarded-For': '203.0.113.99' },
    });
    assert.equal(response.status, 200);
    assert.match(capturedKey, /^catalog:127\.0\.0\.1$/);
    assert.equal(app.get('trust proxy'), false);
  } finally {
    testServer.closeAllConnections();
    await new Promise((resolve, reject) => testServer.close((error) => error ? reject(error) : resolve()));
  }
});

test('trusted proxy hop count controls the client IP used by the store', async () => {
  let capturedKey;
  const app = createApp({
    songModel,
    rateLimitConfig: { windowMs: 60_000, upload: 1, feedback: 1, recommendation: 1, catalog: 1, trustedProxyHops: 1 },
    rateLimitStore: { async consume(key) { capturedKey = key; return { count: 1, resetAt: Date.now() + 60_000 }; } },
    isDatabaseReady: () => true,
  });
  const testServer = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => testServer.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${testServer.address().port}/songs`, {
      headers: { 'X-Forwarded-For': '198.51.100.40' },
    });
    assert.equal(response.status, 200);
    assert.equal(capturedKey, 'catalog:198.51.100.40');
    assert.equal(app.get('trust proxy'), 1);
  } finally {
    testServer.closeAllConnections();
    await new Promise((resolve, reject) => testServer.close((error) => error ? reject(error) : resolve()));
  }
});

test('two apps share one injected store to enforce a combined limit', async () => {
  const buckets = new Map();
  const sharedStore = {
    async consume(key, windowMs) {
      const now = Date.now();
      const windowStart = Math.floor(now / windowMs) * windowMs;
      const bucketKey = `${key}:${windowStart}`;
      const current = buckets.get(bucketKey) || { count: 0, resetAt: windowStart + windowMs };
      current.count += 1;
      buckets.set(bucketKey, current);
      return current;
    },
  };
  const makeApp = () => createApp({
    songModel,
    rateLimitConfig: { windowMs: 60_000, upload: 1, feedback: 1, recommendation: 1, catalog: 1, trustedProxyHops: 0 },
    rateLimitStore: sharedStore,
  });
  const servers = [makeApp().listen(0, '127.0.0.1'), makeApp().listen(0, '127.0.0.1')];
  await Promise.all(servers.map((testServer) => new Promise((resolve) => testServer.once('listening', resolve))));
  try {
    const first = await fetch(`http://127.0.0.1:${servers[0].address().port}/songs`);
    const second = await fetch(`http://127.0.0.1:${servers[1].address().port}/songs`);
    assert.equal(first.status, 200);
    assert.equal(second.status, 429);
  } finally {
    for (const testServer of servers) testServer.closeAllConnections();
    await Promise.all(servers.map((testServer) => new Promise((resolve, reject) => testServer.close((error) => error ? reject(error) : resolve()))));
  }
});

test('rate limit store failures fail closed with a safe service response', async () => {
  const app = createApp({
    songModel,
    rateLimitConfig: { windowMs: 60_000, upload: 1, feedback: 1, recommendation: 1, catalog: 1, trustedProxyHops: 0 },
    rateLimitStore: { async consume() { throw new Error('private store endpoint'); } },
  });
  const testServer = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => testServer.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${testServer.address().port}/songs`);
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.deepEqual(body.error, {
      code: 'RATE_LIMITER_UNAVAILABLE',
      message: 'Request protection is temporarily unavailable.',
    });
    assert.equal(JSON.stringify(body).includes('private store endpoint'), false);
  } finally {
    testServer.closeAllConnections();
    await new Promise((resolve, reject) => testServer.close((error) => error ? reject(error) : resolve()));
  }
});

test('liveness stays healthy during database outage while readiness reports not ready', async () => {
  const live = await fetch(`${baseUrl}/live`);
  const readiness = await fetch(`${baseUrl}/health`);
  assert.equal(live.status, 200);
  assert.deepEqual(await live.json(), { status: 'live' });
  assert.equal(readiness.status, 503);
  assert.deepEqual(await readiness.json(), { status: 'not_ready' });
  assert.equal(live.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(live.headers.get('x-frame-options'), 'DENY');
  assert.equal(live.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
});

test('rate limit environment configuration is bounded and the memory store prunes expired keys', async () => {
  assert.deepEqual(getRateLimitConfig({}), {
    windowMs: 60_000,
    upload: 3,
    feedback: 30,
    recommendation: 60,
    catalog: 120,
    register: 5,
    login: 10,
    refresh: 30,
    password: 5,
    profile: 30,
    trustedProxyHops: 0,
  });
  assert.throws(() => getRateLimitConfig({ RATE_LIMIT_WINDOW_MS: '999' }), /between 1000 and 3600000/);
  assert.throws(() => getRateLimitConfig({ TRUSTED_PROXY_HOPS: 'true' }), /between 0 and 10/);

  let now = 1_000;
  const store = new InMemoryRateLimitStore({ maxEntries: 1, now: () => now });
  assert.equal((await store.consume('catalog:one', 1_000)).count, 1);
  await assert.rejects(store.consume('catalog:two', 1_000), /capacity reached/);
  now = 2_000;
  assert.equal((await store.consume('catalog:two', 1_000)).count, 1);
  assert.equal(store.entries.size, 1);
});
