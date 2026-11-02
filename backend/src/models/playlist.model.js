const mongoose = require('mongoose');

const MAX_PLAYLIST_SONGS = 500;

const playlistSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true, minlength: 1, maxlength: 80 },
  description: { type: String, trim: true, maxlength: 500, default: '' },
  visibility: { type: String, enum: ['private'], default: 'private', required: true },
  songIds: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Song' }],
    default: [],
    validate: {
      validator(ids) {
        return ids.length <= MAX_PLAYLIST_SONGS && new Set(ids.map(String)).size === ids.length;
      },
      message: `A playlist can contain at most ${MAX_PLAYLIST_SONGS} unique songs.`,
    },
  },
  revision: { type: Number, default: 0, min: 0 },
}, { timestamps: true });

playlistSchema.index({ userId: 1, updatedAt: -1, _id: -1 });

module.exports = mongoose.models.Playlist || mongoose.model('Playlist', playlistSchema);
module.exports.MAX_PLAYLIST_SONGS = MAX_PLAYLIST_SONGS;
