import axios from 'axios';
import { fetchAllSongPages } from './paginated-songs';
import { createRecommendationPayload } from './recommendation-contract';

const songsUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/songs';
const songApi = axios.create({ baseURL: songsUrl });
const api = axios.create({ baseURL: songsUrl.replace(/\/songs\/?$/, '') });

export function fetchSongsByMood(mood, { signal } = {}) {
  return fetchAllSongPages((page, limit) => songApi
    .get('/', { params: { mood, page, limit }, signal })
    .then((response) => response.data));
}

export async function fetchRecommendations({ mood, intention = 'match', limit = 12 }, { signal } = {}) {
  const payload = createRecommendationPayload({ mood, intention, limit });
  const response = await api.post('/recommendations', payload, { signal });
  return response.data;
}

function getFeedbackSessionId() {
  const storageKey = 'moddy-feedback-session';
  let sessionId = window.sessionStorage.getItem(storageKey);
  if (!sessionId) {
    if (window.crypto.randomUUID) {
      sessionId = window.crypto.randomUUID();
    } else {
      const bytes = window.crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      sessionId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    window.sessionStorage.setItem(storageKey, sessionId);
  }
  return sessionId;
}

export function sendFeedback({ songId, event, intention = 'match' }) {
  return api.post('/feedback', {
    sessionId: getFeedbackSessionId(),
    songId,
    event,
    intention,
  });
}

export default songApi;
