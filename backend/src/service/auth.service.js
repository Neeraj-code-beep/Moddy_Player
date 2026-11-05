const crypto = require('node:crypto');
const mongoose = require('mongoose');
const ApiError = require('../utils/api-error');
const { getDummyPasswordHash, hashPassword, validatePassword, verifyPassword } = require('./password.service');
const { normalizeEmail, validateLogin, validateProfileUpdate, validateRegistration } = require('./auth-validation.service');
const { createAccessToken, createCsrfToken, createRefreshToken, hashOpaqueToken } = require('./token.service');

function publicUser(user) {
  if (!user) return null;
  const value = typeof user.toObject === 'function' ? user.toObject() : { ...user };
  const id = String(value._id || value.id || '');
  delete value._id;
  delete value.id;
  delete value.passwordHash;
  delete value.__v;
  return { id, name: value.name, email: value.email, role: value.role, avatarUrl: value.avatarUrl || null, bio: value.bio || '', createdAt: value.createdAt, lastLoginAt: value.lastLoginAt || null };
}

function invalidCredentials() {
  return new ApiError(401, 'AUTH_INVALID_CREDENTIALS', 'Email or password is incorrect.');
}

function invalidRefreshToken() {
  return new ApiError(401, 'AUTH_INVALID_SESSION', 'The session is invalid or has expired. Please sign in again.');
}

function isDuplicateEmail(error) {
  return error?.code === 11000 && (
    error.keyPattern?.email === 1 ||
    Object.hasOwn(error.keyValue || {}, 'email')
  );
}

