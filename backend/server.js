require('dotenv').config();
const app = require('./src/app');
const connectToDB = require('./src/db/db');
const { getAuthConfig } = require('./src/config/auth');
const configuredPort = process.env.PORT || '3000';

if (!/^\d+$/.test(configuredPort) || Number(configuredPort) < 1 || Number(configuredPort) > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

async function startServer({ app: serverApp = app } = {}) {
  getAuthConfig();
  await connectToDB();

  return new Promise((resolve, reject) => {
    const server = serverApp.listen(Number(configuredPort), () => {
      console.log(`Server is running on port ${configuredPort}`);
      resolve(server);
    });
    server.once('error', reject);
  });
}

if (require.main === module) {
  startServer().catch(async () => {
    console.error('Backend startup failed because MongoDB is unavailable or the HTTP server could not start.');
    const mongoose = require('mongoose');
    await mongoose.disconnect().catch(() => {});
    process.exitCode = 1;
  });
}

module.exports = startServer;
