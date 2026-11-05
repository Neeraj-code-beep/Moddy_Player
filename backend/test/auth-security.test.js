const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');
const argon2 = require('argon2');
const { getAuthConfig } = require('../src/config/auth');
const User = require('../src/models/user.model');
const AuthSession = require('../src/models/auth-session.model');
const Song = require('../src/models/song.model');
const { hashPassword, validatePassword, verifyPassword } = require('../src/service/password.service');
const { createAccessToken, createCsrfToken, createRefreshToken, hashOpaqueToken, verifyAccessToken } = require('../src/service/token.service');

const validPassword = 'Moddy_Player_2026!';

test('password policy rejects weak inputs and permits a strong passphrase', () => {
  for (const password of ['', 'short', 'longpassword123!', 'ALLUPPERCASE123!', 'NoDigits!abcdefgh']) {
    assert.ok(validatePassword(password).error, `expected rejection for ${password}`);
  }
  assert.deepEqual(validatePassword(validPassword), { value: validPassword });
  assert.ok(validatePassword('x'.repeat(129)).error);
});

test('password hashing uses Argon2id and verifies without storing plaintext', async () => {
  const passwordHash = await hashPassword(validPassword);
  assert.match(passwordHash, /^\$argon2id\$/);
  assert.notEqual(passwordHash, validPassword);
  assert.equal(await verifyPassword(passwordHash, validPassword), true);
  assert.equal(await verifyPassword(passwordHash, 'Another_wrong_2026!'), false);
  assert.equal(await verifyPassword('invalid hash', validPassword), false);
});

test('user schema normalizes email, enforces role and status enums, and hides password hashes', async () => {
  const user = new User({
    name: '  Moddy User  ',
    email: '  USER@Example.com  ',
    passwordHash: 'argon-hash-never-return-this',
  });
  await user.validate();
  assert.equal(user.name, 'Moddy User');
  assert.equal(user.email, 'user@example.com');
  assert.equal(user.role, 'user');
  assert.equal(user.status, 'active');
  assert.equal(user.toJSON().passwordHash, undefined);
  assert.equal(User.schema.path('passwordHash').options.select, false);
  assert.ok(User.schema.indexes().some(([fields, options]) => fields.email === 1 && options.unique === true));

  user.role = 'owner';
  await assert.rejects(user.validate(), /role/);
});

test('refresh sessions store token hashes with unique lookup and expiry indexes', () => {
  assert.equal(AuthSession.schema.path('tokenHash').options.select, false);
  assert.ok(AuthSession.schema.indexes().some(([fields, options]) => fields.tokenHash === 1 && options.unique === true));
  assert.ok(AuthSession.schema.indexes().some(([fields, options]) => fields.expiresAt === 1 && options.expireAfterSeconds === 0));
  assert.equal(AuthSession.schema.path('status').enumValues.join(','), 'active,rotated,revoked');
});

test('songs default to private and keep ownership metadata out of normal query results', async () => {
  const song = new Song({ title: 'Test', artist: 'Artist', audio: 'https://audio.example.test/file', mood: 'happy' });
  await song.validate();
  assert.equal(song.visibility, 'private');
  assert.equal(Song.schema.path('ownerId').options.select, false);
  assert.ok(Song.schema.path('ownerId').options.index);
  song.visibility = 'unknown';
  await assert.rejects(song.validate(), /visibility/);
});

test('auth configuration fails closed and validates cookie and token settings', () => {
  assert.throws(() => getAuthConfig({}), /AUTH_ACCESS_TOKEN_SECRET/);
  const accessTokenSecret = crypto.randomBytes(32).toString('base64url');
  const config = getAuthConfig({ AUTH_ACCESS_TOKEN_SECRET: accessTokenSecret, NODE_ENV: 'test' });
  assert.equal(config.accessTokenTtlSeconds, 600);
  assert.equal(config.refreshTtlDays, 30);
  assert.equal(config.cookie.sameSite, 'lax');
  assert.equal(config.cookie.secure, false);
  assert.throws(() => getAuthConfig({ AUTH_ACCESS_TOKEN_SECRET: 'short', NODE_ENV: 'test' }), /at least 32 bytes/);
  assert.throws(() => getAuthConfig({
    AUTH_ACCESS_TOKEN_SECRET: accessTokenSecret,
    AUTH_COOKIE_SECURE: 'false',
    NODE_ENV: 'production',
  }), /must be true in production/);
  assert.throws(() => getAuthConfig({
    AUTH_ACCESS_TOKEN_SECRET: accessTokenSecret,
    AUTH_COOKIE_SAME_SITE: 'none',
    NODE_ENV: 'test',
  }), /when AUTH_COOKIE_SAME_SITE is none/);
  assert.throws(() => getAuthConfig({
    AUTH_ACCESS_TOKEN_SECRET: accessTokenSecret,
    AUTH_ACCESS_TOKEN_TTL_SECONDS: '1',
    NODE_ENV: 'test',
  }), /between 60 and 3600/);
});

test('access tokens are short-lived and pinned to the expected issuer, audience, and algorithm', () => {
  const accessTokenSecret = crypto.randomBytes(32).toString('base64url');
  const config = { accessTokenSecret, accessTokenTtlSeconds: 600 };
  const now = new Date('2026-10-30T00:00:00.000Z');
  const token = createAccessToken({ userId: '507f1f77bcf86cd799439011', familyId: crypto.randomUUID(), role: 'user' }, config, now);
  const claims = verifyAccessToken(token, config, now);
  assert.equal(claims.sub, '507f1f77bcf86cd799439011');
  assert.equal(claims.iss, 'moddy-player');
  assert.equal(claims.aud, 'moddy-player-api');
  assert.equal(claims.exp - claims.iat, 600);
  assert.throws(() => verifyAccessToken(token, config, new Date(now.getTime() + 700_000)), /expired/);
  const refreshToken = createRefreshToken();
  assert.equal(refreshToken.length, 64);
  assert.equal(hashOpaqueToken(refreshToken).length, 64);
  assert.notEqual(hashOpaqueToken(refreshToken), refreshToken);
  assert.equal(createCsrfToken().length, 43);
});
