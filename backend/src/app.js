const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const createSongRouter = require('./routes/song.routes');
const ApiError = require('./utils/api-error');
const { createRateLimiters, getRateLimitConfig, InMemoryRateLimitStore } = require('./middleware/rate-limit');

const processRateLimitStore = new InMemoryRateLimitStore();

function normalizeError(error) {
  if (error instanceof ApiError) return error;

  if (error?.type === 'entity.parse.failed') {
    return new ApiError(400, 'INVALID_JSON', 'The JSON request body is malformed.');
  }
  if (error?.type === 'entity.too.large') {
    return new ApiError(413, 'REQUEST_TOO_LARGE', 'The request body is too large.');
  }
  if (error?.name === 'MulterError' && error.code === 'LIMIT_FILE_SIZE') {
    return new ApiError(413, 'UPLOAD_TOO_LARGE', 'The audio file exceeds the configured upload size limit.');
  }
  if (error?.name === 'MulterError') {
    return new ApiError(400, 'INVALID_MULTIPART', 'The multipart upload is invalid or contains unexpected fields.');
  }
  if (Number.isInteger(error?.status) && error.status >= 400 && error.status < 500) {
    return new ApiError(error.status, 'INVALID_REQUEST', 'The request could not be processed.');
  }
  return new ApiError(500, 'INTERNAL_ERROR', 'An unexpected server error occurred.');
}

function getCorsOrigins(configuredOrigins = process.env.CORS_ALLOWED_ORIGINS) {
  if (!configuredOrigins) {
    return new Set(['http://localhost:5173', 'http://127.0.0.1:5173']);
  }
  return new Set(configuredOrigins.split(',').map((origin) => origin.trim()).filter(Boolean));
}

function createApp(options = {}) {
  const app = express();
  const rateLimitConfig = options.rateLimitConfig || getRateLimitConfig();
  const rateLimiters = createRateLimiters({
    config: rateLimitConfig,
    store: options.rateLimitStore || processRateLimitStore,
  });
  if (rateLimitConfig.trustedProxyHops > 0) app.set('trust proxy', rateLimitConfig.trustedProxyHops);
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.set('X-Permitted-Cross-Domain-Policies', 'none');
    next();
  });
  const allowedOrigins = options.corsOrigins || getCorsOrigins();
  app.use(cors({
    origin(origin, callback) {
      callback(null, !origin || allowedOrigins.has(origin));
    },
  }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (req, res) => {
    const ready = options.isDatabaseReady
      ? options.isDatabaseReady()
      : mongoose.connection.readyState === 1;
    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready' });
  });
  app.get('/live', (req, res) => res.status(200).json({ status: 'live' }));

  app.use('/', createSongRouter({ ...options, rateLimiters }));
  app.use((req, res, next) => {
    next(new ApiError(404, 'NOT_FOUND', 'The requested endpoint was not found.'));
  });
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const safeError = normalizeError(error);
    if (safeError.status >= 500) {
      console.error('[api] Request failed', {
        method: req.method,
        path: req.path,
        code: safeError.code,
        errorName: error?.cause?.name || error?.name || 'Error',
      });
    }
    res.status(safeError.status).json({
      error: { code: safeError.code, message: safeError.message },
    });
  });

  return app;
}

const app = createApp();
app.createApp = createApp;
app.getCorsOrigins = getCorsOrigins;

module.exports = app;
