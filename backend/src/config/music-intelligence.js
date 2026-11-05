const DEFAULT_MODEL = 'gemini-3.8-flash';
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_CONCURRENCY = 2;
const DEFAULT_LEASE_MS = 120_000;

function boundedInteger(value, name, fallback, min, max) {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(String(value))) throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return number;
}

function getMusicIntelligenceConfig(env = process.env) {
  const provider = (env.MUSIC_AI_PROVIDER || 'gemini').trim().toLowerCase();
  if (provider !== 'gemini') throw new Error('MUSIC_AI_PROVIDER must be gemini.');
  const model = (env.GEMINI_MODEL || DEFAULT_MODEL).trim();
  if (!/^[a-zA-Z0-9._-]{1,100}$/.test(model)) throw new Error('GEMINI_MODEL must be a valid model identifier.');
  const apiBaseUrl = (env.GEMINI_API_BASE_URL || 'https://generativelanguage.googleapis.com').trim();
  let endpoint;
  try { endpoint = new URL(apiBaseUrl); } catch { throw new Error('GEMINI_API_BASE_URL must be a valid HTTPS URL.'); }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('GEMINI_API_BASE_URL must be a valid HTTPS URL without credentials or query parameters.');
  }
  const timeoutMs = boundedInteger(env.MUSIC_AI_TIMEOUT_MS, 'MUSIC_AI_TIMEOUT_MS', DEFAULT_TIMEOUT_MS, 1_000, 180_000);
  const leaseMs = boundedInteger(env.MUSIC_AI_JOB_LEASE_MS, 'MUSIC_AI_JOB_LEASE_MS', DEFAULT_LEASE_MS, 10_000, 600_000);
  if (leaseMs <= timeoutMs + 40_000) throw new Error('MUSIC_AI_JOB_LEASE_MS must exceed MUSIC_AI_TIMEOUT_MS by at least 40000 ms.');
  return Object.freeze({
    provider,
    apiKey: env.GEMINI_API_KEY || '',
    enabled: Boolean(env.GEMINI_API_KEY),
    model,
    apiBaseUrl: endpoint.origin + endpoint.pathname.replace(/\/$/, ''),
    timeoutMs,
    maxAttempts: boundedInteger(env.MUSIC_AI_MAX_ATTEMPTS, 'MUSIC_AI_MAX_ATTEMPTS', DEFAULT_MAX_ATTEMPTS, 1, 10),
    concurrency: boundedInteger(env.MUSIC_AI_WORKER_CONCURRENCY, 'MUSIC_AI_WORKER_CONCURRENCY', DEFAULT_CONCURRENCY, 1, 16),
    leaseMs,
    retryBaseMs: boundedInteger(env.MUSIC_AI_RETRY_BASE_MS, 'MUSIC_AI_RETRY_BASE_MS', 2_000, 100, 300_000),
  });
}

module.exports = { getMusicIntelligenceConfig };
