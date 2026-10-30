import React, { useEffect, useRef, useState } from 'react';
import { motion as Motion } from 'framer-motion';
import { Camera, Loader2, ScanFace, Sparkles } from 'lucide-react';
import { LISTENING_INTENTIONS, MOOD_OPTIONS } from '../api/recommendation-contract';
import { cn } from '../lib/utils';
import { disposeCameraModels } from '../lib/camera-model-cleanup';

const MoodDetector = ({ onRecommend, isLoading, error: recommendationError }) => {
  const videoRef = useRef(null);
  const scanSequenceRef = useRef(0);
  const cameraSequenceRef = useRef(0);
  const cameraLoadsInProgressRef = useRef(new Set());
  const scanInProgressRef = useRef(false);
  const disposeAfterScanRef = useRef(false);
  const streamRef = useRef(null);
  const faceApiRef = useRef(null);
  const requestControllerRef = useRef(null);
  const isMountedRef = useRef(true);
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [isCameraEnabled, setIsCameraEnabled] = useState(false);
  const [isCameraLoading, setIsCameraLoading] = useState(false);
  const [isCameraCleanupPending, setIsCameraCleanupPending] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [selectedMood, setSelectedMood] = useState('');
  const [detectedMood, setDetectedMood] = useState('');
  const [intention, setIntention] = useState('match');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    isMountedRef.current = true;
    const cameraLoadsInProgress = cameraLoadsInProgressRef.current;
    return () => {
      isMountedRef.current = false;
      scanSequenceRef.current += 1;
      cameraSequenceRef.current += 1;
      requestControllerRef.current?.abort();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (scanInProgressRef.current) disposeAfterScanRef.current = true;
      else if (cameraLoadsInProgress.size === 0) disposeCameraModels(faceApiRef.current);
    };
  }, []);

  useEffect(() => {
    if (videoRef.current && streamRef.current) videoRef.current.srcObject = streamRef.current;
  }, [isCameraEnabled]);

  const enableCamera = async () => {
    const cameraSequence = ++cameraSequenceRef.current;
    cameraLoadsInProgressRef.current.add(cameraSequence);
    setErrorMsg('');
    setIsCameraLoading(true);
    let faceapi;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (!isMountedRef.current || cameraSequence !== cameraSequenceRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      faceapi = await import('face-api.js');
      if (!isMountedRef.current || cameraSequence !== cameraSequenceRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        disposeCameraModels(faceapi);
        return;
      }
      faceApiRef.current = faceapi;
      await faceapi.nets.tinyFaceDetector.loadFromUri('/models');
      if (cameraSequence !== cameraSequenceRef.current) {
        disposeCameraModels(faceapi);
        return;
      }
      await faceapi.nets.faceLandmark68Net.loadFromUri('/models');
      if (cameraSequence !== cameraSequenceRef.current) {
        disposeCameraModels(faceapi);
        return;
      }
      await faceapi.nets.faceExpressionNet.loadFromUri('/models');
      if (!isMountedRef.current || cameraSequence !== cameraSequenceRef.current) {
        disposeCameraModels(faceapi);
        return;
      }
      setIsModelLoaded(true);
      setIsCameraEnabled(true);
    } catch {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      disposeCameraModels(faceapi || faceApiRef.current);
      faceApiRef.current = null;
      if (isMountedRef.current && cameraSequence === cameraSequenceRef.current) setErrorMsg('Camera or face detection models are unavailable. You can still choose a mood manually.');
    } finally {
      cameraLoadsInProgressRef.current.delete(cameraSequence);
      if (isMountedRef.current) {
        if (cameraLoadsInProgressRef.current.size === 0) setIsCameraCleanupPending(false);
        if (cameraSequence === cameraSequenceRef.current) setIsCameraLoading(false);
      }
    }
  };

  const disableCamera = () => {
    cameraSequenceRef.current += 1;
    scanSequenceRef.current += 1;
    setIsScanning(false);
    setIsCameraLoading(false);
    setIsCameraCleanupPending(cameraLoadsInProgressRef.current.size > 0 || scanInProgressRef.current);
    requestControllerRef.current?.abort();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setIsCameraEnabled(false);
    setIsModelLoaded(false);
    if (scanInProgressRef.current) disposeAfterScanRef.current = true;
    else if (cameraLoadsInProgressRef.current.size === 0) disposeCameraModels(faceApiRef.current);
    faceApiRef.current = null;
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
    if (!isModelLoaded || !videoRef.current || !faceApiRef.current) return;
    const scanSequence = ++scanSequenceRef.current;
    const faceapi = faceApiRef.current;
    scanInProgressRef.current = true;
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
      scanInProgressRef.current = false;
      if (disposeAfterScanRef.current) {
        disposeCameraModels(faceapi);
        disposeAfterScanRef.current = false;
        if (isMountedRef.current && cameraLoadsInProgressRef.current.size === 0) setIsCameraCleanupPending(false);
      }
      if (scanSequence === scanSequenceRef.current) setIsScanning(false);
    }
  };

  const error = errorMsg || recommendationError;
  const busy = isLoading || isScanning;

  return (
    <section id="discover" aria-labelledby="detector-title" className="relative mx-auto flex w-full max-w-4xl scroll-mt-24 flex-col items-center px-5 py-16 sm:px-8 md:py-24">
      <Motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center mb-10">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-amber-100/75">Start with a feeling</p>
        <h2 id="detector-title" className="mb-4 text-3xl font-semibold tracking-tight text-white md:text-5xl">What should your music do?</h2>
        <p className="mx-auto max-w-xl text-sm leading-6 text-white/55 sm:text-base">Choose a mood and listening intention, or leave mood open. Camera based detection is optional.</p>
      </Motion.div>

      <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-5 mb-8">
        <label className="flex flex-col gap-2 text-sm text-white/75">
          Mood
          <select value={selectedMood} onChange={(event) => { scanSequenceRef.current += 1; setIsScanning(false); requestControllerRef.current?.abort(); setSelectedMood(event.target.value); setDetectedMood(''); }} className="min-h-12 rounded-xl border border-white/15 bg-white/[0.045] px-4 py-3 text-white">
            <option value="" className="bg-[#111]">No mood selected</option>
            {MOOD_OPTIONS.map((mood) => <option key={mood} value={mood} className="bg-[#111]">{mood[0].toUpperCase() + mood.slice(1)}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-2 text-sm text-white/75">
          Listening intention
          <select value={intention} onChange={(event) => setIntention(event.target.value)} className="min-h-12 rounded-xl border border-white/15 bg-white/[0.045] px-4 py-3 text-white">
            {LISTENING_INTENTIONS.map(({ value, label }) => <option key={value} value={value} className="bg-[#111]">{label}</option>)}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap justify-center gap-3">
        <button type="button" onClick={() => recommend()} disabled={busy} className="relative inline-flex min-h-12 items-center justify-center rounded-full bg-amber-100 px-7 py-3 font-semibold text-[#201b13] transition hover:bg-white disabled:cursor-wait disabled:opacity-50">
          {isLoading ? <span className="flex items-center gap-2"><Loader2 className="w-5 h-5 animate-spin" />Finding tracks…</span> : 'Get recommendations'}
        </button>
        {!isCameraEnabled && (
          <button type="button" onClick={enableCamera} disabled={isCameraLoading || isCameraCleanupPending} className="min-h-12 rounded-full border border-white/20 px-6 py-3 text-white/80 transition hover:bg-white/[0.06] disabled:opacity-50">
            <span className="flex items-center gap-2">{isCameraLoading || isCameraCleanupPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />}{isCameraCleanupPending ? 'Releasing camera resources…' : isCameraLoading ? 'Preparing camera…' : 'Enable camera detection'}</span>
          </button>
        )}
        {isCameraLoading && !isCameraCleanupPending && (
          <button type="button" onClick={disableCamera} className="min-h-12 rounded-full px-5 py-3 text-sm text-white/60 transition hover:bg-white/[0.06] hover:text-white">
            Cancel camera setup
          </button>
        )}
      </div>

      {!isCameraEnabled && (
        <p className="mt-5 max-w-lg text-center text-xs leading-5 text-white/45">
          The camera only starts when you choose it. Mood analysis runs in this browser; no camera image is uploaded or stored.
        </p>
      )}

      {isCameraEnabled && (
        <div className="mt-8 flex flex-col items-center gap-4">
          <video ref={videoRef} aria-label="Live camera preview used for on-device mood estimation" autoPlay muted playsInline className={cn('aspect-video w-full max-w-sm rounded-2xl border border-white/10 bg-black/50 object-cover', isScanning && 'brightness-110 saturate-150')} />
          <button type="button" onClick={detectMood} disabled={!isModelLoaded || busy} className="min-h-12 rounded-full border border-amber-100/30 px-6 py-3 text-amber-100 disabled:opacity-50">
            <span className="flex items-center gap-2">{isScanning ? <Loader2 className="w-5 h-5 animate-spin" /> : <ScanFace className="w-5 h-5" />}{isScanning ? 'Analyzing…' : 'Detect my mood'}</span>
          </button>
          <button type="button" onClick={disableCamera} className="min-h-11 rounded px-3 text-sm text-white/55 hover:text-white">Turn camera off</button>
        </div>
      )}

      {detectedMood && <div role="status" className="mt-6 flex items-center gap-2 text-sm text-amber-100"><Sparkles aria-hidden="true" className="h-5 w-5" />Camera suggests {detectedMood}; you can change it manually.</div>}
      {error && <Motion.p role="alert" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-6 text-red-400 text-sm text-center">{error}</Motion.p>}
    </section>
  );
};

export default MoodDetector;
