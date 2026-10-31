const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { test } = require('node:test');
const { createAuthService } = require('../src/service/auth.service');
const { hashOpaqueToken, verifyAccessToken } = require('../src/service/token.service');

const config = { accessTokenSecret: 'service-test-secret-with-at-least-thirty-two-bytes', accessTokenTtlSeconds: 600, refreshTtlDays: 30 };
const userId = new mongoose.Types.ObjectId();
const familyId = '9128312d-9206-42ac-bf80-4774fbcbb1a0';
const rawRefreshToken = 'r'.repeat(64);
const user = { _id: userId, id: String(userId), name: 'Test User', email: 'test@example.test', role: 'user', status: 'active' };

function fixture({ rotationConflict = false } = {}) {
  const current = {
    _id: new mongoose.Types.ObjectId(), userId, familyId, tokenHash: hashOpaqueToken(rawRefreshToken),
    status: 'active', revokedAt: null, expiresAt: new Date(Date.now() + 60_000),
  };
  const sessions = [current];
  const calls = { update: null, created: [], ended: 0, transaction: 0 };
  const sessionModel = {
    async findOne(filter) { return sessions.find((item) => item.tokenHash === filter.tokenHash) || null; },
    async findOneAndUpdate(filter, update, options) {
      calls.update = { filter, update, options };
      if (rotationConflict) { current.status = 'rotated'; return null; }
      Object.assign(current, update.$set);
      return current;
    },
    async create(items, options) { calls.created.push(...items); sessions.push(...items); calls.createOptions = options; return items; },
    async updateMany(filter, update) {
      let modifiedCount = 0;
      for (const session of sessions) {
        if (String(session.userId) === String(filter.userId) && session.familyId === filter.familyId && session.status !== 'revoked') {
          Object.assign(session, update.$set); modifiedCount += 1;
        }
      }
      return { modifiedCount };
    },
  };
  const service = createAuthService({
    userModel: { async findById() { return user; } },
    sessionModel,
    configProvider: () => config,
    mongo: { async startSession() { return {
      async withTransaction(callback) { calls.transaction += 1; return callback(); },
      async endSession() { calls.ended += 1; },
    }; } },
  });
  return { calls, current, service, sessions };
}

test('refresh atomically rotates the stored hash inside one transaction', async () => {
  const { calls, current, service, sessions } = fixture();
  const result = await service.refresh(rawRefreshToken);
  assert.equal(current.status, 'rotated');
  assert.equal(calls.transaction, 1);
  assert.equal(calls.ended, 1);
  assert.equal(calls.update.filter.tokenHash, hashOpaqueToken(rawRefreshToken));
  assert.equal(calls.update.filter.status, 'active');
  assert.equal(calls.update.options.new, true);
  assert.ok(calls.update.options.session);
  assert.equal(calls.created.length, 1);
  assert.equal(calls.created[0].status, 'active');
  assert.equal(calls.created[0].tokenHash, hashOpaqueToken(result.refreshToken));
  assert.notEqual(calls.created[0].tokenHash, result.refreshToken);
  assert.equal(sessions.length, 2);
  assert.equal(verifyAccessToken(result.accessToken, config).sub, String(userId));
  assert.equal(result.user.passwordHash, undefined);
});

test('reuse of a rotated refresh token revokes its family', async () => {
  const { current, service } = fixture();
  current.status = 'rotated';
  await assert.rejects(service.refresh(rawRefreshToken), (error) => error.status === 401 && error.code === 'AUTH_INVALID_SESSION');
  assert.equal(current.status, 'revoked');
});

test('simultaneous refresh conflict revokes the compromised family and ends its session', async () => {
  const { calls, current, service } = fixture({ rotationConflict: true });
  await assert.rejects(service.refresh(rawRefreshToken), (error) => error.status === 401 && error.code === 'AUTH_INVALID_SESSION');
  assert.equal(calls.transaction, 1);
  assert.equal(calls.ended, 1);
  assert.equal(current.status, 'revoked');
});
