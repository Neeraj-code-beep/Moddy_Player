const test = require('node:test');
const assert = require('node:assert/strict');
const { claimNextJob, createAnalysisWorker, processClaimedJob } = require('../src/service/song-analysis-worker.service');
const { enqueueSongAnalysis, retrySongAnalysis } = require('../src/service/song-analysis-queue.service');

const config = { enabled: true, provider: 'gemini', model: 'gemini-test', maxAttempts: 3, leaseMs: 120_000, retryBaseMs: 1_000, timeoutMs: 1_000, concurrency: 2 };

function claimHarness(initial) {
  const state = { job: { ...initial } };
  const songWrites = [];
  const jobModel = {
    find: () => ({ select: () => ({ lean: async () => [] }) }),
    updateMany: async () => ({ modifiedCount: 0 }),
    findOneAndUpdate: async (filter, update) => {
      const job = state.job;
      const currentTime = new Date();
      const queued = job.status === 'queued' && job.availableAt <= currentTime;
      const abandoned = job.status === 'processing' && job.leaseUntil <= currentTime;
      if ((!queued && !abandoned) || job.attempts >= filter.attempts.$lt) return null;
      state.job = { ...job, ...update.$set, attempts: job.attempts + update.$inc.attempts };
      return { ...state.job };
    },
  };
  const songModel = { updateOne: async (...args) => { songWrites.push(args); return { matchedCount: 1 }; } };
  return { state, songWrites, jobModel, songModel };
}

function songHarness(song) {
  const state = { song: { ...song } };
  const writes = [];
  const model = {
    findById: () => ({ select: () => ({ lean: async () => ({ ...state.song }) }) }),
    updateOne: async (filter, update) => {
      writes.push({ filter, update });
      if (filter.metadataRevision !== undefined && filter.metadataRevision !== state.song.metadataRevision) return { matchedCount: 0, modifiedCount: 0 };
      return { matchedCount: 1, modifiedCount: 1 };
    },
  };
  return { state, writes, model };
}

test('atomic job claim permits only one worker and recovers an expired lease', async () => {
  const harness = claimHarness({ _id: 'job-1', songId: 'song-1', status: 'queued', attempts: 0, maxAttempts: 3, availableAt: new Date(0), leaseUntil: null });
  const [first, second] = await Promise.all([
    claimNextJob({ jobModel: harness.jobModel, songModel: harness.songModel, config, workerId: 'worker-a' }),
    claimNextJob({ jobModel: harness.jobModel, songModel: harness.songModel, config, workerId: 'worker-b' }),
  ]);
  assert.equal([first, second].filter(Boolean).length, 1);
  assert.equal(harness.state.job.attempts, 1);

  const expired = claimHarness({ _id: 'job-2', songId: 'song-2', status: 'processing', attempts: 1, maxAttempts: 3, availableAt: new Date(0), leaseUntil: new Date(0) });
  const recovered = await claimNextJob({ jobModel: expired.jobModel, songModel: expired.songModel, config, workerId: 'worker-c' });
  assert.equal(recovered.status, 'processing');
  assert.equal(recovered.attempts, 2);
  assert.equal(recovered.workerId, 'worker-c');
});

test('worker shutdown waits for an in-flight job before the caller disconnects MongoDB', async () => {
  let releaseJob;
  let jobStarted;
  const started = new Promise((resolve) => { jobStarted = resolve; });
  const jobModel = {
    find: () => ({ select: () => ({ lean: async () => [] }) }),
    updateMany: async () => ({ modifiedCount: 0 }),
    findOneAndUpdate: (() => {
      let claimed = false;
      return async () => {
        if (claimed) return null;
        claimed = true;
        return { _id: 'job-in-flight', songId: 'song-in-flight', status: 'processing', workerId: 'worker', attempts: 1, maxAttempts: 3 };
      };
    })(),
  };
  const worker = createAnalysisWorker({
    config: { ...config, concurrency: 1 },
    jobModel,
    songModel: {},
    processJob: async () => {
      jobStarted();
      await new Promise((resolve) => { releaseJob = resolve; });
    },
    sleep: async () => {},
  });
  const runPromise = worker.run();
  await started;
  let stopped = false;
  runPromise.then(() => { stopped = true; });
  worker.stop();
  await Promise.resolve();
  assert.equal(stopped, false);
  releaseJob();
  await runPromise;
  assert.equal(stopped, true);
});

