import { expect } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { test } from './fixtures.js';

const account = { id: '507f1f77bcf86cd799439011', name: 'Library Listener', email: 'listener@example.test', role: 'user', bio: '', avatarUrl: null };
const song = { _id: '507f1f77bcf86cd799439101', title: 'Private Evening', artist: 'Moddy Listener', mood: 'calm', audio: 'https://media.example.test/private-evening.wav', visibility: 'private', mediaStatus: 'active', analysis: { status: 'queued' }, aiSuggestions: { status: 'queued' } };

test('private library uploads, favorites, and playlists use authenticated management APIs', async ({ page }) => {
  const state = { songs: [], favorites: [], playlist: { id: 'playlist-1', name: 'Night Drive', revision: 0, songs: [] }, requests: [] };
  await page.route('**/library/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    state.requests.push({ method: request.method(), path, body: request.postData() });
    if (path === '/library/songs' && request.method() === 'GET') return route.fulfill({ status: 200, json: { songs: state.songs, pagination: { page: 1, limit: 100, total: state.songs.length, totalPages: 1 } } });
    if (path === '/library/songs' && request.method() === 'POST') {
      state.songs = [{ ...song, audio: `${song.audio}?signed=true` }];
      return route.fulfill({ status: 201, json: { song: state.songs[0] } });
    }
    if (path === '/library/favorites' && request.method() === 'GET') return route.fulfill({ status: 200, json: { favorites: state.favorites } });
    if (path === `/library/favorites/${song._id}` && request.method() === 'POST') {
      state.favorites = [state.songs[0]];
      return route.fulfill({ status: 201, json: { favorite: state.songs[0] } });
    }
    if (path === '/library/playlists' && request.method() === 'GET') return route.fulfill({ status: 200, json: { playlists: state.playlists || [] } });
    if (path === '/library/playlists' && request.method() === 'POST') {
      state.playlists = [{ ...state.playlist, songCount: 0 }];
      return route.fulfill({ status: 201, json: { playlist: state.playlist } });
    }
    if (path === `/library/playlists/${state.playlist.id}` && request.method() === 'GET') return route.fulfill({ status: 200, json: { playlist: state.playlist } });
    if (path === `/library/playlists/${state.playlist.id}` && request.method() === 'PATCH') {
      const body = request.postDataJSON();
      state.playlist = { ...state.playlist, revision: state.playlist.revision + 1, songs: body.songIds?.map((id) => state.songs.find((item) => item._id === id)).filter(Boolean) || state.playlist.songs };
      return route.fulfill({ status: 200, json: { playlist: { ...state.playlist, songIds: state.playlist.songs.map((item) => item._id) } } });
    }
    return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'Not found.' } } });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async (user) => {
    const { setAccessToken } = await import('/src/api/api.js');
    setAccessToken('mock-library-token');
    window.dispatchEvent(new CustomEvent('moddy:auth-restored', { detail: user }));
  }, account);
  await expect(page.getByRole('heading', { name: 'My Library' })).toBeVisible();

  await page.getByLabel('title', { exact: true }).fill(song.title);
  await page.getByLabel('artist', { exact: true }).fill(song.artist);
  await page.getByLabel('mood', { exact: true }).first().fill(song.mood);
  await page.getByLabel('Audio file').setInputFiles({ name: 'private-evening.wav', mimeType: 'audio/wav', buffer: Buffer.from('RIFF0000WAVE') });
  await page.getByRole('button', { name: 'Add to private library' }).click();
  await expect(page.getByText('Song added to your private library.')).toBeVisible();
  await expect(page.getByLabel('Music analysis for Private Evening').getByText('Waiting for analysis')).toBeVisible();
  const upload = state.requests.find((entry) => entry.path === '/library/songs' && entry.method === 'POST');
  expect(upload).toBeTruthy();
  expect(upload.body).not.toContain('visibility');
  expect(upload.body).not.toContain('uploadedBy');

  await page.getByRole('button', { name: 'Favorite', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Favorites' })).toBeVisible();
  expect(state.requests.some((entry) => entry.path === `/library/favorites/${song._id}` && entry.method === 'POST')).toBe(true);

  await page.getByLabel('Playlist name').fill('Night Drive');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText('Night Drive · 0 songs')).toBeVisible();
  await page.getByLabel(`Choose a playlist`).selectOption('playlist-1');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  expect(state.requests.some((entry) => entry.path === '/library/playlists/playlist-1' && entry.method === 'PATCH')).toBe(true);
});

