import axios from 'axios';

const songApi = axios.create({
  baseURL: 'http://localhost:3000/songs',
});

export default songApi;
