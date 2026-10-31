import axios from 'axios';
import { fetchAllSongPages } from './paginated-songs';
import { createRecommendationPayload } from './recommendation-contract';

const songsUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/songs';
export const songApi = axios.create({ baseURL: songsUrl, withCredentials: true });
export const api = axios.create({ baseURL: songsUrl.replace(/\/songs\/?$/, ''), withCredentials: true });

let accessToken = null;
let accessTokenRevision = 0;
let refreshPromise = null;
export function setAccessToken(token) { accessToken = token || null; accessTokenRevision += 1; }
api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});
songApi.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

function csrfToken() {
  const prefix = 'moddy_csrf=';
  const entry = document.cookie.split('; ').find((cookie) => cookie.startsWith(prefix));
  return entry ? decodeURIComponent(entry.slice(prefix.length)) : '';
}

export async function refreshAuth() {
  if (!refreshPromise) {
    const revision = accessTokenRevision;
    refreshPromise = api.post('/auth/refresh', {}, { headers: { 'X-CSRF-Token': csrfToken() } })
      .then((response) => {
        if (revision !== accessTokenRevision) throw new Error('The account changed while the session was refreshing.');
        setAccessToken(response.data.accessToken);
        window.dispatchEvent(new CustomEvent('moddy:auth-restored', { detail: response.data.user }));
        return response.data.user;
      })
      .catch((error) => {
        if (revision === accessTokenRevision) {
          const hadSession = Boolean(accessToken || csrfToken());
          setAccessToken(null);
          if (hadSession) window.dispatchEvent(new CustomEvent('moddy:auth-expired'));
        }
        throw error;
      })
      .finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

function addAuthRecovery(client) {
  client.interceptors.response.use((response) => response, async (error) => {
    const request = error.config;
    const status = error.response?.status;
    const url = request?.url || '';
    if (status !== 401 || !request || request._authRetried || /\/auth\/(login|register|refresh)$/.test(url)) throw error;
    request._authRetried = true;
    await refreshAuth();
    return client(request);
  });
}
addAuthRecovery(api);
addAuthRecovery(songApi);
export async function login(credentials) {
  const response = await api.post('/auth/login', credentials);
  setAccessToken(response.data.accessToken);
  return response.data.user;
}
export async function register(credentials) {
  const response = await api.post('/auth/register', credentials);
  setAccessToken(response.data.accessToken);
  return response.data.user;
}
export async function logout() {
  try { await api.post('/auth/logout', {}, { headers: { 'X-CSRF-Token': csrfToken() } }); }
  finally { setAccessToken(null); }
}
export async function updateProfile(profile) {
  const response = await api.patch('/users/me', profile);
  return response.data.user;
}
export async function changePassword(values) {
  const response = await api.post('/auth/password', values, { headers: { 'X-CSRF-Token': csrfToken() } });
  return response.data.user;
}

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
