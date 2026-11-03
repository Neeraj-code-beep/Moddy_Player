const test = require('node:test');
const assert = require('node:assert/strict');
const { getMusicIntelligenceConfig } = require('../src/config/music-intelligence');
const { MetadataValidationError, validateMusicMetadata } = require('../src/service/music-metadata-validation.service');
const { ProviderError, RESPONSE_SCHEMA, analyzeAudioWithGemini } = require('../src/service/gemini-music-provider.service');
const { AudioAssetError, assertTrustedAssetUrl, readBoundedBody } = require('../src/service/song-audio-asset.service');
const { delayForAttempt, errorDetails, initialReviewState } = require('../src/service/song-analysis-worker.service');
const { buildUserPreferenceProfile, rankSongs } = require('../src/service/recommendation.service');

function validMetadata() {
  return {
    mood: 'calm', secondaryMoods: ['peaceful'], genre: 'ambient', subgenres: ['dream_pop'],
    energy: 'low', listeningContexts: ['focus'], instrumentation: ['piano'],
    vocalCharacteristics: 'instrumental', tags: ['soft', 'warm'],
  };
}

test('AI configuration is optional, bounded, and rejects unsafe endpoint configuration', () => {
  assert.equal(getMusicIntelligenceConfig({}).enabled, false);
  assert.equal(getMusicIntelligenceConfig({ GEMINI_API_KEY: 'test-only', GEMINI_MODEL: 'gemini-3.8-flash' }).model, 'gemini-3.8-flash');
  assert.throws(() => getMusicIntelligenceConfig({ GEMINI_API_BASE_URL: 'http://example.test' }), /HTTPS/);
  assert.throws(() => getMusicIntelligenceConfig({ MUSIC_AI_TIMEOUT_MS: '0' }), /integer/);
  assert.throws(() => getMusicIntelligenceConfig({ MUSIC_AI_TIMEOUT_MS: '180000', MUSIC_AI_JOB_LEASE_MS: '200000' }), /exceed/);
});

test('AI metadata accepts controlled values, normalizes strings, and rejects fabricated or malformed fields', () => {
  const value = validateMusicMetadata(validMetadata());
  assert.deepEqual(value.secondaryMoods, ['peaceful']);
  assert.deepEqual(value.subgenres, ['dream_pop']);
  assert.throws(() => validateMusicMetadata({ ...validMetadata(), bpm: 120 }), MetadataValidationError);
  assert.throws(() => validateMusicMetadata({ ...validMetadata(), energy: 'very high' }), MetadataValidationError);
  assert.throws(() => validateMusicMetadata({ ...validMetadata(), mood: 'invented_mood' }), MetadataValidationError);
  assert.throws(() => validateMusicMetadata({ ...validMetadata(), tags: Array(9).fill('tag') }), MetadataValidationError);
});

test('Gemini audio request uses structured output and deletes its temporary file', async () => {
  const calls = [];
  const output = validMetadata();
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (calls.length === 1) return new Response('', { status: 200, headers: { 'x-goog-upload-url': 'https://upload.example.test/session' } });
    if (calls.length === 2) return Response.json({ file: { name: 'files/test-file', uri: 'https://generativelanguage.googleapis.com/v1beta/files/test-file' } });
    if (calls.length === 3) return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(output) }] } }] });
    return new Response('', { status: 200 });
  };
  const result = await analyzeAudioWithGemini({
    audio: Buffer.from('test audio'), mimeType: 'audio/mpeg',
    config: { enabled: true, apiKey: 'test-secret', provider: 'gemini', model: 'gemini-test', apiBaseUrl: 'https://generativelanguage.googleapis.com', timeoutMs: 1000 },
    fetchImpl,
  });
  assert.equal(result.genre, 'ambient');
  assert.equal(calls.length, 4);
  assert.match(calls[0].url, /upload\/v1beta\/files$/);
  assert.equal(calls[0].options.headers['x-goog-api-key'], 'test-secret');
  assert.deepEqual(calls[2].options.body && JSON.parse(calls[2].options.body).generationConfig.responseSchema, RESPONSE_SCHEMA);
  assert.equal(calls[3].options.method, 'DELETE');
});

test('Gemini provider failures are classified without preserving provider response text', async () => {
  await assert.rejects(analyzeAudioWithGemini({
    audio: Buffer.from('x'), mimeType: 'audio/mpeg',
    config: { enabled: true, apiKey: 'test-secret', apiBaseUrl: 'https://generativelanguage.googleapis.com', timeoutMs: 1000 },
    fetchImpl: async () => new Response('sensitive provider detail', { status: 429 }),
  }), (error) => error instanceof ProviderError && error.code === 'provider_rate_limited' && error.retryable && !error.message.includes('sensitive'));

  let calls = 0;
  await assert.rejects(analyzeAudioWithGemini({
    audio: Buffer.from('x'), mimeType: 'audio/mpeg',
    config: { enabled: true, apiKey: 'test-secret', apiBaseUrl: 'https://generativelanguage.googleapis.com', timeoutMs: 1000 },
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return new Response('', { status: 200, headers: { 'x-goog-upload-url': 'https://upload.example.test/session' } });
      if (calls === 2) return Response.json({ file: { name: 'files/test-file', uri: 'https://generativelanguage.googleapis.com/files/test-file' } });
      if (calls === 3) return Response.json({ candidates: [{ content: { parts: [{ text: '{malformed' }] } }] });
      return new Response('', { status: 200 });
    },
  }), MetadataValidationError);
  assert.equal(calls, 4, 'temporary Gemini file is cleaned up after malformed model output');
});

test('stored audio retrieval rejects cross-origin URLs and enforces a byte limit', async () => {
  assert.throws(() => assertTrustedAssetUrl('https://attacker.example/file.mp3', 'https://ik.example/songs'), AudioAssetError);
  assert.throws(() => assertTrustedAssetUrl('http://ik.example/songs/file.mp3', 'https://ik.example/songs'), AudioAssetError);
  const oversized = new Response(new Uint8Array([1, 2]), { headers: { 'content-length': '10' } });
  await assert.rejects(readBoundedBody(oversized, 4), (error) => error.code === 'audio_size_unsupported');
});

test('worker delay is exponential with bounded jitter and diagnostics expose only codes', () => {
  assert.equal(delayForAttempt(1, 1000, () => 0.5), 1000);
  assert.equal(delayForAttempt(3, 1000, () => 0.5), 4000);
  assert.deepEqual(errorDetails(Object.assign(new Error('private url'), { code: 'provider_timeout', retryable: true })), { code: 'provider_timeout', retryable: true });
  assert.deepEqual(initialReviewState().mood, { status: 'pending' });
});

test('recommendations use only accepted metadata and account favorites or explicit feedback as deterministic signals', () => {
  const profile = buildUserPreferenceProfile({
    favorites: [{ _id: 'fav1', mood: 'romantic', genre: 'jazz' }],
    feedback: [{ songId: 'song-x', event: 'dislike', mood: 'happy', genre: 'pop' }],
  });
  const ranked = rankSongs([
    { _id: 'jazz1', title: 'J', artist: 'A', mood: 'romantic', genre: 'jazz' },
    { _id: 'song-x', title: 'X', artist: 'B', mood: 'happy', genre: 'pop' },
  ], { mood: 'romantic', intention: 'match', limit: 2 }, profile);
  assert.equal(ranked[0].song._id, 'jazz1');
  assert.match(ranked[0].reason, /genres in your favorites/);
  assert.match(ranked[1].reason, /earlier feedback/);
});
