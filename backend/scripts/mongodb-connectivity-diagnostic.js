const mongoose = require('mongoose');
const { makeIsolatedMongoUrl, sanitizeMongoError } = require('../test/mongodb-test-safety');

async function runConnectivityDiagnostic() {
  // Deliberately read only the dedicated integration variable. Do not load dotenv
  // or fall back to the application's MONGODB_URL.
  const integrationUrl = process.env.MONGODB_INTEGRATION_URL;
  if (!integrationUrl) {
    console.error('MONGODB_INTEGRATION_URL is not set for this process.');
    process.exitCode = 1;
    return;
  }

  let connection;
  try {
    const safeUri = makeIsolatedMongoUrl(integrationUrl);
    connection = mongoose.createConnection(safeUri, { serverSelectionTimeoutMS: 5_000 });
    await connection.asPromise();

    if (connection.db?.databaseName !== 'moddy_player_integration_test') {
      throw new Error('Connected database failed the dedicated integration database check.');
    }
    await connection.db.command({ ping: 1 });
    console.log('MongoDB connectivity diagnostic passed (ping succeeded).');
  } catch (error) {
    console.error('MongoDB connectivity diagnostic failed:', sanitizeMongoError(error));
    process.exitCode = 1;
  } finally {
    if (connection && connection.readyState !== 0) {
      try {
        await connection.close();
      } catch (error) {
        console.error('MongoDB diagnostic disconnect failed:', sanitizeMongoError(error));
        process.exitCode = 1;
      }
    }
  }
}

runConnectivityDiagnostic();
