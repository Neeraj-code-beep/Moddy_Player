const mongoose = require('mongoose');

const reviewFieldSchema = new mongoose.Schema({
  source: { type: String, enum: ['ai', 'user', 'admin', 'system'], default: 'ai' },
  confidence: { type: Number, min: 0, max: 1 },
  status: { type: String, enum: ['pending', 'accepted', 'rejected', 'overridden'] },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: { type: Date },
}, { _id: false, id: false });

const aiSuggestionSchema = new mongoose.Schema({
  mood: { type: String, maxlength: 40 },
  secondaryMoods: { type: [{ type: String, maxlength: 40 }], default: undefined },
  genre: { type: String, maxlength: 60 },
  subgenres: { type: [{ type: String, maxlength: 40 }], default: undefined },
  energy: { type: String, enum: ['low', 'medium', 'high'] },
  listeningContexts: { type: [{ type: String, maxlength: 40 }], default: undefined },
  instrumentation: { type: [{ type: String, maxlength: 40 }], default: undefined },
  vocalCharacteristics: { type: String, enum: ['instrumental', 'lead_vocals', 'group_vocals', 'spoken_word', 'unclear'] },
  tags: { type: [{ type: String, maxlength: 30 }], default: undefined },
  language: { type: String, maxlength: 40 },
  status: { type: String, enum: ['not_configured', 'queued', 'processing', 'completed', 'ready', 'failed'], default: 'not_configured' },
  generatedAt: { type: Date },
  provider: { type: String, maxlength: 80 },
  model: { type: String, maxlength: 100 },
  review: {
    mood: { type: reviewFieldSchema }, secondaryMoods: { type: reviewFieldSchema },
    genre: { type: reviewFieldSchema }, subgenres: { type: reviewFieldSchema },
    energy: { type: reviewFieldSchema }, listeningContexts: { type: reviewFieldSchema },
    instrumentation: { type: reviewFieldSchema }, vocalCharacteristics: { type: reviewFieldSchema },
    language: { type: reviewFieldSchema }, tags: { type: reviewFieldSchema },
  },
}, { _id: false, id: false });

const analysisSchema = new mongoose.Schema({
  status: { type: String, enum: ['not_configured', 'queued', 'processing', 'completed', 'failed'], default: 'not_configured' },
  jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'SongAnalysisJob' },
  requestedAt: { type: Date },
  completedAt: { type: Date },
  errorCode: { type: String, maxlength: 60 },
  model: { type: String, maxlength: 100 },
}, { _id: false, id: false });

const metadataProvenanceSchema = new mongoose.Schema({
  mood: { type: String, enum: ['ai', 'user', 'admin', 'system', 'legacy'], default: 'legacy' },
  secondaryMoods: { type: String, enum: ['ai', 'user', 'admin', 'system', 'legacy'], default: 'legacy' },
  genre: { type: String, enum: ['ai', 'user', 'admin', 'system', 'legacy'], default: 'legacy' },
  subgenres: { type: String, enum: ['ai', 'user', 'admin', 'system', 'legacy'], default: 'legacy' },
  energy: { type: String, enum: ['ai', 'user', 'admin', 'system', 'legacy'], default: 'legacy' },
  listeningContexts: { type: String, enum: ['ai', 'user', 'admin', 'system', 'legacy'], default: 'legacy' },
  instrumentation: { type: String, enum: ['ai', 'user', 'admin', 'system', 'legacy'], default: 'legacy' },
  vocalCharacteristics: { type: String, enum: ['ai', 'user', 'admin', 'system', 'legacy'], default: 'legacy' },
  language: { type: String, enum: ['ai', 'user', 'admin', 'system', 'legacy'], default: 'legacy' },
  tags: { type: String, enum: ['ai', 'user', 'admin', 'system', 'legacy'], default: 'legacy' },
}, { _id: false, id: false });

const moodValues = ['angry', 'disgusted', 'fearful', 'happy', 'neutral', 'sad', 'surprised', 'romantic', 'energetic', 'calm', 'nostalgic', 'peaceful', 'motivational', 'melancholic'];
const contextValues = ['celebration', 'focus', 'late_night', 'relaxing', 'studying', 'travelling', 'workout'];

const songSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    artist: { type: String, required: true, trim: true, maxlength: 120 },
    audio: { type: String, required: true, trim: true, maxlength: 2048 },
    audioMimeType: { type: String, trim: true, maxlength: 40, select: false },
    storageFileId: { type: String, trim: true, maxlength: 256, select: false },
    mood: { type: String, required: true, trim: true, maxlength: 40 },
    secondaryMoods: { type: [{ type: String, enum: moodValues, maxlength: 40 }], default: undefined },
    genre: { type: String, trim: true, maxlength: 60 },
    subgenres: { type: [{ type: String, trim: true, maxlength: 40 }], default: undefined },
    energy: { type: String, enum: ['low', 'medium', 'high'] },
    listeningContexts: { type: [{ type: String, enum: contextValues, maxlength: 40 }], default: undefined },
    instrumentation: { type: [{ type: String, trim: true, maxlength: 40 }], default: undefined },
    vocalCharacteristics: { type: String, enum: ['instrumental', 'lead_vocals', 'group_vocals', 'spoken_word', 'unclear'] },
    language: { type: String, trim: true, maxlength: 40 },
    tags: { type: [{ type: String, trim: true, lowercase: true, maxlength: 30 }], default: undefined },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true, select: false },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true, select: false },
    visibility: { type: String, enum: ['public', 'private'], default: 'private', required: true },
    catalogStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: undefined },
    uploadedByRole: { type: String, enum: ['admin', 'user', 'system'], default: 'system', required: true },
    uploadSource: { type: String, enum: ['admin', 'user', 'legacy'], default: 'legacy', required: true },
    aiSuggestions: { type: aiSuggestionSchema, default: undefined, select: false },
    analysis: { type: analysisSchema, default: () => ({ status: 'not_configured' }), select: false },
    metadataRevision: { type: Number, default: 0, min: 0, select: false },
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
