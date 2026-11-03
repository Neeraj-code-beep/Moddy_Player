require('dotenv').config();
const mongoose = require('mongoose');
const connectToDB = require('../db/db');
const { getMusicIntelligenceConfig } = require('../config/music-intelligence');
const { createAnalysisWorker } = require('../service/song-analysis-worker.service');

async function start() {
  const config = getMusicIntelligenceConfig();
  if (!config.enabled) throw new Error('GEMINI_API_KEY is required to run the music analysis worker.');
  await connectToDB();
  const worker = createAnalysisWorker({ config });
  const runPromise = worker.run();
  let shutdownPromise;
  const stop = () => {
    if (shutdownPromise) return shutdownPromise;
    worker.stop();
    shutdownPromise = runPromise.then(() => mongoose.disconnect());
    return shutdownPromise;
  };
  process.once('SIGINT', () => { void stop().catch(() => { process.exitCode = 1; }); });
  process.once('SIGTERM', () => { void stop().catch(() => { process.exitCode = 1; }); });
  await runPromise;
  await stop();
}

if (require.main === module) {
  start().catch(async (error) => {
    console.error('[music-ai] Worker could not start', { errorName: error?.name || 'Error', code: error?.code || 'worker_start_failed' });
    await mongoose.disconnect().catch(() => {});
    process.exitCode = 1;
  });
}

module.exports = start;
