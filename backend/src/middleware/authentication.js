const crypto = require('node:crypto');
const mongoose = require('mongoose');
const ApiError = require('../utils/api-error');
const { verifyAccessToken } = require('../service/token.service');

function createAuthenticate({ userModel, configProvider, now = () => new Date() }) {
  return async function authenticate(req, res, next) {
    const authorization = req.get('authorization') || '';
    const match = /^Bearer ([A-Za-z0-9._~-]{1,4096})$/.exec(authorization);
    if (!match) return next(new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required.'));

    let claims;
    try {
      claims = verifyAccessToken(match[1], configProvider(), now());
    } catch {
      return next(new ApiError(401, 'AUTH_INVALID_TOKEN', 'The access token is invalid or has expired.'));
    }
    if (!mongoose.isValidObjectId(claims.sub)) {
      return next(new ApiError(401, 'AUTH_INVALID_TOKEN', 'The access token is invalid or has expired.'));
    }
    const user = await userModel.findById(claims.sub);
    if (!user || user.status !== 'active') {
      return next(new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required.'));
    }
    req.user = user;
    req.auth = { userId: String(user._id || user.id), familyId: claims.sid, tokenId: claims.jti };
    return next();
  };
}

function requireRole(...roles) {
  return function authorize(req, res, next) {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new ApiError(403, 'FORBIDDEN', 'You do not have permission to perform this action.'));
    }
    return next();
  };
}

function createOptionalAuthenticate({ userModel, configProvider, now = () => new Date() }) {
  const authenticate = createAuthenticate({ userModel, configProvider, now });
  return function optionalAuthenticate(req, res, next) {
    if (!req.get('authorization')) return next();
    return authenticate(req, res, next);
  };
}

function requireTrustedOrigin(allowedOrigins) {
  return function validateOrigin(req, res, next) {
    const origin = req.get('origin');
    if (typeof origin !== 'string' || !allowedOrigins.has(origin)) {
      return next(new ApiError(403, 'CSRF_ORIGIN_REJECTED', 'The request origin is not allowed.'));
    }
    return next();
  };
}

function requireCsrf({ allowedOrigins, configProvider }) {
  const validateOrigin = requireTrustedOrigin(allowedOrigins);
  return function validateCsrf(req, res, next) {
    validateOrigin(req, res, (originError) => {
      if (originError) return next(originError);
      const cookieName = configProvider().cookie.csrfName;
      const cookieToken = req.cookies?.[cookieName];
      const headerToken = req.get('x-csrf-token');
      if (typeof cookieToken !== 'string' || typeof headerToken !== 'string') {
        return next(new ApiError(403, 'CSRF_TOKEN_REQUIRED', 'A valid CSRF token is required.'));
      }
      const cookieBytes = Buffer.from(cookieToken, 'utf8');
      const headerBytes = Buffer.from(headerToken, 'utf8');
      if (cookieBytes.length !== headerBytes.length || !crypto.timingSafeEqual(cookieBytes, headerBytes)) {
        return next(new ApiError(403, 'CSRF_TOKEN_INVALID', 'A valid CSRF token is required.'));
      }
      return next();
    });
  };
}

module.exports = { createAuthenticate, createOptionalAuthenticate, requireCsrf, requireRole, requireTrustedOrigin };
