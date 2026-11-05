const express = require('express');
const { createAuthenticate } = require('../middleware/authentication');

function createUserRouter({ authService, userModel, configProvider, rateLimiters = {} }) {
  const router = express.Router();
  const authenticate = createAuthenticate({ userModel, configProvider });

  router.get('/me', authenticate, async (req, res) => {
    const user = await authService.getCurrentUser(req.auth.userId);
    res.set('Cache-Control', 'no-store').status(200).json({ user });
  });

  router.patch('/me', rateLimiters.profile || ((req, res, next) => next()), authenticate, async (req, res) => {
    const user = await authService.updateProfile(req.auth.userId, req.body);
    res.set('Cache-Control', 'no-store').status(200).json({ user });
  });

  return router;
}

module.exports = createUserRouter;
