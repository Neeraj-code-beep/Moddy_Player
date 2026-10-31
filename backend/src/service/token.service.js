const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

const TOKEN_ISSUER = 'moddy-player';
const TOKEN_AUDIENCE = 'moddy-player-api';

function createRefreshToken() {
  return crypto.randomBytes(48).toString('base64url');
}

function createCsrfToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashOpaqueToken(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function createAccessToken({ userId, familyId, role }, config, now = new Date()) {
  const issuedAt = Math.floor(now.getTime() / 1000);
  return jwt.sign({ role, sid: familyId, iat: issuedAt }, config.accessTokenSecret, {
    algorithm: 'HS256',
    audience: TOKEN_AUDIENCE,
    expiresIn: config.accessTokenTtlSeconds,
    issuer: TOKEN_ISSUER,
    subject: String(userId),
    jwtid: crypto.randomUUID(),
    noTimestamp: false,
    mutatePayload: false,
    header: { typ: 'JWT' },
    notBefore: 0,
  });
}

function verifyAccessToken(token, config, now = new Date()) {
  const claims = jwt.verify(token, config.accessTokenSecret, {
    algorithms: ['HS256'],
    audience: TOKEN_AUDIENCE,
    issuer: TOKEN_ISSUER,
    clockTimestamp: Math.floor(now.getTime() / 1000),
    clockTolerance: 5,
  });
  if (!claims || typeof claims !== 'object' || typeof claims.sub !== 'string' || typeof claims.sid !== 'string') {
    throw new Error('Invalid access token claims.');
  }
  return claims;
}

module.exports = {
  TOKEN_AUDIENCE,
  TOKEN_ISSUER,
  createAccessToken,
  createCsrfToken,
  createRefreshToken,
  hashOpaqueToken,
  verifyAccessToken,
};
