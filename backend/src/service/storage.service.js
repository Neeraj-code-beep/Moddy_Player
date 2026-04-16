const ImageKit = require('imagekit');
const mongoose = require('mongoose');

const imagekit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
});

function uploadFile(file) {
  return new Promise((resolve, reject) => {
    imagekit.upload(
      {
        file: file.buffer.toString('base64'), // important becuse it converts the raw binary data into a 64 base string...
        // fileName: new mongoose.Types.ObjectId().toString(),
        fileName: file.originalname,
        // for file name basically we can use math.random also..
        folder: 'songs',
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      },
    );
  });
}

module.exports = uploadFile;
// const uploadFile = async (file) => {
//   try {
//     const result = await imagekit.upload({
//       file: file.buffer,
//       fileName: file.originalname,
//       folder: 'songs',
//     });

//     return result;
//   } catch (error) {
//     throw error;
//   }
// };
