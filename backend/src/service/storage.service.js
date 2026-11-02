const ImageKit = require('imagekit');
const mongoose = require('mongoose');

const imagekit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
});

function uploadFile(file, fileName = file.originalname, options = {}) {
  return new Promise((resolve, reject) => {
    imagekit.upload(
      {
        file: file.buffer.toString('base64'),
        fileName,
        folder: 'songs',
        ...(options.isPrivateFile ? { isPrivateFile: true } : {}),
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

uploadFile.deleteFile = (fileId) => imagekit.deleteFile(fileId);
uploadFile.getDeliveryUrl = (url) => imagekit.url({ src: url, signed: true, expireSeconds: 900 });

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

// function uploadFile(file) {
//   return new Promise( (reject, resolve) => {
//     imagekit.upload({
//       file: file.buffer.toString('base64'),
//       fileName: new mongoose.Types.ObjectId().toString();
//       folder: "songs"
//     },
//   (error , result) => {
//     if (error) {
//       reject(error)
//     } else {
//       resolve(result)
//     }
//   })
//   })
// }
