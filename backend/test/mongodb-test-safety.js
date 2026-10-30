const INTEGRATION_DATABASE_NAME = 'moddy_player_integration_test';
const PROTECTED_DATABASE_NAMES = new Set(['second_db', 'test', 'sample_mflix']);

function makeIsolatedMongoUrl(sourceUrl) {
  let uri;
  try {
    uri = new URL(sourceUrl);
  } catch {
    throw new Error('MONGODB_INTEGRATION_URL must be a valid MongoDB URI.');
  }
  if (!['mongodb:', 'mongodb+srv:'].includes(uri.protocol)) {
    throw new Error('MONGODB_INTEGRATION_URL must use a MongoDB URI.');
  }

  let databaseName;
  try {
    databaseName = decodeURIComponent(uri.pathname.slice(1));
  } catch {
    throw new Error(`MONGODB_INTEGRATION_URL must target ${INTEGRATION_DATABASE_NAME}.`);
  }
  if (databaseName !== INTEGRATION_DATABASE_NAME) {
    throw new Error(`MONGODB_INTEGRATION_URL must target ${INTEGRATION_DATABASE_NAME}.`);
  }
  for (const [key, value] of uri.searchParams) {
    const normalizedKey = key.toLowerCase();
    if (normalizedKey === 'dbname' && value !== INTEGRATION_DATABASE_NAME) {
      throw new Error(`MONGODB_INTEGRATION_URL must target ${INTEGRATION_DATABASE_NAME}.`);
    }
    if (normalizedKey === 'authsource' && PROTECTED_DATABASE_NAMES.has(value.toLowerCase())) {
      throw new Error('MONGODB_INTEGRATION_URL cannot authenticate against a protected application database.');
    }
  }

  return uri.toString();
}

function sanitizeMongoText(value, limit = 500) {
  let message = String(value || 'No error message provided')
    .replace(/mongodb(?:\+srv)?:\/\/[^\s"'`]+/gi, '[redacted MongoDB URI]')
    .replace(/\b[^\s/:@]+:[^\s/@]+@/g, '[redacted credentials]@')
    .replace(/\b(password|passwd|pwd|username|user)\s*[:=]\s*[^,\s;]+/gi, '$1=[redacted]')
    .replace(/(["'`])[^"'`]*\1/g, '[redacted value]')
    .replace(/\b(?:sessionId|songId|value)\s*[:=]\s*[^,\s;]+/gi, '[redacted field]')
    .replace(/\[[\da-f:.]+\](?::\d+)?/gi, '[redacted host]')
    .replace(/\b(?:[a-f\d]{0,4}:){2,}[a-f\d:]{0,4}(?::\d+)?\b/gi, '[redacted host]')
    .replace(/\blocalhost(?::\d+)?\b/gi, '[redacted host]')
    .replace(/\b(?:[a-z\d_-]+\.)+[a-z\d_-]+(?::\d+)?\b/gi, '[redacted host]')
    .slice(0, limit);
  if (/authentication|credential|sasl|scram/i.test(message)) {
    message = 'Authentication-related MongoDB connection failure (details redacted).';
  }
  return message;
}

function sanitizeMongoError(error, depth = 0) {
  if (!error || depth > 2) return undefined;
  const diagnostic = {
    name: String(error.name || 'Error').slice(0, 100),
    code: typeof error.code === 'number' || typeof error.code === 'string' ? error.code : undefined,
    codeName: typeof error.codeName === 'string' ? error.codeName.slice(0, 100) : undefined,
    message: sanitizeMongoText(error.message),
    stack: typeof error.stack === 'string' ? sanitizeMongoText(error.stack, 1_500) : undefined,
  };
  for (const property of ['path', 'kind']) {
    if (typeof error[property] === 'string') diagnostic[property] = sanitizeMongoText(error[property], 100);
  }
  if (typeof error.modelName === 'string') diagnostic.modelName = sanitizeMongoText(error.modelName, 100);
  if (error.model?.modelName) diagnostic.modelName = sanitizeMongoText(error.model.modelName, 100);
  if (error.errors && typeof error.errors === 'object') diagnostic.validationPaths = Object.keys(error.errors).slice(0, 20);
  if (error.cause) diagnostic.cause = sanitizeMongoError(error.cause, depth + 1);
  else if (error.reason instanceof Error) diagnostic.cause = sanitizeMongoError(error.reason, depth + 1);
  return diagnostic;
}

function assertIntegrationDatabase(connection) {
  if (connection.db?.databaseName !== INTEGRATION_DATABASE_NAME) {
    throw new Error(`Refusing to use a MongoDB database other than ${INTEGRATION_DATABASE_NAME}.`);
  }
}

async function dropIntegrationDatabase(connection) {
  assertIntegrationDatabase(connection);
  await connection.dropDatabase();
}

module.exports = {
  INTEGRATION_DATABASE_NAME,
  PROTECTED_DATABASE_NAMES,
  assertIntegrationDatabase,
  dropIntegrationDatabase,
  makeIsolatedMongoUrl,
  sanitizeMongoError,
  sanitizeMongoText,
};
