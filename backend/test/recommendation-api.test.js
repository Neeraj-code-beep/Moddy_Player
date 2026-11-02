const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { createApp } = require('../src/app');

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
      sort() { return query; },
      limit(value) { query.max = value; return query; },
      async lean() { return records.slice(0, query.max); },
    };
    return query;
  },
  async countDocuments() { return records.length; },
};

before(async () => {
  server = createApp({ songModel, isDatabaseReady: () => true }).listen(0, '127.0.0.1');
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
