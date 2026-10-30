import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getAdjacentSongIndex } from '../src/lib/playback-navigation.js';

test('navigation wraps at either end of a queue', () => {
  assert.equal(getAdjacentSongIndex(0, 3, -1), 2);
  assert.equal(getAdjacentSongIndex(2, 3, 1), 0);
  assert.equal(getAdjacentSongIndex(0, 1, 1), 0);
});

test('navigation stays correct across rapid repeated track changes', () => {
  let index = 0;
  index = getAdjacentSongIndex(index, 4, 1);
  index = getAdjacentSongIndex(index, 4, 1);
  index = getAdjacentSongIndex(index, 4, -1);
  assert.equal(index, 1);
});

test('navigation selects a sensible first or last item for an unknown current track', () => {
  assert.equal(getAdjacentSongIndex(-1, 3, 1), 0);
  assert.equal(getAdjacentSongIndex(-1, 3, -1), 2);
  assert.equal(getAdjacentSongIndex(0, 0, 1), -1);
});
