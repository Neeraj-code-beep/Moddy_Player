import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatPlaybackTime } from '../src/lib/format-playback-time.js';

test('formats playback time as minutes and zero-padded seconds', () => {
  assert.equal(formatPlaybackTime(0), '0:00');
  assert.equal(formatPlaybackTime(9.9), '0:09');
  assert.equal(formatPlaybackTime(65), '1:05');
  assert.equal(formatPlaybackTime(3600), '60:00');
});

test('uses a safe placeholder for invalid playback durations', () => {
  assert.equal(formatPlaybackTime(Number.NaN), '0:00');
  assert.equal(formatPlaybackTime(Infinity), '0:00');
  assert.equal(formatPlaybackTime(-1), '0:00');
});
