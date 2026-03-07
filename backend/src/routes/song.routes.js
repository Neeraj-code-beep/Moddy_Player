const express = require('express');
const multer = require('multer');
const router = express.Router();
const uploadFile = require('../service/storage.service');

const upload = multer({ storage: multer.memoryStorage() });

// sending json data...
// router.post('/songs', async (req, res) => {
//   await song.create({
//     title: req.body.title,
//   });

//   res.json('Song added successfully..');
// });

// sending form data....
router.post('/songs', upload.single('audio'), async (req, res) => {
  console.log(req.body);
  console.log(req.file);
  const fileData = await uploadFile(req.file);
  console.log(fileData);
  res.status(201).json({
    message: 'Song created successfully',
    song: req.body,
  });
});

module.exports = router;

// so understand one thing for the json data format we use middlewares..
// but for form data format we use multer...
