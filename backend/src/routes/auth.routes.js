const express = require('express');
const ApiError = require('../utils/api-error');
const { createAuthenticate, requireCsrf, requireTrustedOrigin } = require('../middleware/authentication');

function createAuthRouter({ authService, userModel, configProvider, allowedOrigins, rateLimiters = {} }) {
  const router = express.Router();
  const authenticate = createAuthenticate({ userModel, configProvider });
  const trustedOrigin = requireTrustedOrigin(allowedOrigins);
  const csrf = requireCsrf({ allowedOrigins, configProvider });

  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  function setAuthCookies(res, credentials) {
    const { cookie } = configProvider();
    const maxAge = Math.max(0, credentials.expiresAt.getTime() - Date.now());
    res.cookie(cookie.refreshName, credentials.refreshToken, {
      httpOnly: true,
      secure: cookie.secure,
      sameSite: cookie.sameSite,
      path: cookie.path,
      maxAge,
    });
    res.cookie(cookie.csrfName, credentials.csrfToken, {
      httpOnly: false,
      secure: cookie.secure,
      sameSite: cookie.sameSite,
      path: cookie.csrfPath,
      maxAge,
    });
  }

  function clearAuthCookies(res) {
    const { cookie } = configProvider();
    const options = { secure: cookie.secure, sameSite: cookie.sameSite, path: cookie.path };
    res.clearCookie(cookie.refreshName, { ...options, httpOnly: true });
    res.clearCookie(cookie.csrfName, { ...options, path: cookie.csrfPath, httpOnly: false });
  }

  function sendCredentials(res, credentials) {
    setAuthCookies(res, credentials);
    res.set('Cache-Control', 'no-store');
    res.status(200).json({
      accessToken: credentials.accessToken,
      expiresIn: credentials.expiresIn,
      user: credentials.user,
    });
  }

  router.post('/register', rateLimiters.register || ((req, res, next) => next()), trustedOrigin, async (req, res) => {
    const credentials = await authService.register(req.body);
    sendCredentials(res, credentials);
  });

  router.post('/login', rateLimiters.login || ((req, res, next) => next()), trustedOrigin, async (req, res) => {
    const credentials = await authService.login(req.body);
    sendCredentials(res, credentials);
  });

  router.post('/refresh', rateLimiters.refresh || ((req, res, next) => next()), csrf, async (req, res) => {
    const refreshToken = req.cookies?.[configProvider().cookie.refreshName];
    if (!refreshToken) throw new ApiError(401, 'AUTH_INVALID_SESSION', 'The session is invalid or has expired. Please sign in again.');
    const credentials = await authService.refresh(refreshToken);
    sendCredentials(res, credentials);
  });

  router.post('/logout', (req, res, next) => {
    const refreshToken = req.cookies?.[configProvider().cookie.refreshName];
    if (!refreshToken) return trustedOrigin(req, res, next);
    return csrf(req, res, next);
  }, async (req, res) => {
    const refreshToken = req.cookies?.[configProvider().cookie.refreshName];
    await authService.logout(refreshToken);
    clearAuthCookies(res);
    res.set('Cache-Control', 'no-store').status(204).end();
  });

  router.post('/logout-all', authenticate, csrf, async (req, res) => {
    await authService.logoutAll(req.auth.userId);
    clearAuthCookies(res);
    res.set('Cache-Control', 'no-store').status(204).end();
  });

  router.post('/password', authenticate, csrf, async (req, res) => {
    const { currentPassword, newPassword, ...unexpected } = req.body || {};
    if (Object.keys(unexpected).length || typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
      throw new ApiError(400, 'AUTH_INVALID_PASSWORD_CHANGE', 'Provide only the current and new password.');
    }
    const user = await authService.changePassword({
      userId: req.auth.userId,
      familyId: req.auth.familyId,
      currentPassword,
      newPassword,
    });
    res.set('Cache-Control', 'no-store').status(200).json({ user });
  });

  router.get('/me', authenticate, async (req, res) => {
    const user = await authService.getCurrentUser(req.auth.userId);
    res.set('Cache-Control', 'no-store').status(200).json({ user });
  });

  return router;
}

module.exports = createAuthRouter;
