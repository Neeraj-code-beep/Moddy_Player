const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const mongoose = require('mongoose');
const appModule = require('../src/app');
const createApp = appModule.createApp;

const sessionId = '1a867ef3-05e9-40fb-930d-cc28cdf9a468';
const songId = new mongoose.Types.ObjectId().toString();
const events = [];
const quotaCounts = new Map();
const feedbackDatabaseDiagnostics = [];
let server;
let baseUrl;
let createFeedbackError;
let quotaError;

const songModel = {
  async exists({ _id }) { return _id.toString() === songId ? { _id } : null; },
  find() {
    const query = { sort: () => query, limit: () => query, async lean() { return []; } };
    return query;
  },
  async countDocuments() { return 0; },
};

const feedbackModel = {
  async countDocuments({ sessionId: requestedSessionId }) {
    return events.filter((event) => event.sessionId === requestedSessionId).length;
  },
  async create(event) {
    if (createFeedbackError) throw createFeedbackError;
    events.push(event);
    return event;
  },
};

const feedbackSessionQuotaModel = {
  async exists({ sessionId: requestedSessionId }) { return quotaCounts.has(requestedSessionId) ? { _id: requestedSessionId } : null; },
  async findOneAndUpdate(filter, update) {
    if (quotaError) throw quotaError;
    const current = quotaCounts.get(filter.sessionId) || 0;
    if (current >= filter.count.$lt) return null;
    const count = current + update[0].$set.count.$add[1];
    quotaCounts.set(filter.sessionId, count);
    return { sessionId: filter.sessionId, count, expiresAt: update[0].$set.expiresAt };
  },
};

before(async () => {
  server = createApp({
    songModel,
    feedbackModel,
    feedbackSessionQuotaModel,
    rateLimitConfig: { windowMs: 60_000, upload: 100, feedback: 100, recommendation: 100, catalog: 100, trustedProxyHops: 0 },
    isDatabaseReady: () => true,
    onFeedbackDatabaseError: (operation, error) => feedbackDatabaseDiagnostics.push({ operation, name: error.name }),
  }).listen(0, '127.0.0.1');
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

async function submit(body) {
  return fetch(`${baseUrl}/feedback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('records a validated session scoped feedback event without personal identifiers', async () => {
  events.length = 0;
  const response = await submit({ sessionId, songId, event: 'like', intention: 'cheer_up' });
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { message: 'Feedback recorded.' });
  assert.equal(events.length, 1);
  assert.equal(events[0].sessionId, sessionId);
  assert.equal(events[0].songId.toString(), songId);
  assert.equal(events[0].event, 'like');
  assert.equal(events[0].intention, 'cheer_up');
  assert.equal('email' in events[0], false);
  for (const event of ['dislike', 'skip', 'completed']) {
    const validEvent = await submit({ sessionId, songId, event, intention: 'match' });
    assert.equal(validEvent.status, 202);
  }
  assert.deepEqual(events.slice(1).map(({ event }) => event), ['dislike', 'skip', 'completed']);
});

test('rejects invalid event types, identifiers, intentions, and unexpected fields', async () => {
  const invalidBodies = [
    { sessionId, songId, event: 'played', intention: 'match' },
    { sessionId: 'not-a-uuid', songId, event: 'like', intention: 'match' },
    { sessionId, songId: 'invalid', event: 'like', intention: 'match' },
    { sessionId, songId, event: 'like', intention: 'personalize' },
    { sessionId, songId, event: 'like', intention: 'match', note: 'too much data' },
  ];
  for (const body of invalidBodies) {
    const response = await submit(body);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'INVALID_FEEDBACK');
  }
});

test('rejects feedback for missing songs and caps feedback per session', async () => {
  const missingSong = await submit({ sessionId, songId: new mongoose.Types.ObjectId().toString(), event: 'like', intention: 'match' });
  assert.equal(missingSong.status, 404);
  quotaCounts.set(sessionId, 500);
  const capped = await submit({ sessionId, songId, event: 'skip', intention: 'match' });
  quotaCounts.set(sessionId, 0);
  assert.equal(capped.status, 429);
  assert.equal((await capped.json()).error.code, 'FEEDBACK_LIMIT_REACHED');
});

test('parallel writes cannot reserve more than 500 feedback slots for one session', async () => {
  events.length = 0;
  quotaCounts.set(sessionId, 490);
  const responses = await Promise.all(Array.from({ length: 40 }, () =>
    submit({ sessionId, songId, event: 'skip', intention: 'match' })));
  const statuses = responses.map((response) => response.status);
  assert.equal(statuses.filter((status) => status === 202).length, 10);
  assert.equal(statuses.filter((status) => status === 429).length, 30);
  assert.equal(quotaCounts.get(sessionId), 500);
  assert.equal(events.length, 10);
  quotaCounts.set(sessionId, 0);
});

test('quota store errors fail safely before feedback persistence', async () => {
  quotaError = new Error('private database detail');
  try {
    const response = await submit({ sessionId, songId, event: 'like', intention: 'match' });
    const body = await response.json();
    assert.equal(response.status, 500);
    assert.equal(body.error.code, 'INTERNAL_ERROR');
    assert.equal(JSON.stringify(body).includes('private database detail'), false);
  } finally {
    quotaError = null;
  }
});

test('feedback database diagnostics identify the failing operation without changing the API error', async () => {
  const mongooseError = new mongoose.Error('buffering timed out');
  quotaError = mongooseError;
  feedbackDatabaseDiagnostics.length = 0;
  try {
    const response = await submit({ sessionId, songId, event: 'like', intention: 'match' });
    assert.equal(response.status, 500);
    assert.equal((await response.json()).error.code, 'INTERNAL_ERROR');
    assert.deepEqual(feedbackDatabaseDiagnostics, [
      { operation: 'feedbackSessionQuotaModel.findOneAndUpdate', name: 'MongooseError' },
    ]);
  } finally {
    quotaError = null;
  }
});

test('feedback persistence errors are safe and retain the quota reservation for an ambiguous write', async () => {
  events.length = 0;
  quotaCounts.set(sessionId, 0);
  createFeedbackError = new Error('private storage detail');
  try {
    const response = await submit({ sessionId, songId, event: 'dislike', intention: 'match' });
    const body = await response.json();
    assert.equal(response.status, 500);
    assert.equal(body.error.code, 'INTERNAL_ERROR');
    assert.equal(JSON.stringify(body).includes('private storage detail'), false);
    assert.equal(quotaCounts.get(sessionId), 1);
    assert.equal(events.length, 0);
  } finally {
    createFeedbackError = null;
  }
});
