const ApiError = require('../utils/api-error');

const DEFAULT_WINDOW_MS = 60_000;
const MAX_WINDOW_MS = 3_600_000;
const MAX_STORE_ENTRIES = 20_000;

function readInteger(value, name, fallback, min, max) {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(String(value))) throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return number;
}

function getRateLimitConfig(env = process.env) {
  return {
    windowMs: readInteger(env.RATE_LIMIT_WINDOW_MS, 'RATE_LIMIT_WINDOW_MS', DEFAULT_WINDOW_MS, 1_000, MAX_WINDOW_MS),
    upload: readInteger(env.RATE_LIMIT_UPLOAD_MAX, 'RATE_LIMIT_UPLOAD_MAX', 3, 1, 10_000),
    feedback: readInteger(env.RATE_LIMIT_FEEDBACK_MAX, 'RATE_LIMIT_FEEDBACK_MAX', 30, 1, 100_000),
    recommendation: readInteger(env.RATE_LIMIT_RECOMMENDATION_MAX, 'RATE_LIMIT_RECOMMENDATION_MAX', 60, 1, 100_000),
    catalog: readInteger(env.RATE_LIMIT_CATALOG_MAX, 'RATE_LIMIT_CATALOG_MAX', 120, 1, 100_000),
    trustedProxyHops: readInteger(env.TRUSTED_PROXY_HOPS, 'TRUSTED_PROXY_HOPS', 0, 0, 10),
  };
}

class InMemoryRateLimitStore {
  constructor({ maxEntries = MAX_STORE_ENTRIES, now = Date.now } = {}) {
    this.maxEntries = maxEntries;
    this.now = now;
    this.entries = new Map();
    this.operations = 0;
  }

  prune(now) {
    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= now) this.entries.delete(key);
    }
  }

  async consume(key, windowMs) {
    const now = this.now();
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const bucketKey = `${key}:${windowMs}:${windowStart}`;
    let entry = this.entries.get(bucketKey);
    if (!entry) {
      if (++this.operations % 256 === 0 || this.entries.size >= this.maxEntries) this.prune(now);
      if (this.entries.size >= this.maxEntries) throw new Error('Rate limit store capacity reached.');
      entry = { count: 0, resetAt: windowStart + windowMs };
      this.entries.set(bucketKey, entry);
    }
    entry.count += 1;
    return { count: entry.count, resetAt: entry.resetAt };
  }
}

function createRateLimiter({ name, limit, windowMs, store }) {
  if (!store || typeof store.consume !== 'function') {
    throw new TypeError('rateLimitStore must implement async consume(key, windowMs).');
  }
  return async function rateLimiter(req, res, next) {
    res.set('RateLimit-Limit', String(limit));
    try {
      const result = await store.consume(`${name}:${req.ip}`, windowMs);
      if (!Number.isSafeInteger(result?.count) || result.count < 1 || !Number.isFinite(result.resetAt)) {
        throw new Error('Rate limit store returned an invalid result.');
      }
      const remaining = Math.max(0, limit - result.count);
      const reset = Math.max(0, Math.ceil((result.resetAt - Date.now()) / 1000));
      res.set('RateLimit-Remaining', String(remaining));
      res.set('RateLimit-Reset', String(reset));
      if (result.count > limit) {
        res.set('Retry-After', String(Math.max(1, reset)));
        return next(new ApiError(429, 'RATE_LIMITED', 'Too many requests. Please retry after the current limit window.'));
      }
      return next();
    } catch (error) {
      if (error instanceof ApiError) return next(error);
      console.error('[api] Rate limit store failed', { scope: name, errorName: error?.name || 'Error' });
      return next(new ApiError(503, 'RATE_LIMITER_UNAVAILABLE', 'Request protection is temporarily unavailable.'));
    }
  };
}

function createRateLimiters({ config = getRateLimitConfig(), store = new InMemoryRateLimitStore() } = {}) {
  return Object.fromEntries(['upload', 'feedback', 'recommendation', 'catalog'].map((name) => [
    name,
    createRateLimiter({ name, limit: config[name], windowMs: config.windowMs, store }),
  ]));
}

module.exports = { InMemoryRateLimitStore, createRateLimiters, getRateLimitConfig };
