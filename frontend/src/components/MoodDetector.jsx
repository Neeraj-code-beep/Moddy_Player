import React, { useEffect, useRef, useState } from 'react';
import * as faceapi from 'face-api.js';
import { motion as Motion } from 'framer-motion';
import { Camera, Loader2, ScanFace, Sparkles } from 'lucide-react';
import { LISTENING_INTENTIONS, MOOD_OPTIONS } from '../api/recommendation-contract';
import { cn } from '../lib/utils';

const MoodDetector = ({ onRecommend, isLoading, error: recommendationError }) => {
  const videoRef = useRef(null);
  const scanSequenceRef = useRef(0);
  const streamRef = useRef(null);
  const requestControllerRef = useRef(null);
  const isMountedRef = useRef(true);
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [isCameraEnabled, setIsCameraEnabled] = useState(false);
  const [isCameraLoading, setIsCameraLoading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [selectedMood, setSelectedMood] = useState('');
  const [detectedMood, setDetectedMood] = useState('');
  const [intention, setIntention] = useState('match');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      scanSequenceRef.current += 1;
      requestControllerRef.current?.abort();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (videoRef.current && streamRef.current) videoRef.current.srcObject = streamRef.current;
  }, [isCameraEnabled]);

  const enableCamera = async () => {
    setErrorMsg('');
    setIsCameraLoading(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (!isMountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      await faceapi.nets.tinyFaceDetector.loadFromUri('/models');
      await faceapi.nets.faceLandmark68Net.loadFromUri('/models');
      await faceapi.nets.faceExpressionNet.loadFromUri('/models');
      if (!isMountedRef.current) return;
      setIsModelLoaded(true);
      setIsCameraEnabled(true);
    } catch {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (isMountedRef.current) setErrorMsg('Camera or face detection models are unavailable. You can still choose a mood manually.');
    } finally {
      if (isMountedRef.current) setIsCameraLoading(false);
    }
  };

  const disableCamera = () => {
    scanSequenceRef.current += 1;
    setIsScanning(false);
    requestControllerRef.current?.abort();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setIsCameraEnabled(false);
    setIsModelLoaded(false);
  };

  const recommend = async (mood = selectedMood) => {
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    setErrorMsg('');
    try {
      await onRecommend({ mood: mood || undefined, intention }, { signal: controller.signal });
    } catch (error) {
      if (error.name !== 'CanceledError' && error.name !== 'AbortError') {
        setErrorMsg('Recommendations could not be loaded. Please try again.');
      }
    }
  };

  const detectMood = async () => {
    if (!isModelLoaded || !videoRef.current) return;
    const scanSequence = ++scanSequenceRef.current;
    setIsScanning(true);
    setErrorMsg('');
    try {
      const detections = await faceapi.detectAllFaces(
        videoRef.current,
        new faceapi.TinyFaceDetectorOptions(),
      ).withFaceLandmarks().withFaceExpressions();
      if (scanSequence !== scanSequenceRef.current) return;
      if (!detections.length) {
        setErrorMsg('No face detected. Choose a mood manually or try scanning again.');
        return;
      }
      const expressions = detections[0].expressions;
      const mood = Object.keys(expressions).reduce((left, right) => expressions[left] > expressions[right] ? left : right);
      const normalizedMood = MOOD_OPTIONS.includes(mood) ? mood : 'neutral';
      setSelectedMood(normalizedMood);
      setDetectedMood(normalizedMood);
      await recommend(normalizedMood);
    } catch {
      if (scanSequence === scanSequenceRef.current) setErrorMsg('Mood detection failed. You can choose a mood manually.');
    } finally {
      if (scanSequence === scanSequenceRef.current) setIsScanning(false);
    }
  };

  const error = errorMsg || recommendationError;
  const busy = isLoading || isScanning;

  return (
    <section id="detector-section" className="relative w-full max-w-4xl mx-auto py-24 px-6 flex flex-col items-center">
      <Motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center mb-10">
        <h2 className="text-3xl md:text-5xl font-bold mb-4 bg-clip-text text-transparent bg-linear-to-r from-white to-gray-400">Find your next mood</h2>
        <p className="text-gray-400 text-lg">Choose how you want to feel. Camera based mood detection is optional.</p>
      </Motion.div>

      <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-5 mb-8">
        <label className="flex flex-col gap-2 text-sm text-gray-300">
          Mood
          <select value={selectedMood} onChange={(event) => { scanSequenceRef.current += 1; setIsScanning(false); requestControllerRef.current?.abort(); setSelectedMood(event.target.value); setDetectedMood(''); }} className="rounded-xl bg-white/5 border border-white/15 px-4 py-3 text-white">
            <option value="" className="bg-[#111]">No mood selected</option>
            {MOOD_OPTIONS.map((mood) => <option key={mood} value={mood} className="bg-[#111]">{mood[0].toUpperCase() + mood.slice(1)}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-2 text-sm text-gray-300">
          Listening intention
          <select value={intention} onChange={(event) => setIntention(event.target.value)} className="rounded-xl bg-white/5 border border-white/15 px-4 py-3 text-white">
            {LISTENING_INTENTIONS.map(({ value, label }) => <option key={value} value={value} className="bg-[#111]">{label}</option>)}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap justify-center gap-3">
        <button onClick={() => recommend()} disabled={busy} className="relative px-7 py-3 rounded-full font-bold text-white bg-linear-to-r from-primary to-accent disabled:opacity-50">
          {isLoading ? <span className="flex items-center gap-2"><Loader2 className="w-5 h-5 animate-spin" />Finding tracks…</span> : 'Get recommendations'}
        </button>
        {!isCameraEnabled && (
          <button onClick={enableCamera} disabled={isCameraLoading} className="px-6 py-3 rounded-full border border-white/20 text-gray-200 hover:bg-white/5 disabled:opacity-50">
            <span className="flex items-center gap-2">{isCameraLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />}{isCameraLoading ? 'Preparing camera…' : 'Enable camera detection'}</span>
          </button>
        )}
      </div>

      {isCameraEnabled && (
        <div className="mt-8 flex flex-col items-center gap-4">
          <video ref={videoRef} autoPlay muted playsInline className={cn('w-[320px] md:w-96 aspect-video object-cover rounded-2xl bg-black/50 border border-white/10', isScanning && 'brightness-110 saturate-150')} />
          <button onClick={detectMood} disabled={!isModelLoaded || busy} className="px-6 py-3 rounded-full border border-secondary/30 text-secondary disabled:opacity-50">
            <span className="flex items-center gap-2">{isScanning ? <Loader2 className="w-5 h-5 animate-spin" /> : <ScanFace className="w-5 h-5" />}{isScanning ? 'Analyzing…' : 'Detect my mood'}</span>
          </button>
          <button onClick={disableCamera} className="text-sm text-gray-400 hover:text-white">Turn camera off</button>
        </div>
      )}

      {detectedMood && <div className="mt-6 flex items-center gap-2 text-secondary"><Sparkles className="w-5 h-5" />Camera detected {detectedMood}.</div>}
      {error && <Motion.p role="alert" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-6 text-red-400 text-sm text-center">{error}</Motion.p>}
    </section>
  );
};

export default MoodDetector;
