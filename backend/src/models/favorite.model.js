const mongoose = require('mongoose');

const favoriteSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  songId: { type: mongoose.Schema.Types.ObjectId, ref: 'Song', required: true },
}, { timestamps: true, versionKey: false });

favoriteSchema.index({ userId: 1, songId: 1 }, { unique: true });
favoriteSchema.index({ userId: 1, createdAt: -1, _id: -1 });

module.exports = mongoose.models.Favorite || mongoose.model('Favorite', favoriteSchema);