test('upload enqueue is idempotent per song and leaves a disabled provider unqueued', async () => {
  let created = 0;
  const job = { _id: 'job-3', status: 'queued', createdAt: new Date() };
  let storedJob = null;
  const jobModel = {
    findOneAndUpdate: async (_filter, update) => { if (update.$setOnInsert && !storedJob) { created += 1; storedJob = job; } return storedJob; },
  };
  const writes = [];
  const songModel = { updateOne: async (...args) => { writes.push(args); return { matchedCount: 1 }; } };
  const song = { _id: 'song-3', metadataRevision: 0, uploadedBy: 'user-3' };
  const first = await enqueueSongAnalysis(song, { songModel, jobModel, config });
  const duplicate = await enqueueSongAnalysis(song, { songModel, jobModel, config });
  const disabled = await enqueueSongAnalysis(song, { songModel, jobModel, config: { ...config, enabled: false } });
  assert.equal(first.queued, true);
  assert.equal(duplicate.queued, true);
  assert.equal(created, 1, 'duplicate enqueue returns the unique existing song job');
  assert.equal(writes.length, 2);
  assert.deepEqual(disabled, { queued: false, reason: 'not_configured' });
});

test('explicit admin backfill reprocess resets an existing completed job without creating another', async () => {
  const job = { _id: 'job-reprocess', songId: 'song-reprocess', status: 'completed', attempts: 1, maxAttempts: 3 };
  const jobModel = {
    findOneAndUpdate: async (filter, update) => {
      if (update.$setOnInsert) return job;
      if (filter.status === 'completed' && job.status === 'completed') {
        Object.assign(job, update.$set);
        return job;
      }
      return null;
    },
    findOne: async () => job,
  };
  const songWrites = [];
  const songModel = { updateOne: async (...args) => { songWrites.push(args); return { matchedCount: 1 }; } };
  const result = await enqueueSongAnalysis({ _id: job.songId, metadataRevision: 4 }, {
    songModel, jobModel, config, requestedBy: 'admin', requestSource: 'admin_backfill', reprocess: true,
  });
  assert.equal(result.queued, true);
  assert.equal(result.job._id, job._id);
  assert.equal(job.status, 'queued');
  assert.equal(job.attempts, 0);
  assert.equal(job.metadataRevision, 4);
  assert.equal(songWrites[0][1].$set['analysis.status'], 'queued');
});

test('worker applies suggestions without mutating uploaded metadata and tags each field for review', async () => {
  const song = { _id: 'song-4', audio: 'https://cdn.example/song', audioMimeType: 'audio/mpeg', storageFileId: 'provider-id', mediaStatus: 'active', metadataRevision: 2, mood: 'happy', analysis: { status: 'queued', jobId: 'job-4' } };
  const songHarnessData = songHarness(song);
  const jobWrites = [];
  const jobModel = { updateOne: async (...args) => { jobWrites.push(args); return { modifiedCount: 1 }; } };
  const result = await processClaimedJob({ _id: 'job-4', songId: song._id, status: 'processing', workerId: 'worker', attempts: 1, maxAttempts: 3, metadataRevision: 2 }, {
    songModel: songHarnessData.model, jobModel, config,
    retrieveAudio: async () => ({ audio: Buffer.from('audio'), mimeType: 'audio/mpeg' }),
    analyzeAudio: async () => ({ mood: 'romantic', genre: 'jazz', energy: 'low', vocalCharacteristics: 'instrumental', tags: [], secondaryMoods: [], subgenres: [], listeningContexts: [], instrumentation: [] }),
    now: () => new Date('2026-11-03T00:00:00.000Z'),
  });
  assert.equal(result.status, 'completed');
  assert.equal(songHarnessData.writes[1].filter.metadataRevision, 2);
  assert.ok(songHarnessData.writes[1].update.$set.aiSuggestions.review.mood);
  assert.equal(songHarnessData.writes[1].update.$set.mood, undefined, 'AI never replaces verified song metadata');
  assert.equal(jobWrites[0][1].$set.status, 'completed');
});

