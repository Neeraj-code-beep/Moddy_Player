const assert = require('node:assert/strict');
const { test } = require('node:test');
const { validateSongMetadata } = require('../src/utils/audio-validation');
const {
  CANDIDATE_LIMIT,
  getRecommendations,
  normalizeIntention,
  normalizeMood,
  rankSongs,
  validateRecommendationRequest,
} = require('../src/service/recommendation.service');

const songs = [
  { _id: 'a', title: 'Sad', artist: 'Artist A', mood: 'sad', createdAt: '2025-01-01' },
  { _id: 'b', title: 'Happy', artist: 'Artist B', mood: 'happy', createdAt: '2025-01-02' },
  { _id: 'c', title: 'Calm', artist: 'Artist C', mood: 'neutral', energy: 'low', tags: ['relaxing'], createdAt: '2025-01-03' },
  { _id: 'd', title: 'Legacy', artist: 'Artist D', mood: 'unknown-style', createdAt: '2025-01-04' },
];

test('normalizes detector and legacy mood spellings and validates intention defaults', () => {
  assert.equal(normalizeMood(' FEAR '), 'fearful');
  assert.equal(normalizeMood('Happiness'), 'happy');
  assert.equal(normalizeMood('unknown-style'), null);
  assert.equal(normalizeIntention(), 'match');
  assert.equal(normalizeIntention('Cheer_Up'), 'cheer_up');
  assert.equal(normalizeIntention('custom'), null);
  assert.deepEqual(validateRecommendationRequest({ mood: 'Sad', intention: 'match' }).value, {
    mood: 'sad', requestedMood: 'Sad', intention: 'match', limit: 12,
  });
  assert.equal(validateRecommendationRequest({ intention: 'random' }).error.includes('intention'), true);
  assert.equal(validateRecommendationRequest({}).value.intention, 'match');
  assert.equal(validateRecommendationRequest({ mood: 'unlisted legacy value', intention: 'match' }).value.mood, null);
  assert.equal(validateRecommendationRequest({ intention: 'match', limit: 51 }).error.includes('limit'), true);
});

test('match ranks exact mood before compatible and unmatched catalog entries', () => {
  const ranked = rankSongs(songs, { mood: 'sad', intention: 'match', limit: 12 });
  assert.equal(ranked[0].song._id, 'a');
  assert.ok(ranked[0].reason.includes('matches the sad mood'));
});

test('cheer_up promotes uplifting and energetic songs over low energy sad songs', () => {
  const ranked = rankSongs(songs, { mood: 'sad', intention: 'cheer_up', limit: 12 });
  assert.equal(ranked[0].song._id, 'b');
  assert.ok(ranked[0].reason.includes('uplifting'));
});

test('calm_down promotes low energy and calm tagged songs', () => {
  const ranked = rankSongs(songs, { mood: 'angry', intention: 'calm_down', limit: 12 });
  assert.equal(ranked[0].song._id, 'c');
  assert.ok(ranked[0].reason.includes('low energy'));
});

test('surprise prefers alternatives while unknown moods safely fall back to variety', () => {
  const ranked = rankSongs(songs, { mood: 'happy', intention: 'surprise', limit: 12 });
  assert.notEqual(ranked[0].song._id, 'b');
  const unknown = rankSongs(songs, { mood: null, intention: 'match', limit: 12 });
  assert.equal(unknown.length, songs.length);
  assert.ok(unknown.every((item) => item.reason));
});

test('empty and sparse catalogs with missing metadata remain deterministic', () => {
  assert.deepEqual(rankSongs([], { mood: 'happy', intention: 'match' }), []);
  const sparse = [{ _id: 'b' }, { _id: 'a' }];
  assert.deepEqual(
    rankSongs(sparse, { mood: null, intention: 'match' }).map((item) => item.song._id),
    ['a', 'b'],
  );
});

test('repeated artists are separated when other candidates are available', () => {
  const ranked = rankSongs([
    { _id: '1', artist: 'Same', mood: 'happy' },
    { _id: '2', artist: 'Same', mood: 'happy' },
    { _id: '3', artist: 'Other', mood: 'happy' },
  ], { mood: 'happy', intention: 'match' });
  assert.equal(ranked[0].song.artist, 'Same');
  assert.equal(ranked[1].song.artist, 'Other');
});

test('candidate retrieval is bounded at the configured maximum', async () => {
  let maxCandidates;
  const model = {
    find() {
      const query = {
        sort() { return query; },
        limit(value) { maxCandidates = value; return query; },
        async lean() { return songs; },
      };
      return query;
    },
  };
  assert.equal((await getRecommendations(model, { mood: 'happy', intention: 'match', limit: 2 })).length, 2);
  assert.equal(maxCandidates, CANDIDATE_LIMIT);
});

test('song upload validates optional genre, energy, and bounded descriptive tags', () => {
  assert.deepEqual(validateSongMetadata({ title: 'Track', artist: 'Artist', mood: 'FEAR', genre: ' Ambient ', energy: 'LOW', tags: 'Calm, relaxing, calm' }), {
    title: 'Track', artist: 'Artist', mood: 'fearful', genre: 'ambient', energy: 'low', tags: ['calm', 'relaxing'],
  });
  assert.throws(() => validateSongMetadata({ title: 'Track', artist: 'Artist', mood: 'happy', energy: 'extreme' }), /energy must be/);
  assert.throws(() => validateSongMetadata({ title: 'Track', artist: 'Artist', mood: 'happy', tags: ['a', 'b', 'c', 'd', 'e', 'f'] }), /at most 5/);
});
