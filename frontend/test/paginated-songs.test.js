import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchAllSongPages } from '../src/api/paginated-songs.js';

function response(page, total, songs) {
  return {
    songs,
    pagination: {
      page,
      limit: 100,
      total,
      totalPages: Math.ceil(total / 100),
    },
  };
}

test('fetches every consistent page and preserves song order', async () => {
  const pages = [];
  const songs = await fetchAllSongPages(async (page, limit) => {
    pages.push({ page, limit });
    return page === 1
      ? response(1, 101, Array.from({ length: 100 }, (_, index) => index))
      : response(2, 101, [100]);
  });

  assert.deepEqual(pages, [{ page: 1, limit: 100 }, { page: 2, limit: 100 }]);
  assert.equal(songs.length, 101);
  assert.equal(songs[100], 100);
});

test('returns an empty catalog without requesting a nonexistent second page', async () => {
  let requestCount = 0;
  const songs = await fetchAllSongPages(async () => {
    requestCount += 1;
    return response(1, 0, []);
  });

  assert.deepEqual(songs, []);
  assert.equal(requestCount, 1);
});

test('rejects malformed pagination metadata and unexpected page sizes', async () => {
  await assert.rejects(
    fetchAllSongPages(async () => ({ songs: [], pagination: { page: 1, limit: 100, total: 1, totalPages: 0 } })),
    /invalid pagination data/,
  );
  await assert.rejects(
    fetchAllSongPages(async () => response(1, 101, [])),
  );
});

test('rejects catalogs over the configured page limit', async () => {
  await assert.rejects(
    fetchAllSongPages(async () => response(1, 201, Array(100).fill('song')), { maxPages: 2 }),
    /exceeds the 2-page limit/,
  );
});

test('rejects metadata that changes between pages', async () => {
  await assert.rejects(
    fetchAllSongPages(async (page) => page === 1
      ? response(1, 101, Array(100).fill('song'))
      : response(2, 102, ['song'])),
  );
});
