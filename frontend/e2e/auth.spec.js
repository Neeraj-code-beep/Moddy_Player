import { expect } from '@playwright/test';
import { test } from './fixtures.js';

const account = { id: 'user-1', name: 'Moddy Listener', email: 'listener@example.test', role: 'user', avatarUrl: null, bio: '' };

async function startUnauthenticated(page) {
  await page.route('**/auth/refresh', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'AUTH_INVALID_SESSION', message: 'Sign in.' } }) }));
  await page.goto('/');
  if ((page.viewportSize()?.width || 1440) < 768) {
    await expect(page.getByRole('button', { name: 'Open navigation menu' })).toBeVisible();
  } else {
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  }
}

test('registration validates confirmation and sends the supported contract', async ({ page }) => {
  let payload;
  await page.route('**/auth/register', async (route) => {
    payload = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accessToken: 'test-access-token', expiresIn: 600, user: account }) });
  });
  await startUnauthenticated(page);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByLabel('Name').fill('Moddy Listener');
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill('Moddy_Player_2026!');
  await page.getByLabel('Confirm password').fill('different-password');
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click();
  await expect(page.getByRole('status')).toHaveText('Passwords do not match.');
  expect(payload).toBeUndefined();
  await page.getByLabel('Confirm password').fill('Moddy_Player_2026!');
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click();
  await expect(page.getByRole('button', { name: 'Moddy Listener' })).toBeVisible();
  expect(payload).toEqual({ name: 'Moddy Listener', email: account.email, password: 'Moddy_Player_2026!' });
});

test('login restores authenticated navigation and logout clears the account', async ({ page }) => {
  let loginPayload;
  let logoutRequest;
  await page.route('**/auth/login', async (route) => {
    loginPayload = route.request().postDataJSON();
    await page.context().addCookies([
      { name: 'moddy_refresh', value: 'mock-refresh', domain: '127.0.0.1', path: '/auth', httpOnly: true, sameSite: 'Lax' },
      { name: 'moddy_csrf', value: 'test-csrf', domain: '127.0.0.1', path: '/', sameSite: 'Lax' },
    ]);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accessToken: 'mock-access', expiresIn: 600, user: account }) });
  });
  await page.route('**/auth/logout', async (route) => {
    logoutRequest = { method: route.request().method(), csrf: route.request().headers()['x-csrf-token'] };
    await route.fulfill({ status: 204, body: '' });
  });
  await startUnauthenticated(page);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill('Moddy_Player_2026!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click();
  await expect(page.getByRole('button', { name: 'Moddy Listener' })).toBeVisible();
  expect(loginPayload).toEqual({ email: account.email, password: 'Moddy_Player_2026!' });
  await page.getByRole('button', { name: 'Moddy Listener' }).click();
  await expect(page.getByRole('dialog', { name: 'Your account' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  expect(logoutRequest).toEqual({ method: 'POST', csrf: 'test-csrf' });
});

test('authentication dialog remains usable at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startUnauthenticated(page);
  await page.getByRole('button', { name: 'Open navigation menu' }).click();
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click();
  await expect(page.getByRole('dialog', { name: 'Welcome to Moddy' })).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('concurrent expired requests share one refresh and retry their original actions', async ({ unopenedApp }) => {
  const { page } = unopenedApp;
  let refreshCalls = 0;
  let feedbackAttempts = 0;
  let releaseRefresh;
  const refreshGate = new Promise((resolve) => { releaseRefresh = resolve; });
  await page.route((url) => url.pathname === '/auth/refresh', async (route) => {
    refreshCalls += 1;
    if (refreshCalls === 1) return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'AUTH_INVALID_SESSION', message: 'No saved session.' } }) });
    await refreshGate;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accessToken: 'refreshed-token', expiresIn: 600, user: account }) });
  });
  await page.route('**/recommendations', async (route) => route.fulfill({ status: 200, json: {
    recommendations: [{ song: { _id: '65a123456789012345678901', title: 'First Light', artist: 'North Window', audio: 'https://media.example.test/first-light.wav' }, score: 90, reason: 'matches the mood' }],
    requestedMood: null, normalizedMood: null, intention: 'match',
  } }));
  await page.route('**/feedback', async (route) => {
    feedbackAttempts += 1;
    await route.fulfill(feedbackAttempts <= 2
      ? { status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'AUTH_REQUIRED', message: 'Expired.' } }) }
      : { status: 202, contentType: 'application/json', body: JSON.stringify({ message: 'Feedback recorded.' }) });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await page.evaluate(async () => {
    const { api } = await import('/src/api/api.js');
    window.__pendingAuthRequests = Promise.all([
      api.post('/feedback', { event: 'like' }),
      api.post('/feedback', { event: 'dislike' }),
    ]);
  });
  await expect.poll(() => feedbackAttempts).toBe(2);
  await expect.poll(() => refreshCalls).toBe(2);
  releaseRefresh();
  await expect.poll(() => feedbackAttempts).toBe(4);
  await page.evaluate(() => window.__pendingAuthRequests);
  await expect(page.getByRole('button', { name: 'Moddy Listener' })).toBeVisible();
  expect(refreshCalls).toBe(2);
});

test('failed refresh clears authenticated navigation and reports session expiry', async ({ page }) => {
  await page.route('**/auth/refresh', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'AUTH_INVALID_SESSION', message: 'Expired.' } }) }));
  await page.route('**/auth/login', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accessToken: 'expired-access', expiresIn: 600, user: account }) }));
  await page.route('**/recommendations', (route) => route.fulfill({ status: 200, json: { recommendations: [], intention: 'match' } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill('Moddy_Player_2026!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click();
  await expect(page.getByRole('button', { name: 'Moddy Listener' })).toBeVisible();
  await page.getByRole('button', { name: 'Get recommendations' }).click();
  await page.route('**/recommendations', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'AUTH_REQUIRED', message: 'Expired.' } }) }));
  await page.getByRole('button', { name: 'Get recommendations' }).click();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Your session ended');
});
