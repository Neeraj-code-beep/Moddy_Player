import axios from 'axios';
import { fetchAllSongPages } from './paginated-songs';

const songApi = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/songs',
});

export function fetchSongsByMood(mood, { signal } = {}) {
  return fetchAllSongPages((page, limit) => songApi
    .get('/', { params: { mood, page, limit }, signal })
    .then((response) => response.data));
}

export default songApi;
