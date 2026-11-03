const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const mongoose = require('mongoose');
const createApp = require('../src/app').createApp;
const { createAccessToken } = require('../src/service/token.service');

const config = { accessTokenSecret: 'test-secret-that-is-at-least-32-bytes-long', accessTokenTtlSeconds: 600, cookie: { refreshName: 'moddy_refresh', csrfName: 'moddy_csrf', path: '/auth', csrfPath: '/', sameSite: 'lax', secure: false }, refreshTtlDays: 30 };
const userIds = ['507f1f77bcf86cd799439011', '507f1f77bcf86cd799439012', '507f1f77bcf86cd799439013'];
const users = userIds.map((id, index) => ({ _id: id, id, name: `Listener ${index}`, email: `listener${index}@example.test`, role: index === 2 ? 'admin' : 'user', status: 'active' }));
const tokens = userIds.map((userId, index) => createAccessToken({ userId, familyId: 'b6c0f7cc-8c9d-4b1e-a9f2-30a6a6466ce6', role: index === 2 ? 'admin' : 'user' }, config));
const audio = Buffer.from('RIFF0000WAVE');
const highRateLimit = { windowMs: 60_000, upload: 100, feedback: 100, recommendation: 100, catalog: 100, trustedProxyHops: 0 };

function createModels() {
  const songs = [];
  const favorites = [];
  const playlists = [];
  const analysisJobs = [];
  let nextSong = 1;
  let nextPlaylist = 1;
  const songModel = {
    records: songs,
    async create(data) {
      const record = {
        _id: new mongoose.Types.ObjectId(),
        ...data,
        mediaStatus: 'active',
        metadataRevision: 0,
        analysis: { status: 'not_configured' },
        async save() {},
        async deleteOne() { const index = songs.indexOf(record); if (index >= 0) songs.splice(index, 1); },
      };
      songs.push(record);
      nextSong += 1;
      return record;
    },
    findOne(filter) {
      const record = songs.find((song) => {
        if (filter.uploadFingerprint) return song.uploadFingerprint === filter.uploadFingerprint && song.uploadSource === filter.uploadSource && String(song.uploadedBy) === String(filter.uploadedBy);
        if (Array.isArray(filter.uploadSource?.$in)) return String(song._id) === String(filter._id) && song.visibility === filter.visibility && filter.uploadSource.$in.includes(song.uploadSource);
        if (Array.isArray(filter._id?.$in)) return filter._id.$in.some((id) => String(id) === String(song._id)) && filter.$or?.some((condition) =>
          condition.visibility === 'private' && condition.uploadSource === 'user' && condition.$or?.some((owner) => String(song.uploadedBy) === String(owner.uploadedBy || '') || String(song.ownerId) === String(owner.ownerId || '')));
        return String(song._id) === String(filter._id) && song.visibility === filter.visibility && (Array.isArray(filter.uploadSource?.$in) ? filter.uploadSource.$in.includes(song.uploadSource) : song.uploadSource === filter.uploadSource) &&
          (Array.isArray(filter.mediaStatus?.$in) ? filter.mediaStatus.$in.includes(song.mediaStatus) : song.mediaStatus === filter.mediaStatus) &&
          filter.$or?.some((owner) => String(song.uploadedBy) === String(owner.uploadedBy || '') || String(song.ownerId) === String(owner.ownerId || ''));
      });
      return { select: async () => record || null };
    },
    find(filter) {
      const criteria = filter.$and?.[0];
      const ids = new Set((filter._id?.$in || []).map(String));
      const rows = songs.filter((song) => criteria
        ? song.visibility === criteria.visibility && song.uploadSource === criteria.uploadSource && criteria.mediaStatus?.$in?.includes(song.mediaStatus) && criteria.$or?.some((owner) => String(song.uploadedBy) === String(owner.uploadedBy || '') || String(song.ownerId) === String(owner.ownerId || ''))
        : ids.has(String(song._id)) && filter.$or?.some((condition) => condition.visibility === 'private' && condition.uploadSource === 'user' && condition.$or?.some((owner) => String(song.uploadedBy) === String(owner.uploadedBy || '') || String(song.ownerId) === String(owner.ownerId || ''))));
      const query = { select: () => query, sort: () => query, skip: () => query, limit: () => query, lean: async () => rows };
      return query;
    },
    findById(id) { const row = songs.find((song) => String(song._id) === String(id)); return { select: async () => row || null, lean: async () => row || null }; },
    async updateOne(filter, update) {
      const row = songs.find((song) => String(song._id) === String(filter._id));
      if (row) for (const [key, value] of Object.entries(update.$set || {})) {
        const [parent, child] = key.split('.');
        if (child) row[parent] = { ...(row[parent] || {}), [child]: value };
        else row[key] = value;
      }
      return { matchedCount: row ? 1 : 0, modifiedCount: row ? 1 : 0 };
    },
    async countDocuments(filter) {
      const criteria = filter.$and?.[0];
      if (criteria) return songs.filter((song) => song.visibility === criteria.visibility && song.uploadSource === criteria.uploadSource && criteria.mediaStatus?.$in?.includes(song.mediaStatus) && criteria.$or?.some((owner) => String(song.uploadedBy) === String(owner.uploadedBy || '') || String(song.ownerId) === String(owner.ownerId || ''))).length;
      const ids = new Set((filter._id?.$in || []).map(String));
      const owners = filter.$or?.[1]?.$or || [];
      return songs.filter((song) => ids.has(String(song._id)) && song.visibility === 'private' && song.uploadSource === 'user' && owners.some((owner) => String(song.uploadedBy) === String(owner.uploadedBy || '') || String(song.ownerId) === String(owner.ownerId || ''))).length;
    },
  };
  const favoriteModel = {
    records: favorites,
    async updateOne(filter, update) {
      if (!favorites.some((item) => String(item.userId) === String(filter.userId) && String(item.songId) === String(filter.songId))) favorites.push({ userId: filter.userId, songId: filter.songId });
      return update;
    },
    find(filter) { const rows = favorites.filter((item) => String(item.userId) === String(filter.userId)); return { sort: () => ({ lean: async () => rows }) }; },
    async deleteOne(filter) { const beforeCount = favorites.length; for (let i = favorites.length - 1; i >= 0; i -= 1) if (String(favorites[i].userId) === String(filter.userId) && String(favorites[i].songId) === String(filter.songId)) favorites.splice(i, 1); return { deletedCount: beforeCount - favorites.length }; },
    async deleteMany(filter) { for (let i = favorites.length - 1; i >= 0; i -= 1) if (String(favorites[i].songId) === String(filter.songId)) favorites.splice(i, 1); },
  };
  const playlistModel = {
    records: playlists,
    async create(data) { const record = { _id: new mongoose.Types.ObjectId(), revision: 0, ...data }; playlists.push(record); nextPlaylist += 1; return record; },
    find(filter) { const rows = playlists.filter((item) => String(item.userId) === String(filter.userId)); return { sort: () => ({ lean: async () => rows }) }; },
    findOne(filter) { const row = playlists.find((item) => String(item._id) === String(filter._id) && String(item.userId) === String(filter.userId)); return { lean: async () => row || null }; },
    async findOneAndUpdate(filter, update) {
      const row = playlists.find((item) => String(item._id) === String(filter._id) && String(item.userId) === String(filter.userId) && item.revision === filter.revision);
      if (!row) return null;
      Object.assign(row, update.$set); row.revision += update.$inc.revision; return row;
    },
    async deleteOne(filter) { const index = playlists.findIndex((item) => String(item._id) === String(filter._id) && String(item.userId) === String(filter.userId)); if (index >= 0) playlists.splice(index, 1); },
    async updateMany(filter, update) {
      const songId = filter.songIds || update.$pull?.songIds;
      for (const row of playlists) {
        if ((!filter.userId || String(row.userId) === String(filter.userId)) && row.songIds?.some((id) => String(id) === String(songId))) {
          row.songIds = row.songIds.filter((id) => String(id) !== String(songId));
          row.revision += update.$inc.revision;
        }
      }
    },
  };
  const analysisJobModel = {
    records: analysisJobs,
    async findOneAndUpdate(filter, update) {
      let row = analysisJobs.find((job) => String(job.songId) === String(filter.songId) && (!filter.status || job.status === filter.status));
      if (!row && update.$setOnInsert) { row = { _id: new mongoose.Types.ObjectId(), ...update.$setOnInsert }; analysisJobs.push(row); }
      if (row && update.$set) Object.assign(row, update.$set);
      return row || null;
    },
    findById(id) { return { lean: async () => analysisJobs.find((job) => String(job._id) === String(id)) || null }; },
    find(filter = {}) {
      const rows = analysisJobs.filter((job) => !filter.status || job.status === filter.status);
      const query = { sort: () => query, skip: (n) => { query.offset = n; return query; }, limit: (n) => { query.max = n; return query; }, lean: async () => rows.slice(query.offset || 0, (query.offset || 0) + (query.max || rows.length)) };
      return query;
    },
    async countDocuments(filter = {}) { return analysisJobs.filter((job) => !filter.status || job.status === filter.status).length; },
  };
  return { songModel, favoriteModel, playlistModel, analysisJobModel };
}

