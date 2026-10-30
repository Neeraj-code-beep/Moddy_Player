const mongoose = require('mongoose');

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
  },
  {
    timestamps: true,
  },
);

songSchema.index({ mood: 1, createdAt: -1, _id: -1 });
songSchema.index({ createdAt: -1, _id: -1 });

const songModel = mongoose.model('Song', songSchema);

module.exports = songModel;
