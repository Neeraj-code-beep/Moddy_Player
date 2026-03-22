import React, { useEffect, useRef } from 'react';
import * as faceapi from 'face-api.js';
import songApi from '../api/api';

const MoodDetector = ({ setSongs }) => {
  const videoRef = useRef(null);
  // const canvasRef = useRef(null);

  // const [mood, setMood] = useState('Detecting...');
  // const [confidence, setConfidence] = useState(0);

  // 1️⃣ Load required models only
  const loadModels = async () => {
    const MODEL_URL = '/models';

    await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
    await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
    await faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL);

    console.log('Face-API models loaded');
  };

  // 2️⃣ Start webcam
  const startVideo = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      videoRef.current.srcObject = stream;
    } catch (err) {
      console.error('Camera access denied', err);
    }
  };

  // 3️⃣ Detect mood
  async function detectMood() {
    const detections = await faceapi
      .detectAllFaces(videoRef.current, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceExpressions();

    if (!detections || detections.length === 0) {
      console.log('No face detected');
      return;
    }

    // 📌 Extract expressions
    const expressions = detections[0].expressions;

    const dominantMood = Object.keys(expressions).reduce((a, b) =>
      expressions[a] > expressions[b] ? a : b,
    );

    songApi.get(`/?mood=${dominantMood}`).then((response) => {
      console.log(response.data);
      setSongs(response.data.songs);
    });
    // Object.keys convert object into array...

    // setMood(dominantMood);
    // setConfidence(expressions[dominantMood].toFixed(2));
    console.log(dominantMood);
  }
  // 📌 Canvas drawing
  // const displaySize = {
  //   width: videoRef.current.videoWidth,
  //   height: videoRef.current.videoHeight,
  // };

  // faceapi.matchDimensions(canvasRef.current, displaySize);

  // const resized = faceapi.resizeResults(detections, displaySize);
  // const ctx = canvasRef.current.getContext('2d');

  // ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
  // faceapi.draw.drawDetections(canvasRef.current, resized);
  // faceapi.draw.drawFaceLandmarks(canvasRef.current, resized);

  // 4️⃣ Lifecycle
  useEffect(() => {
    loadModels().then(startVideo);
  }, []);

  return (
    <div className="flex justify-center flex-row gap-5 p-5 items-center">
      <video
        ref={videoRef}
        autoPlay
        muted
        className="w-80 shadow-md rounded-md object-cover aspect-video"
      />
      <button
        onClick={detectMood}
        className="shadow-md rounded-sm p-2 bg-amber-200 w-32 cursor-pointer"
      >
        Detect face
      </button>
      {/* <canvas
          ref={canvasRef}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
          }}
        /> */}
    </div>
  );
};

export default MoodDetector;
