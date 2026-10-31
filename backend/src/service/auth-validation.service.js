const { validatePassword } = require('./password.service');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function hasOnlyKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every((key) => keys.includes(key));
}

function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) return null;
  return email;
}

function validateRegistration(body) {
  if (!hasOnlyKeys(body, ['name', 'email', 'password'])) {
    return { error: 'Registration must contain only name, email, and password.' };
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = normalizeEmail(body.email);
  const password = validatePassword(body.password);
  if (!name || name.length > 80 || CONTROL_CHARACTERS.test(name)) {
    return { error: 'Name must contain 1 to 80 valid characters.' };
  }
  if (!email) return { error: 'Enter a valid email address.' };
  if (password.error) return { error: password.error };
  return { value: { name, email, password: password.value } };
}

function validateLogin(body) {
  if (!hasOnlyKeys(body, ['email', 'password'])) return { error: 'Login must contain only email and password.' };
  const email = normalizeEmail(body.email);
  if (!email || typeof body.password !== 'string' || body.password.length < 1 || body.password.length > 128) {
    return { error: 'Email and password are required.' };
  }
  return { value: { email, password: body.password } };
}

function validateProfileUpdate(body, imageKitEndpoint) {
  if (!hasOnlyKeys(body, ['name', 'bio', 'avatarUrl']) || Object.keys(body).length === 0) {
    return { error: 'Profile updates may contain only name, bio, and avatarUrl.' };
  }
  const update = {};
  if (Object.hasOwn(body, 'name')) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 80 || CONTROL_CHARACTERS.test(name)) {
      return { error: 'Name must contain 1 to 80 valid characters.' };
    }
    update.name = name;
  }
  if (Object.hasOwn(body, 'bio')) {
    if (typeof body.bio !== 'string' || body.bio.length > 500 || CONTROL_CHARACTERS.test(body.bio)) {
      return { error: 'Bio must be a string of at most 500 valid characters.' };
    }
    update.bio = body.bio.trim();
  }
  if (Object.hasOwn(body, 'avatarUrl')) {
    if (body.avatarUrl === null || body.avatarUrl === '') {
      update.avatarUrl = null;
    } else {
      if (typeof body.avatarUrl !== 'string' || body.avatarUrl.length > 2048 || !imageKitEndpoint) {
        return { error: 'Avatar images must use the configured image storage service.' };
      }
      let endpoint;
      let avatar;
      try {
        endpoint = new URL(imageKitEndpoint);
        avatar = new URL(body.avatarUrl);
      } catch {
        return { error: 'Avatar URL is invalid.' };
      }
      const basePath = endpoint.pathname.endsWith('/') ? endpoint.pathname : `${endpoint.pathname}/`;
      if (avatar.protocol !== 'https:' || avatar.hostname !== endpoint.hostname ||
          avatar.username || avatar.password || avatar.hash ||
          !(avatar.pathname === endpoint.pathname || avatar.pathname.startsWith(basePath))) {
        return { error: 'Avatar images must use the configured image storage service.' };
      }
      update.avatarUrl = avatar.toString();
    }
  }
  return { value: update };
}

module.exports = { normalizeEmail, validateLogin, validateProfileUpdate, validateRegistration };
