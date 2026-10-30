export const MOOD_OPTIONS = Object.freeze([
  'angry', 'disgusted', 'fearful', 'happy', 'neutral', 'sad', 'surprised',
]);

export const LISTENING_INTENTIONS = Object.freeze([
  Object.freeze({ value: 'match', label: 'Match my mood' }),
  Object.freeze({ value: 'cheer_up', label: 'Cheer me up' }),
  Object.freeze({ value: 'calm_down', label: 'Calm me down' }),
  Object.freeze({ value: 'surprise', label: 'Surprise me' }),
]);

export function createRecommendationPayload({ mood, intention = 'match', limit = 12 } = {}) {
  const supportedIntentions = LISTENING_INTENTIONS.map(({ value }) => value);
  if (!supportedIntentions.includes(intention)) throw new Error('Unsupported listening intention.');
  if (mood !== undefined && mood !== null && mood !== '' && !MOOD_OPTIONS.includes(mood)) {
    throw new Error('Unsupported mood.');
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error('Invalid recommendation limit.');
  return { ...(mood ? { mood } : {}), intention, limit };
}
