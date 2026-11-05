const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { runSongAnalysisBackfill, validateBackfillOptions } = require('../src/service/song-analysis-backfill.service');

function createModels(songs, jobs = []) {
  const reads = [];
  const writes = [];
  const songModel = {
    find(filter) {
      reads.push(filter);
      const cursor = filter.$and[1]._id.$gt;
      const rows = songs.filter((song) => {
        const publicCatalog = song.visibility === 'public' && ['admin', 'legacy'].includes(song.uploadSource);
        const legacy = song.visibility === undefined && song.catalogStatus === undefined && song.uploadSource === undefined && song.uploadedBy === undefined && song.ownerId === undefined;
        return (publicCatalog || legacy) && (!cursor || String(song._id) > String(cursor));
      }).sort((left, right) => String(left._id).localeCompare(String(right._id)));
      const query = {
        select: () => query,
        sort: () => query,
        limit: (value) => { query.max = value; return query; },
        lean: async () => rows.slice(0, query.max),
      };
      return query;
    },
    async updateOne(filter, update) {
      writes.push({ filter, update });
      const song = songs.find((item) => String(item._id) === String(filter._id));
      if (song && update.$set.audioMimeType) song.audioMimeType = update.$set.audioMimeType;
      return { matchedCount: song ? 1 : 0, modifiedCount: song ? 1 : 0 };
    },
  };
  const jobModel = {
    find(filter) {
      const ids = new Set(filter.songId.$in.map(String));
      const rows = jobs.filter((job) => ids.has(String(job.songId)));
      const query = { select: () => query, lean: async () => rows };
      return query;
    },
  };
  return { songModel, jobModel, reads, writes };
}

function publicSong(id, values = {}) {
  return {
    _id: new mongoose.Types.ObjectId(id), visibility: 'public', uploadSource: 'admin', catalogStatus: 'approved',
    mediaStatus: 'active', audio: `https://ik.example.test/songs/${id}.wav`, storageFileId: `file-${id}`,
    audioMimeType: 'audio/wav', ...values,
  };
}

test('backfill dry run scans only public catalog and legacy records without writing or queuing', async () => {
  const eligible = publicSong('000000000000000000000001');
  const legacy = publicSong('000000000000000000000002', { uploadSource: 'legacy', catalogStatus: undefined, mediaStatus: undefined, audioMimeType: undefined, audio: 'https://ik.example.test/songs/old.mp3' });
  const privateSong = { ...publicSong('000000000000000000000003'), visibility: 'private', uploadSource: 'user', ownerId: new mongoose.Types.ObjectId() };
  const pending = publicSong('000000000000000000000004', { catalogStatus: 'pending' });
  const completed = publicSong('000000000000000000000005', { analysis: { status: 'completed' } });
  const models = createModels([eligible, legacy, privateSong, pending, completed], [{ songId: completed._id, status: 'completed' }]);
  let enqueues = 0;

  const result = await runSongAnalysisBackfill({ ...models, requestedBy: new mongoose.Types.ObjectId(), enqueueAnalysis: async () => { enqueues += 1; } });

  assert.equal(result.dryRun, true);
  assert.deepEqual(result.counts, { scanned: 4, eligible: 2, wouldQueue: 2, skipped: 2, queued: 0, failed: 0 });
  assert.equal(result.skipReasons.catalog_not_approved, 1);
  assert.equal(result.skipReasons.already_analyzed, 1);
  assert.equal(enqueues, 0);
  assert.equal(models.writes.length, 0);
  assert.ok(models.reads[0].$and[0].$or.some((scope) => scope.visibility === 'public' && scope.uploadSource.$in.includes('admin')));
  assert.ok(models.reads[0].$and[0].$or.some((scope) => scope.ownerId?.$exists === false && scope.uploadedBy?.$exists === false));
  assert.equal(models.reads[0].$and[0].$or.some((scope) => scope.visibility === 'private'), false);
});

test('backfill queues eligible records sequentially, persists inferred MIME, and reports enqueue failures', async () => {
  const first = publicSong('000000000000000000000011');
  const inferred = publicSong('000000000000000000000012', { uploadSource: 'legacy', catalogStatus: undefined, audioMimeType: undefined, audio: 'https://ik.example.test/songs/old.mp3' });
  const failedJob = publicSong('000000000000000000000013');
  const models = createModels([first, inferred, failedJob], [{ songId: failedJob._id, status: 'failed' }]);
  const enqueued = [];

  const result = await runSongAnalysisBackfill({
    ...models,
    dryRun: false,
    requestedBy: new mongoose.Types.ObjectId(),
    enqueueAnalysis: async (song, options) => {
      enqueued.push({ song, options });
      if (String(song._id) === String(first._id)) return { queued: true };
      throw Object.assign(new Error('secret details must not be returned'), { code: 'database_unavailable' });
    },
  });

  assert.equal(result.counts.eligible, 2);
  assert.equal(result.counts.queued, 1);
  assert.equal(result.counts.failed, 1);
  assert.equal(result.counts.skipped, 1);
  assert.equal(result.skipReasons.failed_job_requires_retry, 1);
  assert.equal(inferred.audioMimeType, 'audio/mpeg');
  assert.equal(models.writes.length, 1);
  assert.ok(models.writes[0].filter.$and[0].$or.some((condition) => condition.mediaStatus?.$exists === false));
  assert.equal(enqueued.every(({ options }) => options.requestSource === 'admin_backfill'), true);
  assert.equal(enqueued.every(({ options }) => options.reprocess === false), true);
});

test('backfill pagination is bounded, uses an exclusive cursor, and supports completed-song reprocessing only when explicit', async () => {
  const first = publicSong('000000000000000000000021', { analysis: { status: 'completed' } });
  const second = publicSong('000000000000000000000022');
  const third = publicSong('000000000000000000000023');
  const models = createModels([first, second, third], [{ songId: first._id, status: 'completed' }]);
  const dryRun = await runSongAnalysisBackfill({ ...models, limit: 2 });
  assert.equal(dryRun.counts.scanned, 2);
  assert.equal(dryRun.counts.eligible, 1);
  assert.equal(dryRun.skipReasons.already_analyzed, 1);
  assert.equal(dryRun.hasMore, true);
  assert.equal(dryRun.nextAfterId, String(second._id));

  const reprocess = await runSongAnalysisBackfill({
    ...models,
    limit: 1,
    dryRun: false,
    reprocess: true,
    enqueueAnalysis: async (_song, options) => { assert.equal(options.reprocess, true); return { queued: true }; },
  });
  assert.equal(reprocess.counts.scanned, 1);
  assert.equal(reprocess.counts.queued, 1);
  assert.equal(reprocess.nextAfterId, String(first._id));
  assert.equal(reprocess.hasMore, true);
  assert.throws(() => validateBackfillOptions({ limit: 101 }), /from 1 to 100/);
  assert.throws(() => validateBackfillOptions({ afterId: 'second_db' }), /ObjectId/);
});
