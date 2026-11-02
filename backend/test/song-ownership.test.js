const assert = require('node:assert/strict');
const { test } = require('node:test');
const Song = require('../src/models/song.model');
const Favorite = require('../src/models/favorite.model');
const Playlist = require('../src/models/playlist.model');
const { accessibleSongFilter, ownedPrivateSongFilter, publicCatalogFilter } = require('../src/service/song-access.service');

test('song ownership and catalog metadata have constrained values and private projections', async () => {
  const song = new Song({ title: 'Track', artist: 'Artist', audio: 'https://media.example.test/track', mood: 'happy' });
  await song.validate();
  assert.equal(song.visibility, 'private');
  assert.equal(song.uploadSource, 'legacy');
  assert.equal(song.catalogStatus, undefined);
  assert.equal(Song.schema.path('uploadedBy').options.select, false);
  assert.equal(Song.schema.path('storageFileId').options.select, false);
  assert.equal(Song.schema.path('aiSuggestions').options.select, false);
  assert.equal(Song.schema.path('metadataProvenance').options.select, false);

  song.uploadSource = 'other';
  await assert.rejects(song.validate(), /uploadSource/);
  song.uploadSource = 'user';
  song.visibility = 'public';
  song.catalogStatus = 'pending';
  await assert.rejects(song.validate(), /visibility|catalogStatus/);
});

test('favorite and playlist models bound duplicate references and index user lookups', async () => {
  assert.ok(Favorite.schema.indexes().some(([keys, options]) => keys.userId === 1 && keys.songId === 1 && options.unique));
  assert.ok(Favorite.schema.indexes().some(([keys]) => keys.userId === 1 && keys.createdAt === -1));
  assert.ok(Playlist.schema.indexes().some(([keys]) => keys.userId === 1 && keys.updatedAt === -1));

  const playlist = new Playlist({
    userId: '507f1f77bcf86cd799439011',
    name: 'Favorites',
    songIds: ['507f1f77bcf86cd799439012', '507f1f77bcf86cd799439012'],
  });
  await assert.rejects(playlist.validate(), /unique songs/);
  playlist.songIds = Array.from({ length: 501 }, (_, index) => String(index + 1).padStart(24, '0'));
  await assert.rejects(playlist.validate(), /unique songs/);
});

test('song-access filters include approved catalog and legacy records while isolating private ownership', () => {
  const ownerId = '507f1f77bcf86cd799439011';
  const publicFilter = publicCatalogFilter();
  assert.ok(publicFilter.$and.some((condition) => condition.$or?.some((entry) => entry.catalogStatus === 'approved')));
  assert.ok(publicFilter.$and.some((condition) => condition.$or?.some((entry) => entry.catalogStatus?.$exists === false)));
  assert.ok(publicFilter.$and.some((condition) => condition.$or?.some((entry) => entry.visibility === 'public')));
  for (const condition of publicFilter.$and.slice(0, 3)) {
    const legacyGate = condition.$or.find((entry) => entry.visibility?.$exists === false);
    assert.equal(legacyGate?.ownerId?.$exists, false);
    assert.equal(legacyGate?.uploadedBy?.$exists, false);
  }
  assert.deepEqual(ownedPrivateSongFilter(ownerId), {
    visibility: 'private',
    uploadSource: 'user',
    mediaStatus: 'active',
    $or: [{ uploadedBy: ownerId }, { ownerId }],
  });
  const authenticatedFilter = accessibleSongFilter(ownerId, ['507f1f77bcf86cd799439012']);
  assert.equal(authenticatedFilter._id.$in.length, 1);
  assert.equal(authenticatedFilter.$or.length, 2);
  const anonymousFilter = accessibleSongFilter(null, ['507f1f77bcf86cd799439012']);
  assert.equal(anonymousFilter.$or.length, 1);
});
