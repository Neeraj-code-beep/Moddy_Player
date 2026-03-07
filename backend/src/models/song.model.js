const mongoose = require('mongoose');

const songSchema = new mongoose.Schema({
  title: String,
  artist: String,
  audio: String,
});

const song = mongoose.model('Song', songSchema);

module.exports = song;
