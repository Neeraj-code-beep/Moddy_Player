const mongoose = require('mongoose');

const songSchema = new mongoose.Schema(
  {
    title: String,
    artist: String,
    audio: String,
    mood: String,
  },
  {
    timestamps: true,
  },
);

const songModel = mongoose.model('Song', songSchema);

module.exports = songModel;
