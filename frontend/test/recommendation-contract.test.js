import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LISTENING_INTENTIONS,
  MOOD_OPTIONS,
  createRecommendationPayload,
} from '../src/api/recommendation-contract.js';

test('exposes the supported manual mood and listening intention choices', () => {
  assert.deepEqual(MOOD_OPTIONS, ['angry', 'disgusted', 'fearful', 'happy', 'neutral', 'sad', 'surprised']);
  assert.deepEqual(LISTENING_INTENTIONS.map(({ value }) => value), ['match', 'cheer_up', 'calm_down', 'surprise']);
});

test('builds bounded recommendation requests with optional mood and no client score', () => {
  assert.deepEqual(createRecommendationPayload({ mood: 'sad', intention: 'cheer_up', limit: 8 }), {
    mood: 'sad', intention: 'cheer_up', limit: 8,
  });
  assert.deepEqual(createRecommendationPayload({ intention: 'surprise' }), { intention: 'surprise', limit: 12 });
  assert.throws(() => createRecommendationPayload({ intention: 'unsupported' }), /intention/);
  assert.throws(() => createRecommendationPayload({ mood: 'custom' }), /mood/);
  assert.throws(() => createRecommendationPayload({ limit: 100 }), /limit/);
});
