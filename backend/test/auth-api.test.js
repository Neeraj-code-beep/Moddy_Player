const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { createApp } = require('../src/app');
const { createAccessToken } = require('../src/service/token.service');

const config = {
  accessTokenSecret: 'api-test-secret-with-at-least-thirty-two-bytes',
  accessTokenTtlSeconds: 600,
  refreshTtlDays: 30,
  cookie: { refreshName: 'moddy_refresh', csrfName: 'moddy_csrf', path: '/auth', csrfPath: '/', sameSite: 'lax', secure: false },
};
const userId = '507f1f77bcf86cd799439013';
const users = new Map();
const sessions = [];
let failSessionCreation = false;

function query(value) {
  return { select() { return this; }, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } };
}

const userModel = {
  findOne(filter) { return query([...users.values()].find((user) => user.email === filter.email) || null); },
  findById(id) { return Promise.resolve(users.get(String(id)) || null); },
  async create(data) {
    const records = Array.isArray(data) ? data : [data];
    const created = records.map((record) => ({
      _id: userId, id: userId, ...record, role: record.role || 'user', status: 'active', bio: '', avatarUrl: null,
      toObject() { return { ...this }; },
      async save() { users.set(String(this._id), this); return this; },
    }));
    for (const user of created) users.set(String(user._id), user);
    return Array.isArray(data) ? created : created[0];
  },
};
const sessionModel = {
  async create(data) {
    if (failSessionCreation) throw new Error('Injected session write failure.');
    const records = Array.isArray(data) ? data : [data];
    sessions.push(...records);
    return Array.isArray(data) ? records : records[0];
  },
  findOne(filter) {
    const value = sessions.find((session) => filter.tokenHash
      ? session.tokenHash === filter.tokenHash
      : String(session.userId) === String(filter.userId) && session.familyId === filter.familyId &&
        session.status === filter.status && session.expiresAt > filter.expiresAt.$gt) || null;
    return { select() { return this; }, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } };
  },
  async updateMany(filter, update) {
    let modifiedCount = 0;
    for (const session of sessions) {
      const familyMatches = !filter.familyId || (filter.familyId.$ne ? session.familyId !== filter.familyId.$ne : session.familyId === filter.familyId);
      if (session.userId === filter.userId && familyMatches && session.status !== 'revoked') {
        Object.assign(session, update.$set);
        modifiedCount += 1;
      }
    }
    return { modifiedCount };
  },
};
const fakeMongo = {
  async startSession() {
    return {
      async withTransaction(callback) {
        const userSnapshot = new Map(users);
        const sessionSnapshot = sessions.slice();
        try {
          return await callback();
        } catch (error) {
          users.clear();
          for (const [key, value] of userSnapshot) users.set(key, value);
          sessions.splice(0, sessions.length, ...sessionSnapshot);
          throw error;
        }
      },
      async endSession() {},
    };
  },
};

let server;
let baseUrl;
before(async () => {
  users.clear(); sessions.length = 0;
  const app = createApp({ userModel, authSessionModel: sessionModel, authConfig: config, mongo: fakeMongo, corsOrigins: new Set(['http://localhost:5173']), isDatabaseReady: () => true });
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test('registration creates a user role, returns a short-lived access token, and issues scoped cookies', async () => {
  const response = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Moddy User', email: ' USER@example.test ', password: 'Moddy_Player_2026!' }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
  const data = await response.json();
  assert.equal(data.user.role, 'user');
  assert.equal(data.user.email, 'user@example.test');
  assert.equal(data.user.passwordHash, undefined);
  assert.equal(users.get(userId).role, 'user');
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].tokenHash.length, 64);
  assert.notEqual(sessions[0].tokenHash, response.headers.getSetCookie().find((cookie) => cookie.startsWith('moddy_refresh=')).split(';')[0].slice('moddy_refresh='.length));
  assert.ok(data.accessToken);
  const cookies = response.headers.getSetCookie();
  assert.ok(cookies.some((cookie) => cookie.startsWith('moddy_refresh=') && cookie.includes('HttpOnly') && cookie.includes('Path=/auth')));
  assert.ok(cookies.some((cookie) => cookie.startsWith('moddy_csrf=') && !cookie.includes('HttpOnly') && cookie.includes('Path=/')));
  const duplicate = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST', headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Moddy User', email: 'user@example.test', password: 'Moddy_Player_2026!' }),
  });
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).error.code, 'AUTH_REGISTRATION_UNAVAILABLE');
});

