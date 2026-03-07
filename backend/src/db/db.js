const mongoose = require('mongoose');

function connectToDB() {
  mongoose
    .connect(process.env.MONGODB_URL)
    .then(() => {
      console.log('Connected to MongoDB');
    })
    .catch((err) => {
      console.log('Error connecting to MongoDB:', err);
    });
}

module.exports = connectToDB;
