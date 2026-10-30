import { expect } from '@playwright/test';
import { test } from './fixtures.js';
import { installCameraMock, installFaceApiMock } from './media-mocks.js';

test('camera is not requested automatically and granted permission loads the local detector', async ({ unopenedApp }) => {
  const { page } = unopenedApp;
  await installCameraMock(page);
  await installFaceApiMock(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('combobox', { name: 'Mood' })).toBeVisible();
  expect(await page.evaluate(() => window.__cameraState.calls)).toBe(0);

  await page.getByRole('button', { name: 'Enable camera detection' }).click();
  await expect(page.getByRole('button', { name: 'Detect my mood' })).toBeVisible();
  expect(await page.evaluate(() => window.__faceApiState.loads)).toEqual([
    { name: 'tinyFaceDetector', path: '/models' },
    { name: 'faceLandmark68Net', path: '/models' },
    { name: 'faceExpressionNet', path: '/models' },
  ]);
  expect(await page.evaluate(() => window.__cameraState.calls)).toBe(1);
  expect(await page.evaluate(() => window.__cameraState.stops)).toBe(0);
  await expect(page.getByRole('combobox', { name: 'Mood' })).toBeVisible();
  await page.getByRole('button', { name: 'Detect my mood' }).click();
  await expect(page.getByRole('alert')).toContainText('No face detected');
  await page.getByRole('combobox', { name: 'Mood' }).selectOption('happy');
  await expect(page.getByRole('combobox', { name: 'Mood' })).toHaveValue('happy');
  const video = await page.getByLabel('Live camera preview used for on-device mood estimation').elementHandle();
  await page.getByRole('button', { name: 'Turn camera off' }).click();
  await expect(page.getByLabel('Live camera preview used for on-device mood estimation')).toHaveCount(0);
  expect(await page.evaluate(() => window.__cameraState.stops)).toBe(1);
  expect(await page.evaluate(() => window.__faceApiState.disposals)).toEqual([
    'tinyFaceDetector', 'faceLandmark68Net', 'faceExpressionNet',
  ]);
  expect(await video.evaluate((element) => element.srcObject === null)).toBe(true);
  await video.dispose();
});

test('denied and unavailable cameras show a fallback while manual mood selection stays usable', async ({ unopenedApp }) => {
  const { page } = unopenedApp;
  await installCameraMock(page, 'denied');
  await installFaceApiMock(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Enable camera detection' }).click();
  await expect(page.getByRole('alert')).toContainText('Camera or face detection models are unavailable');
  await page.getByRole('combobox', { name: 'Mood' }).selectOption('sad');
  await expect(page.getByRole('combobox', { name: 'Mood' })).toHaveValue('sad');

  await page.evaluate(() => { window.__cameraState.mode = 'missing'; });
  await page.getByRole('button', { name: 'Enable camera detection' }).click();
  await expect.poll(() => page.evaluate(() => window.__cameraState.calls)).toBe(2);
  await expect(page.getByRole('alert')).toContainText('Camera or face detection models are unavailable');
});

test('camera initialization can be cancelled; tracks stop and setup becomes available again', async ({ unopenedApp }) => {
  test.setTimeout(60_000);
  const { page } = unopenedApp;
  await installCameraMock(page);
  await installFaceApiMock(page, { delayed: true });
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await page.getByRole('button', { name: 'Enable camera detection' }).click();
  await expect.poll(() => page.evaluate(() => typeof window.__releaseFaceApiLoad)).toBe('function');
  await page.getByRole('button', { name: 'Cancel camera setup' }).click();
  await expect(page.getByRole('button', { name: 'Releasing camera resources…' })).toBeVisible();
  expect(await page.evaluate(() => window.__cameraState.stops)).toBe(1);
  await page.evaluate(() => window.__releaseFaceApiLoad());
  await expect(page.getByRole('button', { name: 'Enable camera detection' })).toBeEnabled();
  await expect(page.getByRole('combobox', { name: 'Mood' })).toBeVisible();
  expect(await page.evaluate(() => window.__faceApiState.disposals)).toContain('tinyFaceDetector');
});

test('failed local camera model loading cleans up the stream and preserves manual discovery', async ({ unopenedApp }) => {
  const { page } = unopenedApp;
  await installCameraMock(page);
  await installFaceApiMock(page, { failure: true });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Enable camera detection' }).click();
  await expect(page.getByRole('alert')).toContainText('Camera or face detection models are unavailable', { timeout: 30_000 });
  expect(await page.evaluate(() => window.__cameraState.stops)).toBe(1);
  await page.getByRole('combobox', { name: 'Mood' }).selectOption('neutral');
  await expect(page.getByRole('combobox', { name: 'Mood' })).toHaveValue('neutral');
});

test('unmounting an active camera view stops its stream and disposes its models', async ({ unopenedApp }) => {
  const { page } = unopenedApp;
  await installCameraMock(page);
  await installFaceApiMock(page);
  await page.goto('/e2e/camera-unmount.fixture.html', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Enable camera detection' }).click();
  await expect(page.getByRole('button', { name: 'Detect my mood' })).toBeVisible();
  await page.evaluate(() => window.__unmountCameraHarness());
  expect(await page.evaluate(() => window.__cameraState.stops)).toBe(1);
  expect(await page.evaluate(() => window.__faceApiState.disposals)).toEqual([
    'tinyFaceDetector', 'faceLandmark68Net', 'faceExpressionNet',
  ]);
});