test('issued bearer token authorizes current-user endpoint and rejects a disabled account', async () => {
  const token = createAccessToken({ userId, familyId: sessions.find((session) => session.status === 'active').familyId, role: 'user' }, config);
  const success = await fetch(`${baseUrl}/auth/me`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(success.status, 200);
  const user = await success.json();
  assert.equal(user.user.email, 'user@example.test');
  assert.equal(user.user.passwordHash, undefined);
  users.get(userId).status = 'disabled';
  const denied = await fetch(`${baseUrl}/auth/me`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(denied.status, 401);
  const disabledLogin = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST', headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'user@example.test', password: 'Moddy_Player_2026!' }),
  });
  assert.equal(disabledLogin.status, 401);
  assert.equal((await disabledLogin.json()).error.code, 'AUTH_INVALID_CREDENTIALS');
});

test('profile updates accept only safe fields and logout-all revokes user sessions', async () => {
  users.get(userId).status = 'active';
  const token = createAccessToken({ userId, familyId: sessions.find((session) => session.status === 'active').familyId, role: 'user' }, config);
  const updated = await fetch(`${baseUrl}/users/me`, {
    method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Updated User', bio: 'A short bio' }),
  });
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).user.name, 'Updated User');
  const escalated = await fetch(`${baseUrl}/users/me`, {
    method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ role: 'admin' }),
  });
  assert.equal(escalated.status, 400);
  const logoutAll = await fetch(`${baseUrl}/auth/logout-all`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, origin: 'http://localhost:5173', cookie: 'moddy_csrf=test-token', 'x-csrf-token': 'test-token' },
  });
  assert.equal(logoutAll.status, 204);
  assert.ok(sessions.every((session) => session.status === 'revoked'));
});

test('login verifies stored Argon2 credentials and logout requires the double-submit CSRF token', async () => {
  users.get(userId).status = 'active';
  const login = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST', headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'user@example.test', password: 'Moddy_Player_2026!' }),
  });
  assert.equal(login.status, 200);
  const incorrect = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST', headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'user@example.test', password: 'Wrong_Password_2026!' }),
  });
  assert.equal(incorrect.status, 401);
  assert.equal((await incorrect.json()).error.code, 'AUTH_INVALID_CREDENTIALS');
  const cookieHeaders = login.headers.getSetCookie();
  const refresh = cookieHeaders.find((cookie) => cookie.startsWith('moddy_refresh=')).split(';')[0];
  const csrf = cookieHeaders.find((cookie) => cookie.startsWith('moddy_csrf=')).split(';')[0];
  const forbidden = await fetch(`${baseUrl}/auth/logout`, { method: 'POST', headers: { origin: 'http://localhost:5173', cookie: `${refresh}; ${csrf}` } });
  assert.equal(forbidden.status, 403);
  const logout = await fetch(`${baseUrl}/auth/logout`, {
    method: 'POST', headers: { origin: 'http://localhost:5173', cookie: `${refresh}; ${csrf}`, 'x-csrf-token': decodeURIComponent(csrf.slice('moddy_csrf='.length)) },
  });
  assert.equal(logout.status, 204);
  assert.ok(sessions.some((session) => session.status === 'revoked'));
  const accessToken = (await login.json()).accessToken;
  const revokedAccess = await fetch(`${baseUrl}/auth/me`, { headers: { authorization: `Bearer ${accessToken}` } });
  assert.equal(revokedAccess.status, 401);
  assert.equal((await revokedAccess.json()).error.code, 'AUTH_INVALID_TOKEN');
});

test('untrusted browser origins cannot use credentialed auth and malformed registration is rejected', async () => {
  const rejectedOrigin = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST', headers: { origin: 'https://untrusted.example', 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Another', email: 'another@example.test', password: 'Moddy_Player_2026!' }),
  });
  assert.equal(rejectedOrigin.status, 403);
  const invalid = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST', headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Another', email: 'another@example.test', password: 'weak' }),
  });
  assert.equal(invalid.status, 400);
});

test('registration rolls back the user if refresh-session creation fails', async () => {
  const beforeSessions = sessions.length;
  failSessionCreation = true;
  try {
    const response = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Rollback User', email: 'rollback@example.test', password: 'Moddy_Player_2026!' }),
    });
    assert.equal(response.status, 500);
    assert.equal(users.get(userId).email, 'user@example.test');
    assert.equal(sessions.length, beforeSessions);
  } finally {
    failSessionCreation = false;
  }
});
