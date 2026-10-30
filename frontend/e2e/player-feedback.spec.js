import { expect } from '@playwright/test';
import { test } from './fixtures.js';
import { installMediaMocks } from './media-mocks.js';

async function loadRecommendations(page) {
  await page.getByRole('button', { name: 'Get recommendations' }).click();
  await expect(page.getByRole('heading', { name: 'Your recommendations' })).toBeVisible();
}

test('simulated media controls play, pause, seek, change volume, and navigate repeatedly', async ({ unopenedApp }) => {
  const { page, api, pageErrors } = unopenedApp;
  await installMediaMocks(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await loadRecommendations(page);
  await page.getByRole('button', { name: 'Play First Light by North Window' }).click();

  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  const seek = page.getByRole('slider', { name: 'Seek track' });
  await expect(seek).toHaveAttribute('max', '180');
  await seek.evaluate((element) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, '61');
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(seek).toHaveAttribute('aria-valuetext', '1:01 of 3:00');
  await expect(page.locator('audio').evaluate((audio) => audio.currentTime)).resolves.toBe(61);

  const volume = page.getByRole('slider', { name: 'Volume' });
  await volume.evaluate((element) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, '0.3');
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(volume).toHaveValue('0.3');
  await expect(page.locator('audio').evaluate((audio) => audio.volume)).resolves.toBeCloseTo(0.3, 1);

  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Play next track' }).click();
  await expect(page.locator('section[aria-label="Music player"]')).toContainText('Soft Landing');
  await page.getByRole('button', { name: 'Play previous track' }).click();
  await expect(page.locator('section[aria-label="Music player"]')).toContainText('First Light');
  await page.getByRole('button', { name: 'Play next track' }).click();
  await page.getByRole('button', { name: 'Play next track' }).click();
  await expect(page.locator('section[aria-label="Music player"]')).toContainText('First Light');
  expect(api.requests.filter(({ path }) => path === '/feedback').map(({ body }) => body.event)).toContain('skip');
  expect(pageErrors).toEqual([]);
});

test('rejects a simulated play promise with a visible error and restores Play', async ({ unopenedApp }) => {
  const { page } = unopenedApp;
  await installMediaMocks(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await loadRecommendations(page);
  await page.getByRole('button', { name: 'Play First Light by North Window' }).click();
  await expect(page.getByRole('slider', { name: 'Seek track' })).toBeEnabled();
  await page.evaluate(() => { window.__rejectNextPlay = true; });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Playback could not start');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
});

test('keeps seeking unavailable until simulated metadata arrives and allows pausing while loading', async ({ unopenedApp }) => {
  const { page } = unopenedApp;
  await installMediaMocks(page, { delayMetadata: true });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await loadRecommendations(page);
  await page.getByRole('button', { name: 'Play First Light by North Window' }).click();

  const seek = page.getByRole('slider', { name: 'Seek track' });
  await expect(seek).toBeDisabled();
  await expect.poll(() => page.evaluate(() => typeof window.__releaseMediaMetadata)).toBe('function');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await page.evaluate(() => window.__releaseMediaMetadata());
  await expect(seek).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
});

test('shows a media load error for an unavailable audio URL', async ({ unopenedApp, api }) => {
  const { page } = unopenedApp;
  await installMediaMocks(page);
  api.recommendWith([{ ...api.catalog.songs[0], audio: 'https://media.example.test/broken.wav' }]);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await loadRecommendations(page);
  await page.getByRole('button', { name: 'Play First Light by North Window' }).click();
  await expect(page.getByRole('alert')).toContainText('This track could not be loaded');
});

test('ignores a stale media error from a song that was replaced', async ({ unopenedApp }) => {
  const { page } = unopenedApp;
  await installMediaMocks(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await loadRecommendations(page);
  await page.getByRole('button', { name: 'Play First Light by North Window' }).click();
  const oldAudio = await page.locator('audio').elementHandle();
  await page.getByRole('button', { name: 'Play next track' }).click();
  await expect(page.locator('section[aria-label="Music player"]')).toContainText('Soft Landing');
  await oldAudio.evaluate((audio) => audio.dispatchEvent(new Event('error')));
  await expect(page.getByRole('alert')).toHaveCount(0);
  await oldAudio.dispose();
});

test('feedback requests show per-button pending, suppress duplicates, and preserve the API payload', async ({ app }) => {
  const { page, api } = app;
  await loadRecommendations(page);
  let resolveFeedback;
  let signalRequest;
  const requestStarted = new Promise((resolve) => { signalRequest = resolve; });
  const waitForRelease = new Promise((resolve) => { resolveFeedback = resolve; });
  api.feedbackResponder = async (route) => {
    signalRequest();
    await waitForRelease;
    await route.fulfill({ status: 202, json: { message: 'Feedback recorded.' } });
  };

  const like = page.getByRole('button', { name: 'Like First Light', exact: true });
  await like.click();
  await requestStarted;
  const saving = page.getByRole('button', { name: 'Saving like for First Light' });
  await expect(saving).toBeDisabled();
  await saving.evaluate((button) => { button.disabled = false; button.click(); });
  expect(api.requests.filter(({ path }) => path === '/feedback')).toHaveLength(1);
  resolveFeedback();
  await expect(page.getByRole('status')).toContainText('Thanks for the like.');
  await expect(page.getByRole('button', { name: 'Like First Light', exact: true })).toBeEnabled();

  const request = api.requests.find(({ path }) => path === '/feedback');
  expect(request.method).toBe('POST');
  expect(request.body).toMatchObject({
    songId: api.catalog.songs[0]._id,
    event: 'like',
    intention: 'match',
  });
  expect(request.body.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

test('allows feedback retry after a failed request and checks dislike payload', async ({ app }) => {
  const { page, api } = app;
  await loadRecommendations(page);
  let attempt = 0;
  api.feedbackResponder = async (route) => {
    attempt += 1;
    await route.fulfill(attempt === 1
      ? { status: 500, json: { error: { code: 'INTERNAL_ERROR', message: 'Failed.' } } }
      : { status: 202, json: { message: 'Feedback recorded.' } });
  };

  await page.getByRole('button', { name: 'Like First Light', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Feedback could not be saved');
  await expect(page.getByRole('button', { name: 'Like First Light', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Like First Light', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Thanks for the like.');
  await page.getByRole('button', { name: 'Dislike First Light' }).click();
  await expect(page.getByRole('status')).toContainText('Feedback saved.');
  expect(api.requests.filter(({ path }) => path === '/feedback').map(({ body }) => body.event)).toEqual(['like', 'like', 'dislike']);
});

test('skip feedback remains pending on player controls while rapid navigation stays responsive', async ({ unopenedApp }) => {
  const { page, api } = unopenedApp;
  await installMediaMocks(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await loadRecommendations(page);
  await page.getByRole('button', { name: 'Play First Light by North Window' }).click();

  let releaseSkip;
  let signalSkip;
  const skipStarted = new Promise((resolve) => { signalSkip = resolve; });
  const skipWait = new Promise((resolve) => { releaseSkip = resolve; });
  api.feedbackResponder = async (route) => {
    signalSkip();
    await skipWait;
    await route.fulfill({ status: 202, json: { message: 'Feedback recorded.' } });
  };

  await page.getByRole('button', { name: 'Play next track' }).click();
  await skipStarted;
  const next = page.getByRole('button', { name: 'Play next track; saving skip feedback' });
  await expect(next).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('section[aria-label="Music player"]')).toContainText('Soft Landing');
  expect(api.requests.find(({ path }) => path === '/feedback').body).toMatchObject({
    songId: api.catalog.songs[0]._id,
    event: 'skip',
    intention: 'match',
  });

  releaseSkip();
  await expect(page.getByRole('button', { name: 'Play next track' })).toHaveAttribute('aria-busy', 'false');
});