test('worker does not overwrite a newer metadata edit and marks the stale result retryable by an owner', async () => {
  const song = { _id: 'song-5', audio: 'https://cdn.example/song', audioMimeType: 'audio/mpeg', storageFileId: 'provider-id', mediaStatus: 'active', metadataRevision: 4, analysis: { status: 'queued', jobId: 'job-5' } };
  const songHarnessData = songHarness(song);
  const jobWrites = [];
  const jobModel = { updateOne: async (...args) => { jobWrites.push(args); return { modifiedCount: 1 }; } };
  let analysisCalls = 0;
  const result = await processClaimedJob({ _id: 'job-5', songId: song._id, status: 'processing', workerId: 'worker', attempts: 1, maxAttempts: 3, metadataRevision: 3 }, {
    songModel: songHarnessData.model, jobModel, config,
    analyzeAudio: async () => { analysisCalls += 1; return {}; },
    now: () => new Date(),
  });
  assert.equal(analysisCalls, 0);
  assert.equal(result.status, 'failed');
  assert.equal(jobWrites[0][1].$set.lastErrorCode, 'metadata_changed');
});

test('reprocessing preserves manually overridden and accepted suggestion fields', async () => {
  const song = {
    _id: 'song-preserve', audio: 'https://cdn.example/song', audioMimeType: 'audio/mpeg', storageFileId: 'provider-id',
    mediaStatus: 'active', metadataRevision: 5, mood: 'calm', analysis: { status: 'queued', jobId: 'job-preserve' },
    aiSuggestions: { status: 'failed', mood: 'user_mood', genre: 'previous_genre', review: {
      mood: { source: 'user', status: 'overridden' }, genre: { source: 'ai', status: 'accepted' },
    } },
  };
  const songData = songHarness(song);
  await processClaimedJob({ _id: 'job-preserve', songId: song._id, status: 'processing', workerId: 'worker', attempts: 2, maxAttempts: 3, metadataRevision: 5 }, {
    songModel: songData.model,
    jobModel: { updateOne: async () => ({ modifiedCount: 1 }) },
    config,
    retrieveAudio: async () => ({ audio: Buffer.from('audio'), mimeType: 'audio/mpeg' }),
    analyzeAudio: async () => ({ mood: 'romantic', genre: 'rock', energy: 'high', vocalCharacteristics: 'lead_vocals', tags: [], secondaryMoods: [], subgenres: [], listeningContexts: [], instrumentation: [] }),
  });
  const saved = songData.writes.at(-1).update.$set.aiSuggestions;
  assert.equal(saved.mood, 'user_mood');
  assert.equal(saved.genre, 'previous_genre');
  assert.equal(saved.review.mood.status, 'overridden');
  assert.equal(saved.review.genre.status, 'accepted');
});

test('retry rejects nonfailed jobs and resets only failed jobs under the current metadata revision', async () => {
  const song = { _id: 'song-6', metadataRevision: 5 };
  let filterSeen;
  let updateSeen;
  const jobModel = { findOneAndUpdate: async (filter, update) => { filterSeen = filter; updateSeen = update; return { _id: 'job-6', status: 'queued', availableAt: new Date() }; } };
  const songModel = { updateOne: async () => ({ matchedCount: 1 }) };
  const retried = await retrySongAnalysis(song, { songModel, jobModel, config, requestedBy: 'admin', requestSource: 'admin_retry' });
  assert.equal(retried.status, 'queued');
  assert.equal(filterSeen.status, 'failed');
  assert.equal(updateSeen.$set.metadataRevision, 5);
  assert.equal(updateSeen.$set.attempts, 0);
  await assert.rejects(retrySongAnalysis(song, { songModel, jobModel: { findOneAndUpdate: async () => null }, config }), (error) => error.code === 'ANALYSIS_NOT_RETRYABLE');
});

test('retry can recover a saved upload when initial queue persistence failed before a job existed', async () => {
  const song = { _id: 'song-queue-recovery', metadataRevision: 2, analysis: { status: 'failed', errorCode: 'queue_unavailable' } };
  let calls = 0;
  const createdJob = { _id: 'job-queue-recovery', status: 'queued', createdAt: new Date() };
  const jobModel = {
    findOneAndUpdate: async (_filter, update, options) => {
      calls += 1;
      if (options?.upsert && update.$setOnInsert) return createdJob;
      return null;
    },
  };
  const writes = [];
  const songModel = { updateOne: async (...args) => { writes.push(args); return { matchedCount: 1 }; } };

  const retried = await retrySongAnalysis(song, { songModel, jobModel, config, requestedBy: 'owner' });

  assert.equal(retried._id, createdJob._id);
  assert.equal(calls, 2, 'first check found no failed job, then idempotently created the missing job');
  assert.equal(writes.length, 1);
  assert.equal(writes[0][1].$set['analysis.status'], 'queued');
});