function multipart(fields = { title: 'Private track', artist: 'Listener', mood: 'calm' }) {
  const boundary = '----moddy-music-management-test';
  const parts = Object.entries(fields).map(([key, value]) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="track.wav"\r\nContent-Type: audio/wav\r\n\r\n`), audio, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { boundary, body: Buffer.concat(parts) };
}

let server;
let baseUrl;
let models;
let providerDeleteFails = false;
let privateUploadOptions;
let providerUploads = 0;
const providerDeletes = [];
const originalGeminiApiKey = process.env.GEMINI_API_KEY;

before(async () => {
  delete process.env.GEMINI_API_KEY;
  models = createModels();
  const app = createApp({
    ...models,
    userModel: { async findById(id) { return users.find((user) => user.id === String(id)) || null; } },
    authConfig: config,
    isDatabaseReady: () => true,
    rateLimitConfig: highRateLimit,
    uploadFile: async (_file, _name, options) => { providerUploads += 1; privateUploadOptions = options; return { fileId: `private-provider-id-${providerUploads}`, url: 'https://media.example.test/private-song' }; },
    deleteFile: async (id) => { providerDeletes.push(id); if (providerDeleteFails) { providerDeleteFails = false; throw new Error('temporary provider failure'); } },
    getDeliveryUrl: async (url) => `${url}?sig=short-lived`,
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (originalGeminiApiKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalGeminiApiKey;
});

async function upload(userIndex = 0, fields) {
  const form = multipart(fields);
  const response = await fetch(`${baseUrl}/library/songs`, {
    method: 'POST', headers: { authorization: `Bearer ${tokens[userIndex]}`, 'content-type': `multipart/form-data; boundary=${form.boundary}` }, body: form.body,
  });
  return { response, body: await response.json() };
}

test('user upload is private, signed on response, and identity comes from authentication', async () => {
  const { response, body } = await upload(0, { title: 'Private track', artist: 'Listener', mood: 'calm', uploadedBy: userIds[1] });
  assert.equal(response.status, 400, 'clients cannot provide owner metadata');
  const uploaded = await upload(0);
  assert.equal(uploaded.response.status, 201);
  const stored = models.songModel.records.at(-1);
  assert.equal(stored.visibility, 'private');
  assert.equal(stored.uploadSource, 'user');
  assert.equal(String(stored.uploadedBy), userIds[0]);
  assert.equal(privateUploadOptions.isPrivateFile, true);
  assert.equal(uploaded.body.song.storageFileId, undefined);
  assert.equal(uploaded.body.song.uploadedBy, undefined);
  assert.match(uploaded.body.song.audio, /sig=short-lived/);
  const retry = await upload(0);
  assert.equal(retry.response.status, 200);
  assert.equal(String(retry.body.song._id), String(uploaded.body.song._id));
  assert.equal(providerUploads, 1, 'repeat uploads do not invoke the media provider again');
});

test('a different account cannot read or edit another user’s private upload', async () => {
  const song = models.songModel.records[0];
  const response = await fetch(`${baseUrl}/library/songs/${song._id}`, {
    method: 'PATCH', headers: { authorization: `Bearer ${tokens[1]}`, 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Stolen' }),
  });
  assert.equal(response.status, 404);
  assert.equal(song.title, 'Private track');
});

test('owners can update their metadata and suggestions while review endpoints remain admin-only', async () => {
  const song = models.songModel.records[0];
  const edited = await fetch(`${baseUrl}/library/songs/${song._id}`, {
    method: 'PATCH', headers: { authorization: `Bearer ${tokens[0]}`, 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Evening edit', mood: 'joyful', aiSuggestions: { mood: 'peaceful', tags: ['ambient'] } }),
  });
  assert.equal(edited.status, 200);
  assert.equal(song.title, 'Evening edit');
  assert.equal(song.mood, 'joyful');
  assert.equal(song.aiSuggestions.mood, 'peaceful');
  assert.equal(song.metadataProvenance.mood, 'user');
  const denied = await fetch(`${baseUrl}/library/admin/songs/${song._id}`, {
    method: 'PATCH', headers: { authorization: `Bearer ${tokens[0]}`, 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'approved' }),
  });
  assert.equal(denied.status, 403);
});

test('analysis details are private to the owner and accepted metadata records its source and review state', async () => {
  const song = models.songModel.records.find((item) => String(item.uploadedBy) === userIds[0]);
  song.aiSuggestions = {
    status: 'completed', mood: 'romantic', genre: 'jazz', energy: 'low', tags: ['soft'],
    secondaryMoods: [], subgenres: [], listeningContexts: [], instrumentation: [], vocalCharacteristics: 'instrumental',
    review: {},
  };
  song.analysis = { status: 'completed', jobId: new mongoose.Types.ObjectId(), model: 'gemini-test' };
  const own = await fetch(`${baseUrl}/library/songs/${song._id}/analysis`, { headers: { authorization: `Bearer ${tokens[0]}` } });
  assert.equal(own.status, 200);
  assert.equal((await own.json()).analysis.suggestions.genre, 'jazz');
  const other = await fetch(`${baseUrl}/library/songs/${song._id}/analysis`, { headers: { authorization: `Bearer ${tokens[1]}` } });
  assert.equal(other.status, 404);

  const review = await fetch(`${baseUrl}/library/songs/${song._id}/metadata-review`, {
    method: 'PATCH', headers: { authorization: `Bearer ${tokens[0]}`, 'content-type': 'application/json' },
    body: JSON.stringify({ fields: { mood: 'accepted', genre: 'rejected' } }),
  });
  assert.equal(review.status, 200);
  assert.equal(song.mood, 'romantic');
  assert.equal(song.genre, undefined, 'rejected suggestions are not applied to canonical metadata');
  assert.equal(song.metadataProvenance.mood, 'user');
  assert.equal(song.aiSuggestions.review.mood.source, 'ai');
  assert.equal(song.aiSuggestions.review.mood.status, 'accepted');
  assert.equal(song.aiSuggestions.review.genre.status, 'rejected');
  assert.equal(song.metadataRevision, 2);
});

test('analysis administration is restricted to admins and catalog review preserves admin provenance', async () => {
  const catalogSong = await models.songModel.create({
    title: 'Catalog submission', artist: 'Studio', mood: 'happy', audio: 'https://media.example.test/catalog', audioMimeType: 'audio/wav',
    storageFileId: 'catalog-file', uploadedBy: new mongoose.Types.ObjectId(userIds[2]), ownerId: new mongoose.Types.ObjectId(userIds[2]),
    uploadedByRole: 'admin', uploadSource: 'admin', visibility: 'public', catalogStatus: 'pending',
  });
  catalogSong.aiSuggestions = { status: 'completed', mood: 'motivational', genre: 'rock', energy: 'high', tags: [], secondaryMoods: [], subgenres: [], listeningContexts: [], instrumentation: [], vocalCharacteristics: 'lead_vocals', review: {} };
  catalogSong.analysis = { status: 'completed', jobId: new mongoose.Types.ObjectId() };
  models.analysisJobModel.records.push({ _id: new mongoose.Types.ObjectId(), songId: catalogSong._id, status: 'failed', attempts: 3, maxAttempts: 3, lastErrorCode: 'provider_timeout', createdAt: new Date() });

  const denied = await fetch(`${baseUrl}/library/admin/analysis/jobs`, { headers: { authorization: `Bearer ${tokens[0]}` } });
  assert.equal(denied.status, 403);
  const queue = await fetch(`${baseUrl}/library/admin/analysis/jobs?status=failed`, { headers: { authorization: `Bearer ${tokens[2]}` } });
  assert.equal(queue.status, 200);
  const queueBody = await queue.json();
  assert.equal(queueBody.jobs.length, 1);
  assert.equal(queueBody.jobs[0].lastErrorCode, 'provider_timeout');
  assert.equal(queueBody.jobs[0].audio, undefined);

  const analysis = await fetch(`${baseUrl}/library/admin/songs/${catalogSong._id}/analysis`, { headers: { authorization: `Bearer ${tokens[2]}` } });
  assert.equal(analysis.status, 200);
  const review = await fetch(`${baseUrl}/library/admin/songs/${catalogSong._id}/metadata-review`, {
    method: 'PATCH', headers: { authorization: `Bearer ${tokens[2]}`, 'content-type': 'application/json' },
    body: JSON.stringify({ fields: { mood: 'accepted' } }),
  });
  assert.equal(review.status, 200);
  assert.equal(catalogSong.mood, 'motivational');
  assert.equal(catalogSong.metadataProvenance.mood, 'admin');
  assert.equal(catalogSong.aiSuggestions.review.mood.source, 'ai');
  assert.equal(catalogSong.aiSuggestions.review.mood.status, 'accepted');
});

test('favorites are unique, owner-scoped, and hide inaccessible songs', async () => {
  const song = models.songModel.records[0];
  const favoriteUrl = `${baseUrl}/library/favorites/${song._id}`;
  const add = () => fetch(favoriteUrl, { method: 'POST', headers: { authorization: `Bearer ${tokens[0]}` } });
  assert.equal((await add()).status, 201);
  assert.equal((await add()).status, 201);
  assert.equal(models.favoriteModel.records.length, 1);
  const otherUser = await fetch(favoriteUrl, { method: 'POST', headers: { authorization: `Bearer ${tokens[1]}` } });
  assert.equal(otherUser.status, 404);
  const list = await fetch(`${baseUrl}/library/favorites`, { headers: { authorization: `Bearer ${tokens[0]}` } });
  const body = await list.json();
  assert.equal(body.favorites.length, 1);
  assert.equal(body.favorites[0].audio.includes('sig=short-lived'), true);
  const removed = await fetch(favoriteUrl, { method: 'DELETE', headers: { authorization: `Bearer ${tokens[0]}` } });
  assert.equal(removed.status, 204);
  assert.equal(models.favoriteModel.records.length, 0);
});

test('media deletion failure remains retryable and cleans related favorites and playlist entries', async () => {
  const song = models.songModel.records[0];
  const playlist = await models.playlistModel.create({ userId: new mongoose.Types.ObjectId(userIds[0]), name: 'Retry', songIds: [song._id] });
  await models.favoriteModel.updateOne({ userId: new mongoose.Types.ObjectId(userIds[0]), songId: song._id }, { $setOnInsert: {} }, { upsert: true });
  providerDeleteFails = true;
  const sendDelete = () => fetch(`${baseUrl}/library/songs/${song._id}`, { method: 'DELETE', headers: { authorization: `Bearer ${tokens[0]}` } });
  const failed = await sendDelete();
  assert.equal(failed.status, 502);
  assert.equal(song.mediaStatus, 'deletion_failed');
  const library = await fetch(`${baseUrl}/library/songs`, { headers: { authorization: `Bearer ${tokens[0]}` } });
  const libraryBody = await library.json();
  assert.equal(libraryBody.songs[0].mediaStatus, 'deletion_failed');
  assert.equal(libraryBody.songs[0].audio, null);
  const otherLibrary = await fetch(`${baseUrl}/library/songs`, { headers: { authorization: `Bearer ${tokens[1]}` } });
  assert.equal((await otherLibrary.json()).songs.length, 0);
  const retried = await sendDelete();
  assert.equal(retried.status, 204);
  assert.equal(models.songModel.records.includes(song), false);
  assert.equal(models.favoriteModel.records.some((item) => String(item.songId) === String(song._id)), false);
  assert.deepEqual(playlist.songIds, []);
  assert.equal(providerDeletes.length, 2);
});

test('playlist writes use owner scoping and an optimistic revision', async () => {
  if (!models.songModel.records.some((song) => song.visibility === 'private' && String(song.uploadedBy) === userIds[0])) await upload(0);
  const ownedSong = models.songModel.records.find((song) => song.visibility === 'private' && String(song.uploadedBy) === userIds[0]);
  const create = await fetch(`${baseUrl}/library/playlists`, { method: 'POST', headers: { authorization: `Bearer ${tokens[0]}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Focus' }) });
  assert.equal(create.status, 201);
  const { playlist } = await create.json();
  const denied = await fetch(`${baseUrl}/library/playlists/${playlist.id}`, { method: 'PATCH', headers: { authorization: `Bearer ${tokens[1]}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Changed', revision: 0 }) });
  assert.equal(denied.status, 409);
  const hidden = await fetch(`${baseUrl}/library/playlists/${playlist.id}`, { headers: { authorization: `Bearer ${tokens[1]}` } });
  assert.equal(hidden.status, 404);
  const duplicate = await fetch(`${baseUrl}/library/playlists/${playlist.id}`, { method: 'PATCH', headers: { authorization: `Bearer ${tokens[0]}`, 'content-type': 'application/json' }, body: JSON.stringify({ songIds: [ownedSong._id, ownedSong._id], revision: 0 }) });
  assert.equal(duplicate.status, 400);
  const updated = await fetch(`${baseUrl}/library/playlists/${playlist.id}`, { method: 'PATCH', headers: { authorization: `Bearer ${tokens[0]}`, 'content-type': 'application/json' }, body: JSON.stringify({ songIds: [ownedSong._id], revision: 0 }) });
  assert.equal(updated.status, 200);
  const stale = await fetch(`${baseUrl}/library/playlists/${playlist.id}`, { method: 'PATCH', headers: { authorization: `Bearer ${tokens[0]}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Stale', revision: 0 }) });
  assert.equal(stale.status, 409);
});
