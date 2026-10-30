const assert = require('node:assert/strict');
const { test } = require('node:test');
const feedbackModel = require('../src/models/feedback.model');
const quotaModel = require('../src/models/feedback-session-quota.model');
const { FEEDBACK_RETENTION_MS, FEEDBACK_SESSION_LIMIT, reserveFeedbackSlot } = require('../src/service/feedback-quota.service');

test('feedback quota uses one atomic pipeline assignment for first writes and rolling expiry', async () => {
  const now = new Date('2026-10-24T00:00:00Z');
  let args;
  const result = await reserveFeedbackSlot({
    async findOneAndUpdate(...values) {
      args = values;
      return { count: 10 };
    },
  }, '1a867ef3-05e9-40fb-930d-cc28cdf9a468', now);

  assert.equal(result.count, 10);
  assert.deepEqual(args[0], {
    sessionId: '1a867ef3-05e9-40fb-930d-cc28cdf9a468',
    count: { $lt: FEEDBACK_SESSION_LIMIT },
  });
  assert.deepEqual(args[1], [{
    $set: {
      sessionId: { $ifNull: ['$sessionId', '1a867ef3-05e9-40fb-930d-cc28cdf9a468'] },
      count: { $add: [{ $ifNull: ['$count', 0] }, 1] },
      expiresAt: new Date(now.getTime() + FEEDBACK_RETENTION_MS),
    },
  }]);
  assert.deepEqual(args[2], { new: true, upsert: true, updatePipeline: true });
});

test('legacy feedback count seeds the first quota reservation and full legacy sessions are rejected', async () => {
  let insertedCount;
  const quotaStore = {
    async findOneAndUpdate(_filter, update) {
      insertedCount = update[0].$set.count.$add[0].$ifNull[1];
      return { count: insertedCount + 1 };
    },
  };
  const reservation = await reserveFeedbackSlot(quotaStore, '1a867ef3-05e9-40fb-930d-cc28cdf9a468', new Date(), 499);
  assert.equal(insertedCount, 499);
  assert.equal(reservation.count, 500);
  assert.equal(await reserveFeedbackSlot(quotaStore, '1a867ef3-05e9-40fb-930d-cc28cdf9a468', new Date(), 500), null);
});

test('first quota reservation does not update count through conflicting MongoDB operators', async () => {
  let updatePipeline;
  await reserveFeedbackSlot({
    async findOneAndUpdate(_filter, update) {
      updatePipeline = update;
      return { count: 1 };
    },
  }, '1a867ef3-05e9-40fb-930d-cc28cdf9a468');

  assert.equal(Array.isArray(updatePipeline), true);
  assert.deepEqual(Object.keys(updatePipeline[0].$set), ['sessionId', 'count', 'expiresAt']);
  assert.deepEqual(updatePipeline[0].$set.count, { $add: [{ $ifNull: ['$count', 0] }, 1] });
});

test('concurrent first-session upsert duplicate retries atomically without another insert', async () => {
  const calls = [];
  const quotaStore = {
    async findOneAndUpdate(_filter, _update, options) {
      calls.push(options);
      if (calls.length === 1) throw Object.assign(new Error('duplicate key'), { code: 11000 });
      return null;
    },
  };
  const result = await reserveFeedbackSlot(quotaStore, '1a867ef3-05e9-40fb-930d-cc28cdf9a468');
  assert.equal(result, null);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].upsert, true);
  assert.equal(calls[0].updatePipeline, true);
  assert.equal(calls[1].upsert, false);
  assert.equal(calls[1].updatePipeline, true);
});

test('feedback and quota schemas declare their TTL and uniqueness indexes', () => {
  const feedbackIndexes = feedbackModel.schema.indexes();
  assert.ok(feedbackIndexes.some(([keys, options]) => keys.createdAt === 1 && options.expireAfterSeconds === 7_776_000));

  const quotaIndexes = quotaModel.schema.indexes();
  assert.ok(quotaIndexes.some(([keys, options]) => keys.sessionId === 1 && options.unique === true));
  assert.ok(quotaIndexes.some(([keys, options]) => keys.expiresAt === 1 && options.expireAfterSeconds === 0));
});

test('quota database failures propagate without exposing implementation details at the API layer', async () => {
  const privateError = new Error('private storage failure');
  await assert.rejects(reserveFeedbackSlot({ async findOneAndUpdate() { throw privateError; } }, '1a867ef3-05e9-40fb-930d-cc28cdf9a468'), (error) => error === privateError);
});
