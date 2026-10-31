const argon2 = require('argon2');
const crypto = require('node:crypto');

const ARGON2_OPTIONS = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  hashLength: 32,
});

let dummyHashPromise;

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    return { error: 'Password must be between 12 and 128 characters.' };
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return { error: 'Password must include a lowercase letter, uppercase letter, number, and symbol.' };
  }
  return { value: password };
}

function hashPassword(password) {
  const validation = validatePassword(password);
  if (validation.error) throw new TypeError(validation.error);
  return argon2.hash(password, ARGON2_OPTIONS);
}

async function verifyPassword(passwordHash, password) {
  if (typeof passwordHash !== 'string' || typeof password !== 'string') return false;
  try {
    return await argon2.verify(passwordHash, password, { type: argon2.argon2id });
  } catch {
    return false;
  }
}

function getDummyPasswordHash() {
  if (!dummyHashPromise) {
    const randomUnavailablePassword = crypto.randomBytes(32).toString('base64url');
    dummyHashPromise = argon2.hash(randomUnavailablePassword, ARGON2_OPTIONS);
  }
  return dummyHashPromise;
}

module.exports = { ARGON2_OPTIONS, getDummyPasswordHash, hashPassword, validatePassword, verifyPassword };