test('owners can review completed suggestions and retry failed analysis', async ({ page }) => {
  const completed = { ...song, _id: 'song-ai-ready', title: 'Reviewed Song', analysis: { status: 'completed' }, aiSuggestions: { status: 'completed', mood: 'romantic', genre: 'jazz', energy: 'low', tags: ['soft'], review: {} } };
  const failed = { ...song, _id: 'song-ai-failed', title: 'Retry Song', analysis: { status: 'failed', errorCode: 'provider_timeout' }, aiSuggestions: { status: 'failed' } };
  const state = { songs: [completed, failed], reviewRequests: [], retryRequests: 0 };
  await page.route('**/library/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/library/songs' && request.method() === 'GET') return route.fulfill({ status: 200, json: { songs: state.songs, pagination: { page: 1, limit: 100, total: state.songs.length, totalPages: 1 } } });
    if (path === '/library/favorites') return route.fulfill({ status: 200, json: { favorites: [] } });
    if (path === '/library/playlists') return route.fulfill({ status: 200, json: { playlists: [] } });
    if (path === `/library/songs/${completed._id}/metadata-review`) {
      const fields = request.postDataJSON().fields;
      state.reviewRequests.push(fields);
      for (const [field, status] of Object.entries(fields)) completed.aiSuggestions.review[field] = { source: 'ai', status };
      return route.fulfill({ status: 200, json: { reviewed: { fields: Object.keys(fields) } } });
    }
    if (path === `/library/songs/${failed._id}/analysis/retry`) {
      state.retryRequests += 1;
      failed.analysis.status = 'queued';
      failed.aiSuggestions.status = 'queued';
      return route.fulfill({ status: 202, json: { analysis: { status: 'queued' } } });
    }
    return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'Not found.' } } });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async (user) => {
    const { setAccessToken } = await import('/src/api/api.js');
    setAccessToken('mock-library-token');
    window.dispatchEvent(new CustomEvent('moddy:auth-restored', { detail: user }));
  }, account);

  const reviewed = page.getByLabel('Music analysis for Reviewed Song');
  await expect(reviewed.getByText('Analysis complete')).toBeVisible();
  await reviewed.getByRole('button', { name: 'Accept suggested mood' }).click();
  await expect(reviewed.getByText('Review: accepted')).toBeVisible();
  await expect(reviewed.getByRole('button', { name: 'Accept suggested mood' })).toHaveCount(0);
  expect(state.reviewRequests).toEqual([{ mood: 'accepted' }]);

  const retryCard = page.getByLabel('Music analysis for Retry Song');
  await expect(retryCard.getByText('Analysis failed')).toBeVisible();
  await retryCard.getByRole('button', { name: 'Retry analysis' }).click();
  await expect(retryCard.getByText('Waiting for analysis')).toBeVisible();
  expect(state.retryRequests).toBe(1);
});

test('administrator moderation is shown only for admin accounts and publishes eligible songs', async ({ page }) => {
  const admin = { ...account, role: 'admin', name: 'Catalog Admin' };
  let statusPayload;
  let reviewPayload;
  let retryCount = 0;
  await page.route('**/library/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/library/songs') return route.fulfill({ status: 200, json: { songs: [], pagination: { page: 1, limit: 100, total: 0, totalPages: 0 } } });
    if (path === '/library/favorites') return route.fulfill({ status: 200, json: { favorites: [] } });
    if (path === '/library/playlists') return route.fulfill({ status: 200, json: { playlists: [] } });
    if (path === '/library/admin/songs') return route.fulfill({ status: 200, json: { songs: [{ _id: 'song-pending', title: 'Review this', artist: 'Catalog Artist', mood: 'calm', analysis: { status: 'completed', suggestions: { mood: 'peaceful', genre: 'ambient', review: {} } } }] } });
    if (path === '/library/admin/analysis/jobs') return route.fulfill({ status: 200, json: { jobs: [{ id: 'job-failed', songId: 'song-pending', status: 'failed', attempts: 3, maxAttempts: 3, lastErrorCode: 'provider_timeout' }] } });
    return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'Not found.' } } });
  });
  await page.route('**/library/admin/songs/song-pending', async (route) => {
    statusPayload = route.request().postDataJSON();
    await route.fulfill({ status: 200, json: { song: { _id: 'song-pending', catalogStatus: statusPayload.status } } });
  });
  await page.route('**/library/admin/songs/song-pending/metadata-review', async (route) => {
    reviewPayload = route.request().postDataJSON();
    await route.fulfill({ status: 200, json: { reviewed: { fields: Object.keys(reviewPayload.fields) } } });
  });
  await page.route('**/library/admin/analysis/jobs/job-failed/retry', async (route) => {
    retryCount += 1;
    await route.fulfill({ status: 202, json: { job: { id: 'job-failed', status: 'queued' } } });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async (user) => {
    const { setAccessToken } = await import('/src/api/api.js');
    setAccessToken('mock-admin-token');
    window.dispatchEvent(new CustomEvent('moddy:auth-restored', { detail: user }));
  }, admin);
  await expect(page.getByRole('heading', { name: 'Catalog management' })).toBeVisible();
  await expect(page.getByText('Review this · Catalog Artist · calm')).toBeVisible();
  await page.getByRole('button', { name: 'Accept suggested mood' }).click();
  expect(reviewPayload).toEqual({ fields: { mood: 'accepted' } });
  await expect(page.getByText('AI analysis jobs (1)')).toBeVisible();
  await page.getByRole('button', { name: 'Retry job' }).click();
  expect(retryCount).toBe(1);
  await page.getByRole('button', { name: 'Approve' }).click();
  expect(statusPayload).toEqual({ status: 'approved' });

  for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole('heading', { name: 'My Library' })).toBeVisible();
    const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: window.innerWidth }));
    expect(width.scroll).toBeLessThanOrEqual(width.viewport);
  }
});
