const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { createApp } = require('../src/app');
const mongoose = require('mongoose');
const { createAccessToken } = require('../src/service/token.service');

const authConfig = { accessTokenSecret: 'test-secret-that-is-at-least-32-bytes-long', accessTokenTtlSeconds: 600, cookie: { refreshName: 'moddy_refresh', csrfName: 'moddy_csrf', path: '/auth', csrfPath: '/', sameSite: 'lax', secure: false }, refreshTtlDays: 30 };
const accountId = '507f1f77bcf86cd799439014';
const account = { _id: accountId, id: accountId, role: 'user', status: 'active' };
const accountToken = createAccessToken({ userId: accountId, familyId: 'b6c0f7cc-8c9d-4b1e-a9f2-30a6a6466ce6', role: 'user' }, authConfig);
const authSessionModel = {
  findOne(filter) {
    const value = String(filter.userId) === accountId && filter.familyId === 'b6c0f7cc-8c9d-4b1e-a9f2-30a6a6466ce6' && filter.status === 'active'
      ? { _id: 'active-session' }
      : null;
    return { select() { return this; }, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } };
  },
};
const favoriteRows = [];
const feedbackRows = [];

let server;
let baseUrl;
let records = [
  { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', title: 'Low', artist: 'Quiet', mood: 'sad', energy: 'low' },
  { _id: 'bbbbbbbbbbbbbbbbbbbbbbbb', title: 'Bright', artist: 'Bright', mood: 'happy', energy: 'high' },
];
let findError;
let lastFilter;

const songModel = {
  find(filter) {
    lastFilter = filter;
    if (findError) throw findError;
    const query = {
      select() { return query; },
      sort() { return query; },
      limit(value) { query.max = value; return query; },
      async lean() { return records.slice(0, query.max ?? records.length); },
    };
    return query;
  },
  async countDocuments() { return records.length; },
  async exists() { return true; },
};

const favoriteModel = {
  find(filter) { const rows = favoriteRows.filter((row) => String(row.userId) === String(filter.userId)); return { select: () => ({ lean: async () => rows }) }; },
};
const feedbackModel = {
  find(filter) { const rows = feedbackRows.filter((row) => String(row.userId) === String(filter.userId)); const query = { select: () => query, sort: () => query, limit: () => query, lean: async () => rows }; return query; },
  async countDocuments() { return 0; },
  async create(data) { feedbackRows.push(data); return data; },
};
const quotaModel = { async exists() { return true; }, async findOneAndUpdate() { return { count: 1 }; } };

before(async () => {
  server = createApp({ songModel, feedbackModel, feedbackSessionQuotaModel: quotaModel, favoriteModel, userModel: { async findById(id) { return id === accountId ? account : null; } }, authSessionModel, authConfig, isDatabaseReady: () => true }).listen(0, '127.0.0.1');
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

async function recommend(body) {
  return fetch(`${baseUrl}/recommendations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('recommendation API defaults intention, normalizes mood, and returns explainable results', async () => {
  const response = await recommend({ mood: ' SAD ', intention: 'match', limit: 1 });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.intention, 'match');
  assert.equal(body.normalizedMood, 'sad');
  assert.equal(body.recommendations.length, 1);
  assert.equal(body.recommendations[0].song.title, 'Low');
  assert.match(body.recommendations[0].reason, /matches the sad mood/);
  assert.equal(lastFilter.$and.length, 4);
  assert.equal(lastFilter.$and[0].$or[0].visibility, 'public');
  assert.equal(lastFilter.$and[1].$or[0].catalogStatus, 'approved');
  assert.deepEqual(lastFilter.$and[2].$or[0].uploadSource.$in, ['admin', 'legacy']);
  assert.equal(lastFilter.$and[3].$or[0].mediaStatus, 'active');
  const legacyGate = lastFilter.$and[0].$or[1];
  assert.equal(legacyGate.ownerId.$exists, false);
  assert.equal(legacyGate.uploadedBy.$exists, false);
});

test('recommendation API accepts omitted mood and rejects invalid intentions and extra fields', async () => {
  const noMood = await recommend({ intention: 'surprise' });
  assert.equal(noMood.status, 200);
  assert.equal((await noMood.json()).normalizedMood, null);
  const unknownMood = await recommend({ mood: 'legacy-custom-label', intention: 'match' });
  assert.equal(unknownMood.status, 200);
  assert.equal((await unknownMood.json()).normalizedMood, null);
  for (const body of [{ intention: 'invented' }, { intention: 'match', debugScore: 999 }]) {
    const response = await recommend(body);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'INVALID_RECOMMENDATION_REQUEST');
  }
});

test('recommendation API handles empty catalogs and safely reports database failures', async () => {
  const originalRecords = records;
  records = [];
  const empty = await recommend({ intention: 'calm_down' });
  assert.deepEqual((await empty.json()).recommendations, []);
  records = originalRecords;

  findError = new Error('private database detail');
  try {
    const response = await recommend({ intention: 'match' });
    const body = await response.json();
    assert.equal(response.status, 500);
    assert.equal(body.error.code, 'INTERNAL_ERROR');
    assert.equal(JSON.stringify(body).includes('private database detail'), false);
  } finally {
    findError = null;
  }
});

test('authenticated recommendations use favorite metadata and feedback is attributed to the authenticated account', async () => {
  const likedId = '507f1f77bcf86cd799439015';
  favoriteRows.splice(0, favoriteRows.length, { userId: accountId, songId: new mongoose.Types.ObjectId(likedId) });
  feedbackRows.splice(0, feedbackRows.length);
  records = [
    { _id: likedId, title: 'Jazz favorite match', artist: 'A', mood: 'romantic', genre: 'jazz' },
    { _id: '507f1f77bcf86cd799439016', title: 'Pop track', artist: 'B', mood: 'happy', genre: 'pop' },
  ];
  const response = await fetch(`${baseUrl}/recommendations`, {
    method: 'POST', headers: { authorization: `Bearer ${accountToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ mood: 'romantic', intention: 'match', limit: 2 }),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.match(body.recommendations[0].reason, /favorites/);

  const feedbackResponse = await fetch(`${baseUrl}/feedback`, {
    method: 'POST', headers: { authorization: `Bearer ${accountToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'b6c0f7cc-8c9d-4b1e-a9f2-30a6a6466ce6', songId: likedId, event: 'like', intention: 'match' }),
  });
  assert.equal(feedbackResponse.status, 202);
  assert.equal(String(feedbackRows[0].userId), accountId);
});
