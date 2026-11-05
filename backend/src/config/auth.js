const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 600;
const MAX_ACCESS_TOKEN_TTL_SECONDS = 3_600;
const DEFAULT_REFRESH_TTL_DAYS = 30;
const MAX_REFRESH_TTL_DAYS = 90;

function readBoundedInteger(value, name, fallback, minimum, maximum) {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(String(value))) throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return number;
}

function readBoolean(value, name) {
  if (value === undefined || value === '') return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false.`);
}

function getAuthConfig(env = process.env) {
  const accessTokenSecret = env.AUTH_ACCESS_TOKEN_SECRET;
  if (typeof accessTokenSecret !== 'string' || Buffer.byteLength(accessTokenSecret, 'utf8') < 32) {
    throw new Error('AUTH_ACCESS_TOKEN_SECRET must contain at least 32 bytes of random data.');
  }

  const accessTokenTtlSeconds = readBoundedInteger(
    env.AUTH_ACCESS_TOKEN_TTL_SECONDS,
    'AUTH_ACCESS_TOKEN_TTL_SECONDS',
    DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
    60,
    MAX_ACCESS_TOKEN_TTL_SECONDS,
  );
  const refreshTtlDays = readBoundedInteger(
    env.AUTH_REFRESH_TTL_DAYS,
    'AUTH_REFRESH_TTL_DAYS',
    DEFAULT_REFRESH_TTL_DAYS,
    1,
    MAX_REFRESH_TTL_DAYS,
  );
  const sameSite = (env.AUTH_COOKIE_SAME_SITE || 'lax').toLowerCase();
  if (!['lax', 'strict', 'none'].includes(sameSite)) {
    throw new Error('AUTH_COOKIE_SAME_SITE must be lax, strict, or none.');
  }
  const explicitSecure = readBoolean(env.AUTH_COOKIE_SECURE, 'AUTH_COOKIE_SECURE');
  const secure = explicitSecure ?? env.NODE_ENV === 'production';
  if (env.NODE_ENV === 'production' && !secure) {
    throw new Error('AUTH_COOKIE_SECURE must be true in production.');
  }
  if (sameSite === 'none' && !secure) {
    throw new Error('AUTH_COOKIE_SECURE must be true when AUTH_COOKIE_SAME_SITE is none.');
  }

  return Object.freeze({
    accessTokenSecret,
    accessTokenTtlSeconds,
    refreshTtlDays,
    cookie: Object.freeze({
      refreshName: 'moddy_refresh',
      csrfName: 'moddy_csrf',
      path: '/auth',
      csrfPath: '/',
      sameSite,
      secure,
    }),
  });
}

module.exports = { getAuthConfig, readBoundedInteger };