function createAuthService({
  userModel,
  sessionModel,
  configProvider,
  imageKitEndpoint = process.env.IMAGEKIT_URL_ENDPOINT,
  mongo = mongoose,
  now = () => new Date(),
}) {
  if (!userModel || !sessionModel || typeof configProvider !== 'function') {
    throw new TypeError('Auth service requires user, session, and configuration providers.');
  }

  function issueAccessToken(user, familyId, config) {
    return createAccessToken({ userId: user._id || user.id, familyId, role: user.role }, config, now());
  }

  async function createSessionCredentials(user, familyId = crypto.randomUUID(), transaction) {
    const config = configProvider();
    const refreshToken = createRefreshToken();
    const csrfToken = createCsrfToken();
    const expiresAt = new Date(now().getTime() + config.refreshTtlDays * 24 * 60 * 60 * 1000);
    const sessionRecord = {
      userId: user._id || user.id,
      familyId,
      tokenHash: hashOpaqueToken(refreshToken),
      status: 'active',
      expiresAt,
    };
    if (transaction) await sessionModel.create([sessionRecord], { session: transaction });
    else await sessionModel.create(sessionRecord);
    return {
      accessToken: issueAccessToken(user, familyId, config),
      refreshToken,
      csrfToken,
      expiresAt,
      expiresIn: config.accessTokenTtlSeconds,
      user: publicUser(user),
    };
  }

  async function register(body) {
    const validation = validateRegistration(body);
    if (validation.error) throw new ApiError(400, 'AUTH_INVALID_REGISTRATION', validation.error);
    const { name, email, password } = validation.value;
    if (await userModel.findOne({ email })) {
      throw new ApiError(409, 'AUTH_REGISTRATION_UNAVAILABLE', 'Unable to create an account with those details.');
    }
    const passwordHash = await hashPassword(password);
    const transaction = await mongo.startSession();
    let credentials;
    try {
      await transaction.withTransaction(async () => {
        const [user] = await userModel.create([{ name, email, passwordHash, role: 'user' }], { session: transaction });
        credentials = await createSessionCredentials(user, undefined, transaction);
      });
    } catch (error) {
      if (isDuplicateEmail(error)) {
        throw new ApiError(409, 'AUTH_REGISTRATION_UNAVAILABLE', 'Unable to create an account with those details.');
      }
      throw error;
    } finally {
      await transaction.endSession();
    }
    return credentials;
  }

  async function login(body) {
    const validation = validateLogin(body);
    if (validation.error) throw new ApiError(400, 'AUTH_INVALID_LOGIN', validation.error);
    const { email, password } = validation.value;
    let query = userModel.findOne({ email });
    if (typeof query?.select === 'function') query = query.select('+passwordHash');
    const user = await query;
    const passwordHash = user?.passwordHash || await getDummyPasswordHash();
    const passwordMatches = await verifyPassword(passwordHash, password);
    if (!user || !passwordMatches || user.status !== 'active') throw invalidCredentials();
    user.lastLoginAt = now();
    if (typeof user.save === 'function') await user.save();
    return createSessionCredentials(user);
  }

  async function revokeFamily(session) {
    await sessionModel.updateMany(
      { userId: session.userId, familyId: session.familyId, status: { $ne: 'revoked' } },
      { $set: { status: 'revoked', revokedAt: now() } },
    );
  }

  async function refresh(rawToken) {
    if (typeof rawToken !== 'string' || rawToken.length < 40 || rawToken.length > 256) throw invalidRefreshToken();
    const oldHash = hashOpaqueToken(rawToken);
    const current = await sessionModel.findOne({ tokenHash: oldHash });
    if (!current || current.status === 'revoked' || current.expiresAt <= now()) throw invalidRefreshToken();
    if (current.status === 'rotated') {
      await revokeFamily(current);
      throw invalidRefreshToken();
    }

    const user = await userModel.findById(current.userId);
    if (!user || user.status !== 'active') {
      await revokeFamily(current);
      throw invalidRefreshToken();
    }

    const config = configProvider();
    const replacementToken = createRefreshToken();
    const replacementHash = hashOpaqueToken(replacementToken);
    const replacementId = new mongoose.Types.ObjectId();
    const csrfToken = createCsrfToken();
    const expiresAt = new Date(now().getTime() + config.refreshTtlDays * 24 * 60 * 60 * 1000);
    const transaction = await mongo.startSession();
    let rotationConflict = false;
    try {
      await transaction.withTransaction(async () => {
        const consumed = await sessionModel.findOneAndUpdate(
          {
            _id: current._id,
            tokenHash: oldHash,
            status: 'active',
            revokedAt: null,
            expiresAt: { $gt: now() },
          },
          { $set: { status: 'rotated', lastUsedAt: now(), replacedBySessionId: replacementId } },
          { new: true, session: transaction },
        );
        if (!consumed) {
          rotationConflict = true;
          throw new Error('AUTH_ROTATION_CONFLICT');
        }
        await sessionModel.create([{
          _id: replacementId,
          userId: current.userId,
          familyId: current.familyId,
          tokenHash: replacementHash,
          status: 'active',
          expiresAt,
        }], { session: transaction });
      });
    } catch (error) {
      if (rotationConflict) {
        const staleToken = await sessionModel.findOne({ tokenHash: oldHash });
        if (staleToken?.status === 'rotated') await revokeFamily(staleToken);
        throw invalidRefreshToken();
      }
      throw error;
    } finally {
      await transaction.endSession();
    }

    return {
      accessToken: issueAccessToken(user, current.familyId, config),
      refreshToken: replacementToken,
      csrfToken,
      expiresAt,
      expiresIn: config.accessTokenTtlSeconds,
      user: publicUser(user),
    };
  }

  async function logout(rawToken) {
    if (typeof rawToken !== 'string' || rawToken.length < 40 || rawToken.length > 256) return;
    const session = await sessionModel.findOne({ tokenHash: hashOpaqueToken(rawToken) });
    if (session) await revokeFamily(session);
  }

  async function logoutAll(userId) {
    await sessionModel.updateMany(
      { userId, status: { $ne: 'revoked' } },
      { $set: { status: 'revoked', revokedAt: now() } },
    );
  }

  async function getCurrentUser(userId) {
    const user = await userModel.findById(userId);
    if (!user || user.status !== 'active') throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required.');
    return publicUser(user);
  }

  async function updateProfile(userId, body) {
    const validation = validateProfileUpdate(body, imageKitEndpoint);
    if (validation.error) throw new ApiError(400, 'USER_INVALID_PROFILE', validation.error);
    const user = await userModel.findById(userId);
    if (!user || user.status !== 'active') throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required.');
    Object.assign(user, validation.value);
    await user.save();
    return publicUser(user);
  }

  async function changePassword({ userId, familyId, currentPassword, newPassword }) {
    const validation = validatePassword(newPassword);
    if (validation.error) throw new ApiError(400, 'AUTH_INVALID_PASSWORD', validation.error);
    let query = userModel.findById(userId);
    if (typeof query?.select === 'function') query = query.select('+passwordHash');
    const user = await query;
    if (!user || user.status !== 'active' || !await verifyPassword(user.passwordHash, currentPassword)) {
      throw invalidCredentials();
    }
    if (await verifyPassword(user.passwordHash, newPassword)) {
      throw new ApiError(400, 'AUTH_PASSWORD_UNCHANGED', 'Choose a new password that differs from the current password.');
    }
    user.passwordHash = await hashPassword(newPassword);
    await user.save();
    await sessionModel.updateMany(
      { userId, familyId: { $ne: familyId }, status: { $ne: 'revoked' } },
      { $set: { status: 'revoked', revokedAt: now() } },
    );
    return publicUser(user);
  }

  return Object.freeze({
    changePassword,
    getCurrentUser,
    login,
    logout,
    logoutAll,
    publicUser,
    refresh,
    register,
    updateProfile,
  });
}

module.exports = { createAuthService, publicUser };
