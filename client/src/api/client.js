import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

const client = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

// ── Request interceptor — attach JWT ────────────────────────────────────────
client.interceptors.request.use((config) => {
  const token = localStorage.getItem('church_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── Response interceptor — handle 401 ───────────────────────────────────────
// If a request returns 401 (expired or invalid token), clear auth state
// and redirect to login. Handles the "tab left open overnight" scenario.
client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('church_token');
      localStorage.removeItem('church_user');
      // Hard redirect — clears all in-memory state cleanly
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default client;
