const mongoose = require('mongoose');

function getConnectionTimeoutMs(value = process.env.MONGODB_CONNECT_TIMEOUT_MS) {
  if (value === undefined || value === '') return 10_000;
  if (!/^\d+$/.test(String(value))) {
    throw new Error('MONGODB_CONNECT_TIMEOUT_MS must be a positive integer.');
  }
  const timeout = Number(value);
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 120_000) {
    throw new Error('MONGODB_CONNECT_TIMEOUT_MS must be between 1 and 120000.');
  }
  return timeout;
}

async function connectToDB() {
  const mongoUrl = process.env.MONGODB_URL;
  if (!mongoUrl) throw new Error('MONGODB_URL is required.');

  try {
    await mongoose.connect(mongoUrl, {
      serverSelectionTimeoutMS: getConnectionTimeoutMs(),
    });
    console.log('Connected to MongoDB');
  } catch (error) {
    console.error('MongoDB connection failed', { errorName: error?.name || 'Error' });
    throw error;
  }
}

module.exports = connectToDB;
