const mongoose = require('mongoose');

const songAnalysisJobSchema = new mongoose.Schema({
  songId: { type: mongoose.Schema.Types.ObjectId, ref: 'Song', required: true, unique: true },
  status: { type: String, enum: ['queued', 'processing', 'completed', 'failed'], required: true, default: 'queued' },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  requestSource: { type: String, enum: ['upload', 'owner_retry', 'admin_retry', 'admin_backfill'], required: true, default: 'upload' },
  metadataRevision: { type: Number, required: true, min: 0 },
  attempts: { type: Number, required: true, default: 0, min: 0 },
  maxAttempts: { type: Number, required: true, min: 1, max: 10 },
  availableAt: { type: Date, required: true, default: Date.now },
  leaseUntil: { type: Date, default: null },
  workerId: { type: String, maxlength: 100, default: null },
  lastErrorCode: { type: String, maxlength: 60, default: null },
  resultStatus: { type: String, enum: ['applied', 'superseded'], default: null },
  provider: { type: String, maxlength: 40, default: 'gemini' },
  model: { type: String, maxlength: 100, required: true },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
}, { timestamps: true, versionKey: false });

songAnalysisJobSchema.index({ status: 1, availableAt: 1, createdAt: 1 });
songAnalysisJobSchema.index({ status: 1, leaseUntil: 1 });

module.exports = mongoose.models.SongAnalysisJob || mongoose.model('SongAnalysisJob', songAnalysisJobSchema);
