import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { test } from './fixtures.js';
import { installMediaMocks } from './media-mocks.js';

test('homepage fits desktop, tablet, and mobile and has real navigation targets', async ({ unopenedApp }, testInfo) => {
  const { page } = unopenedApp;
  await installMediaMocks(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await expect(page.getByRole('heading', { level: 1, name: /find the feeling in your next song/i })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Explore your mood' })).toBeVisible();
    if (await page.getByRole('heading', { name: 'Your recommendations' }).count() === 0) {
      await page.getByRole('button', { name: 'Get recommendations' }).click();
    }
    await expect(page.getByRole('article')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Like First Light', exact: true })).toBeVisible();
    if (await page.locator('section[aria-label="Music player"]').count() === 0) {
      await page.getByRole('button', { name: 'Play First Light by North Window' }).click();
    }
    const player = page.locator('section[aria-label="Music player"]');
    await expect(player).toBeVisible();
    await expect(player.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await expect(player.getByRole('button', { name: 'Play next track' })).toBeVisible();
    await expect(player.getByRole('button', { name: 'Play previous track' })).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      width: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
    }));
    expect(dimensions.documentWidth, `${viewport.name} document overflow`).toBeLessThanOrEqual(dimensions.width);
    expect(dimensions.bodyWidth, `${viewport.name} body overflow`).toBeLessThanOrEqual(dimensions.width);
    const layout = await page.evaluate(() => {
      const playerElement = document.querySelector('section[aria-label="Music player"]');
      const playerRect = playerElement.getBoundingClientRect();
      const articles = [...document.querySelectorAll('article')].map((article) => article.getBoundingClientRect());
      return {
        playerLeft: playerRect.left,
        playerRight: playerRect.right,
        playerBottom: playerRect.bottom,
        playerPaddingBottom: Number.parseFloat(getComputedStyle(playerElement).paddingBottom),
        articleBounds: articles.map(({ left, right }) => ({ left, right })),
      };
    });
    expect(layout.playerLeft, `${viewport.name} player left edge`).toBeGreaterThanOrEqual(0);
    expect(layout.playerRight, `${viewport.name} player right edge`).toBeLessThanOrEqual(viewport.width);
    await expect.poll(async () => Math.ceil(await player.evaluate((element) => element.getBoundingClientRect().bottom)), {
      message: `${viewport.name} player settles within the viewport`,
    }).toBeLessThanOrEqual(viewport.height);
    expect(layout.playerPaddingBottom, `${viewport.name} safe-area padding floor`).toBeGreaterThanOrEqual(12);
    for (const [index, bounds] of layout.articleBounds.entries()) {
      expect(bounds.left, `${viewport.name} recommendation ${index} left edge`).toBeGreaterThanOrEqual(0);
      expect(bounds.right, `${viewport.name} recommendation ${index} right edge`).toBeLessThanOrEqual(viewport.width);
    }
    await page.screenshot({ path: testInfo.outputPath(`discovery-${viewport.name}.png`), fullPage: true });
  }
  await expect(page.getByRole('combobox', { name: 'Mood' })).toBeVisible();
  await expect(page.getByLabel('Listening intention')).toBeVisible();
});

test('mobile navigation opens as a dialog, traps focus, closes on Escape, and restores focus', async ({ app }) => {
  const { page } = app;
  await page.setViewportSize({ width: 390, height: 844 });
  const trigger = page.getByRole('button', { name: 'Open navigation menu' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Navigation menu' });
  await expect(dialog).toBeVisible();
  const closeButton = page.getByRole('button', { name: 'Close navigation menu' });
  await expect(closeButton).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('link', { name: 'Discover' }).last()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('submits the existing mood and intention contract and renders recommendations', async ({ app }) => {
  const { page, api } = app;
  await page.getByRole('combobox', { name: 'Mood' }).selectOption('happy');
  await page.getByLabel('Listening intention').selectOption('cheer_up');
  await page.getByRole('button', { name: 'Get recommendations' }).click();
  await expect(page.getByRole('heading', { name: 'Your recommendations' })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(2);
  expect(api.requests.filter(({ path }) => path === '/recommendations')).toEqual([
    { method: 'POST', path: '/recommendations', body: { mood: 'happy', intention: 'cheer_up', limit: 12 } },
  ]);
  await expect(page.getByRole('button', { name: 'Play First Light by North Window' })).toBeVisible();
});

test('shows loading while a delayed recommendation response is pending', async ({ app }) => {
  const { page, api } = app;
  let signalStarted;
  let releaseResponse;
  const started = new Promise((resolve) => { signalStarted = resolve; });
  const held = new Promise((resolve) => { releaseResponse = resolve; });
  api.recommendationResponder = async (route) => {
    signalStarted();
    await held;
    await route.fulfill({ status: 200, json: api.recommendationResponse });
  };

  await page.getByRole('button', { name: 'Get recommendations' }).click();
  await started;
  const loadingButton = page.getByRole('button', { name: 'Finding tracks…' });
  await expect(loadingButton).toBeDisabled();
  releaseResponse();
  await expect(page.getByRole('heading', { name: 'Your recommendations' })).toBeVisible();
});

test('shows empty recommendation and API error states', async ({ app }) => {
  const { page, api } = app;
  api.recommendWith([]);
  await page.getByRole('button', { name: 'Get recommendations' }).click();
  await expect(page.getByText('There are no tracks for this mix yet.')).toBeVisible();

  api.errorRecommendations();
  await page.getByRole('button', { name: 'Get recommendations' }).click();
  await expect(page.getByRole('alert')).toContainText('Recommendations could not be loaded');
});

test('homepage has no automated axe violations for names, keyboard semantics, or contrast', async ({ app }) => {
  const { page } = app;
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});

test('mobile navigation remains keyboard operable with reduced motion requested', async ({ app }) => {
  const { page } = app;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  const trigger = page.getByRole('button', { name: 'Open navigation menu' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Navigation menu' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});
