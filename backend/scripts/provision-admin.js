require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/user.model');
const AuthSession = require('../src/models/auth-session.model');
const { hashPassword, validatePassword } = require('../src/service/password.service');

async function main(env = process.env) {
  const email = typeof env.ADMIN_EMAIL === 'string' ? env.ADMIN_EMAIL.trim().toLowerCase() : '';
  const password = env.ADMIN_PASSWORD;
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Set a valid ADMIN_EMAIL for the initial administrator.');
  }
  if (typeof password !== 'string' || validatePassword(password).error) {
    throw new Error('Set an ADMIN_PASSWORD that meets the application password requirements.');
  }
  if (!env.MONGODB_URL) throw new Error('MONGODB_URL is required to provision an administrator.');
  await mongoose.connect(env.MONGODB_URL);
  try {
    await Promise.all([User.createIndexes(), AuthSession.createIndexes()]);
    const existing = await User.findOne({ email }).select('+passwordHash');
    if (existing) {
      existing.role = 'admin';
      existing.status = 'active';
      existing.passwordHash = await hashPassword(password);
      await existing.save();
      await AuthSession.updateMany({ userId: existing._id, status: { $ne: 'revoked' } }, { $set: { status: 'revoked', revokedAt: new Date() } });
    } else {
      await User.create({ name: env.ADMIN_NAME || 'Moddy Administrator', email, passwordHash: await hashPassword(password), role: 'admin' });
    }
    console.log('Administrator account provisioned.');
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(async () => {
    console.error('Administrator provisioning failed. Check the configured database and administrator settings.');
    await mongoose.disconnect().catch(() => {});
    process.exitCode = 1;
  });
}

module.exports = main;
