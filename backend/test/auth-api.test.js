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

function query(value) {
  return { select() { return this; }, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } };
}

const userModel = {
  findOne(filter) { return query([...users.values()].find((user) => user.email === filter.email) || null); },
  findById(id) { return Promise.resolve(users.get(String(id)) || null); },
  async create(data) {
    const user = {
      _id: userId, id: userId, ...data, role: data.role || 'user', status: 'active', bio: '', avatarUrl: null,
      toObject() { return { ...this }; },
      async save() { users.set(String(this._id), this); return this; },
    };
    users.set(userId, user);
    return user;
  },
};
const sessionModel = {
  async create(data) { sessions.push(...(Array.isArray(data) ? data : [data])); return data; },
  async findOne(filter) { return sessions.find((session) => session.tokenHash === filter.tokenHash) || null; },
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

let server;
let baseUrl;
before(async () => {
  users.clear(); sessions.length = 0;
  const app = createApp({ userModel, authSessionModel: sessionModel, authConfig: config, corsOrigins: new Set(['http://localhost:5173']), isDatabaseReady: () => true });
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
  const token = createAccessToken({ userId, familyId: '5b59d118-8de3-47ef-9db2-93a13b6ed85f', role: 'user' }, config);
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
  const token = createAccessToken({ userId, familyId: '21723130-9f9a-4a94-a62d-3b3e55f63f91', role: 'user' }, config);
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
