import { test as base } from '@playwright/test';
import { Buffer } from 'node:buffer';

export const songs = [
  {
    _id: '65a123456789012345678901',
    title: 'First Light',
    artist: 'North Window',
    mood: 'happy',
    genre: 'ambient',
    audio: 'https://media.example.test/first-light.wav',
  },
  {
    _id: '65a123456789012345678902',
    title: 'Soft Landing',
    artist: 'North Window',
    mood: 'neutral',
    genre: 'electronic',
    audio: 'https://media.example.test/soft-landing.wav',
  },
];

const recommendationBody = (items = songs) => ({
  message: 'Recommendations generated successfully',
  recommendations: items.map((song, index) => ({
    song,
    score: 90 - index,
    reason: 'fits this listening intention',
  })),
  requestedMood: 'happy',
  normalizedMood: 'happy',
  intention: 'match',
});

const createSilentWave = () => {
  const sampleCount = 4_000;
  const dataSize = sampleCount;
  const wave = Buffer.alloc(44 + dataSize);
  wave.write('RIFF', 0);
  wave.writeUInt32LE(36 + dataSize, 4);
  wave.write('WAVE', 8);
  wave.write('fmt ', 12);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(8_000, 24);
  wave.writeUInt32LE(8_000, 28);
  wave.writeUInt16LE(1, 32);
  wave.writeUInt16LE(8, 34);
  wave.write('data', 36);
  wave.writeUInt32LE(dataSize, 40);
  return wave;
};

export const test = base.extend({
  api: async ({ page }, provide) => {
    const state = {
      requests: [],
      catalog: { songs, pagination: { page: 1, limit: 100, total: songs.length, totalPages: 1 } },
      recommendationResponse: recommendationBody(),
      recommendationResponder: null,
      feedbackResponder: null,
    };

    await page.route('**/songs', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      state.requests.push({ method: 'GET', path: '/songs', body: null });
      await route.fulfill({ status: 200, json: { message: 'Songs fetched successfully', ...state.catalog } });
    });
    await page.route('**/recommendations', async (route) => {
      const request = route.request();
      const entry = { method: request.method(), path: '/recommendations', body: request.postDataJSON() };
      state.requests.push(entry);
      if (state.recommendationResponder) return state.recommendationResponder(route, entry);
      await route.fulfill({ status: 200, json: state.recommendationResponse });
    });
    await page.route('**/feedback', async (route) => {
      const request = route.request();
      const entry = { method: request.method(), path: '/feedback', body: request.postDataJSON() };
      state.requests.push(entry);
      if (state.feedbackResponder) return state.feedbackResponder(route, entry);
      await route.fulfill({ status: 202, json: { message: 'Feedback recorded.' } });
    });
    await page.route('https://media.example.test/**', async (route) => {
      if (route.request().url().includes('broken')) {
        await route.fulfill({ status: 404, body: 'Not found.' });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'audio/wav', body: createSilentWave() });
    });

    state.recommendWith = (items) => { state.recommendationResponse = recommendationBody(items); };
    state.errorRecommendations = (status = 500) => {
      state.recommendationResponder = (route) => route.fulfill({
        status,
        json: { error: { code: 'INTERNAL_ERROR', message: 'The request failed.' } },
      });
    };
    await provide(state);
  },

  unopenedApp: async ({ page, api }, provide) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await provide({ page, api, pageErrors });
  },

  app: async ({ unopenedApp }, provide) => {
    await unopenedApp.page.goto('/', { waitUntil: 'domcontentloaded' });
    await provide(unopenedApp);
  },
});

export { recommendationBody };
