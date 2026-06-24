import React, { useEffect, useRef, useState } from 'react';
import * as faceapi from 'face-api.js';
import songApi from '../api/api';
import { motion, AnimatePresence } from 'framer-motion';
import { ScanFace, Loader2, Sparkles } from 'lucide-react';
import { cn } from '../lib/utils';

const MoodDetector = ({ setSongs }) => {
  const videoRef = useRef(null);

  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [detectedMood, setDetectedMood] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  // Load face-api models
  const loadModels = async () => {
    try {
      const MODEL_URL = '/models';

      await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
      await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
      await faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL);

      setIsModelLoaded(true);
      console.log('Face-API models loaded');
    } catch (err) {
      console.error('Failed to load models', err);
      setErrorMsg('Failed to load face detection models.');
    }
  };

  // Start webcam
  const startVideo = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error('Camera access denied', err);
      setErrorMsg('Camera access denied. Please allow camera permissions.');
    }
  };

  // Detect mood
  const detectMood = async () => {
    if (!isModelLoaded || !videoRef.current) return;

    setIsScanning(true);
    setDetectedMood(null);
    setErrorMsg('');

    try {
      // Premium scanning delay
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const detections = await faceapi
        .detectAllFaces(videoRef.current, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks()
        .withFaceExpressions();

      if (!detections || detections.length === 0) {
        setErrorMsg('No face detected. Please ensure you are visible.');
        return;
      }

      const expressions = detections[0].expressions;

      const dominantMood = Object.keys(expressions).reduce((a, b) =>
        expressions[a] > expressions[b] ? a : b,
      );

      setDetectedMood(dominantMood);

      const response = await songApi.get(`/?mood=${dominantMood}`);

      console.log(response.data);
      setSongs(response.data.songs);

      setTimeout(() => {
        document
          .getElementById('songs-section')
          ?.scrollIntoView({ behavior: 'smooth' });
      }, 500);

      console.log('Detected:', dominantMood);
    } catch (err) {
      console.error('Error during detection', err);
      setErrorMsg('An error occurred during scanning.');
    } finally {
      setIsScanning(false);
    }
  };

  // Lifecycle
  useEffect(() => {
    loadModels().then(startVideo);

    return () => {
      if (videoRef.current?.srcObject) {
        videoRef.current.srcObject.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  return (
    <section
      id="detector-section"
      className="relative w-full max-w-4xl mx-auto py-24 px-6 flex flex-col items-center"
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        className="text-center mb-12"
      >
        <h2 className="text-3xl md:text-5xl font-bold mb-4 bg-clip-text text-transparent bg-linear-to-r from-white to-gray-400">
          AI Emotion Analysis
        </h2>

        <p className="text-gray-400 text-lg">
          Position your face in the frame and let our neural engine detect your
          current vibe.
        </p>
      </motion.div>

      <div className="relative group">
        <div
          className={cn(
            'absolute -inset-1 bg-linear-to-r from-primary via-secondary to-accent rounded-2xl blur opacity-30 group-hover:opacity-70 transition duration-1000 group-hover:duration-200',
            isScanning && 'animate-pulse opacity-100 blur-md',
          )}
        />

        <div className="relative bg-[#0a0a0a] rounded-2xl p-2 border border-white/10 glass-panel overflow-hidden shadow-2xl">
          <div className="relative rounded-xl overflow-hidden aspect-video w-[320px] md:w-160 bg-black/50 flex items-center justify-center">
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className={cn(
                'w-full h-full object-cover transition-all duration-700',
                isScanning
                  ? 'scale-105 brightness-110 saturate-150'
                  : 'scale-100',
              )}
            />

            <AnimatePresence>
              {isScanning && (
                <motion.div
                  initial={{ top: '0%' }}
                  animate={{ top: '100%' }}
                  transition={{
                    duration: 1.5,
                    repeat: Infinity,
                    ease: 'linear',
                  }}
                  className="absolute left-0 right-0 h-1 bg-secondary shadow-[0_0_20px_#06b6d4] z-10"
                />
              )}
            </AnimatePresence>

            <div className="absolute top-4 left-4 w-6 h-6 border-t-2 border-l-2 border-white/30 rounded-tl-lg pointer-events-none" />
            <div className="absolute top-4 right-4 w-6 h-6 border-t-2 border-r-2 border-white/30 rounded-tr-lg pointer-events-none" />
            <div className="absolute bottom-4 left-4 w-6 h-6 border-b-2 border-l-2 border-white/30 rounded-bl-lg pointer-events-none" />
            <div className="absolute bottom-4 right-4 w-6 h-6 border-b-2 border-r-2 border-white/30 rounded-br-lg pointer-events-none" />

            {!isModelLoaded && (
              <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center z-20">
                <Loader2 className="w-8 h-8 text-primary animate-spin mb-4" />

                <span className="text-sm font-mono text-primary animate-pulse tracking-widest">
                  INITIALIZING NEURAL NETS...
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-10 flex flex-col items-center gap-6">
        <button
          onClick={detectMood}
          disabled={!isModelLoaded || isScanning}
          className="relative px-8 py-4 rounded-full font-bold text-white transition-all overflow-hidden group disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <div className="absolute inset-0 bg-linear-to-r from-primary to-accent opacity-80 group-hover:opacity-100 transition-opacity" />

          <span className="relative flex items-center gap-3">
            {isScanning ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Analyzing Face...
              </>
            ) : (
              <>
                <ScanFace className="w-5 h-5" />
                Initialize Scan
              </>
            )}
          </span>
        </button>

        {errorMsg && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-red-400 text-sm font-medium bg-red-400/10 px-4 py-2 rounded-lg border border-red-400/20"
          >
            {errorMsg}
          </motion.div>
        )}

        <AnimatePresence>
          {detectedMood && !isScanning && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="flex items-center gap-3 glass-panel px-6 py-3 rounded-2xl border border-secondary/30 shadow-[0_0_30px_rgba(6,182,212,0.2)]"
            >
              <Sparkles className="w-5 h-5 text-secondary" />

              <div className="flex flex-col">
                <span className="text-xs text-gray-400 font-medium uppercase tracking-wider">
                  Detected Vibe
                </span>

                <span className="text-xl font-bold text-white capitalize">
                  {detectedMood}
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
};

export default MoodDetector;
