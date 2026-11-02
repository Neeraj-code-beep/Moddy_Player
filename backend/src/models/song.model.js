const mongoose = require('mongoose');

const aiSuggestionSchema = new mongoose.Schema({
  mood: { type: String, maxlength: 40 },
  genre: { type: String, maxlength: 60 },
  energy: { type: String, enum: ['low', 'medium', 'high'] },
  tags: { type: [{ type: String, maxlength: 30 }], default: undefined },
  language: { type: String, maxlength: 40 },
  status: { type: String, enum: ['not_configured', 'ready', 'failed'], default: 'not_configured' },
  generatedAt: { type: Date },
  provider: { type: String, maxlength: 80 },
}, { _id: false, id: false });

const metadataProvenanceSchema = new mongoose.Schema({
  mood: { type: String, enum: ['ai', 'user', 'admin', 'legacy'], default: 'legacy' },
  genre: { type: String, enum: ['ai', 'user', 'admin', 'legacy'], default: 'legacy' },
  energy: { type: String, enum: ['ai', 'user', 'admin', 'legacy'], default: 'legacy' },
  tags: { type: String, enum: ['ai', 'user', 'admin', 'legacy'], default: 'legacy' },
}, { _id: false, id: false });

const songSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    artist: { type: String, required: true, trim: true, maxlength: 120 },
    audio: { type: String, required: true, trim: true, maxlength: 2048 },
    storageFileId: { type: String, trim: true, maxlength: 256, select: false },
    mood: { type: String, required: true, trim: true, maxlength: 40 },
    genre: { type: String, trim: true, maxlength: 60 },
    energy: { type: String, enum: ['low', 'medium', 'high'] },
    tags: { type: [{ type: String, trim: true, lowercase: true, maxlength: 30 }], default: undefined },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true, select: false },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true, select: false },
    visibility: { type: String, enum: ['public', 'private'], default: 'private', required: true },
    catalogStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: undefined },
    uploadedByRole: { type: String, enum: ['admin', 'user', 'system'], default: 'system', required: true },
    uploadSource: { type: String, enum: ['admin', 'user', 'legacy'], default: 'legacy', required: true },
    aiSuggestions: { type: aiSuggestionSchema, default: undefined, select: false },
    metadataProvenance: { type: metadataProvenanceSchema, default: undefined, select: false },
    mediaStatus: { type: String, enum: ['active', 'deleting', 'deletion_failed', 'deleted'], default: 'active', required: true },
    mediaDeletedAt: { type: Date, default: null, select: false },
    uploadFingerprint: { type: String, maxlength: 64, select: false },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, select: false },
    reviewedAt: { type: Date, default: null, select: false },
  },
  {
    timestamps: true,
  },
);


songSchema.index({ mood: 1, createdAt: -1, _id: -1 });
songSchema.index({ createdAt: -1, _id: -1 });
songSchema.index({ uploadedBy: 1, mediaStatus: 1, createdAt: -1, _id: -1 });
songSchema.index({ uploadedBy: 1, uploadSource: 1, uploadFingerprint: 1 }, { unique: true, partialFilterExpression: { uploadFingerprint: { $type: 'string' } } });
songSchema.index({ visibility: 1, catalogStatus: 1, uploadSource: 1, createdAt: -1, _id: -1 });

songSchema.pre('validate', function validateOwnership() {
  if (this.uploadSource === 'user') {
    if (this.visibility !== 'private') this.invalidate('visibility', 'Personal uploads must remain private.');
    if (!this.uploadedBy && !this.ownerId) this.invalidate('uploadedBy', 'Personal uploads require an authenticated owner.');
    if (this.catalogStatus != null) this.invalidate('catalogStatus', 'Personal uploads cannot enter the public catalog workflow.');
  }
  if (this.uploadSource === 'admin') {
    if (this.visibility !== 'public') this.invalidate('visibility', 'Administrator catalog submissions must be public.');
    if (!this.uploadedBy && !this.ownerId) this.invalidate('uploadedBy', 'Administrator uploads require an authenticated uploader.');
    if (!this.catalogStatus) this.invalidate('catalogStatus', 'Administrator catalog submissions require a review status.');
  }
});

const songModel = mongoose.model('Song', songSchema);

module.exports = songModel;
