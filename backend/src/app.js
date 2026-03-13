const express = require('express');
const cors = require('cors');
const songRoutes = require('./routes/song.routes');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/', songRoutes);

module.exports = app;
