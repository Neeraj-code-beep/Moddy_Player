import React, { useState, useRef } from 'react';
import { AnimatePresence } from 'framer-motion';

import Navbar from './components/layout/Navbar';
import Hero from './components/sections/Hero';
import MoodDetector from './components/MoodDetector';
import MoodSongs from './components/MoodSongs';
import BottomPlayer from './components/player/BottomPlayer';
import { fetchRecommendations, sendFeedback } from './api/api';
import { getAdjacentSongIndex } from './lib/playback-navigation';

const App = () => {
  const [recommendationResult, setRecommendationResult] = useState(null);
  const [currentSong, setCurrentSong] = useState(null);
  const [currentIntention, setCurrentIntention] = useState('match');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [recommendationError, setRecommendationError] = useState('');
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [pendingFeedback, setPendingFeedback] = useState(new Set());
  const recommendationSequenceRef = useRef(0);
  const pendingFeedbackRef = useRef(new Set());
  const activeSongIndexRef = useRef(-1);
  const currentSongRef = useRef(null);

  const handleRecommend = async (request, options) => {
    const sequence = ++recommendationSequenceRef.current;
    setIsLoading(true);
    setRecommendationError('');
    setFeedbackMessage('');
    try {
      const result = await fetchRecommendations(request, options);
      if (sequence !== recommendationSequenceRef.current) return;
      setRecommendationResult(result);
      activeSongIndexRef.current = result.recommendations.findIndex(({ song }) => song.audio === currentSongRef.current?.audio);
      setCurrentIntention(result.intention);
      setTimeout(() => document.getElementById('songs-section')?.scrollIntoView({ behavior: 'smooth' }), 100);
    } catch (error) {
      if (sequence === recommendationSequenceRef.current && error.name !== 'CanceledError' && error.name !== 'AbortError') {
        setRecommendationError('Recommendations could not be loaded. Check the backend connection and try again.');
      }
      throw error;
    } finally {
      if (sequence === recommendationSequenceRef.current) setIsLoading(false);
    }
  };

  const recordFeedback = async (song, event, intention = currentIntention) => {
    if (!song?._id) {
      setFeedbackMessage('Feedback is unavailable for this catalog record.');
      return;
    }
    const key = `${song._id}:${event}`;
    if (pendingFeedbackRef.current.has(key)) return;
    pendingFeedbackRef.current.add(key);
    setPendingFeedback(new Set(pendingFeedbackRef.current));
    try {
      await sendFeedback({ songId: song._id, event, intention });
      setFeedbackMessage(event === 'like' ? 'Thanks for the like.' : event === 'dislike' ? 'Feedback saved.' : 'Listening feedback saved.');
    } catch {
      setFeedbackMessage('Feedback could not be saved. Please try again.');
    } finally {
      pendingFeedbackRef.current.delete(key);
      setPendingFeedback(new Set(pendingFeedbackRef.current));
    }
  };

  const handlePlaySong = (song) => {
    if (currentSongRef.current?.audio === song.audio) {
      setIsPlaying((playing) => !playing);
    } else {
      activeSongIndexRef.current = recommendationResult?.recommendations.findIndex(({ song: candidate }) => candidate.audio === song.audio) ?? -1;
      currentSongRef.current = song;
      setCurrentSong(song);
      setCurrentIntention(recommendationResult?.intention || 'match');
      setIsPlaying(true);
    }
  };

  const handleNext = () => {
    const songs = recommendationResult?.recommendations.map((item) => item.song) || [];
    if (!songs.length) return;
    const previousSong = currentSongRef.current;
    if (previousSong) void recordFeedback(previousSong, 'skip');
    const nextIndex = getAdjacentSongIndex(activeSongIndexRef.current, songs.length, 1);
    activeSongIndexRef.current = nextIndex;
    currentSongRef.current = songs[nextIndex];
    setCurrentSong(currentSongRef.current);
    setIsPlaying(true);
  };

  const handlePrevious = () => {
    const songs = recommendationResult?.recommendations.map((item) => item.song) || [];
    if (!songs.length) return;
    const previousSong = currentSongRef.current;
    if (previousSong) void recordFeedback(previousSong, 'skip');
    const previousIndex = getAdjacentSongIndex(activeSongIndexRef.current, songs.length, -1);
    activeSongIndexRef.current = previousIndex;
    currentSongRef.current = songs[previousIndex];
    setCurrentSong(currentSongRef.current);
    setIsPlaying(true);
  };

  const handlePlaybackComplete = (completedSong) => {
    if (!completedSong || currentSongRef.current?.audio !== completedSong.audio) return;
    void recordFeedback(completedSong, 'completed');
    setIsPlaying(false);
  };

  const pendingSkipCount = [...pendingFeedback].filter((key) => key.endsWith(':skip')).length;

  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/30 relative">
      <Navbar />
      <main className={currentSong ? 'pb-40 md:pb-32' : ''}>
        <Hero />
        <MoodDetector onRecommend={handleRecommend} isLoading={isLoading} error={recommendationError} />
        <AnimatePresence mode="wait">
          {recommendationResult && (
            <MoodSongs
              recommendations={recommendationResult.recommendations}
              currentSong={currentSong}
              isPlaying={isPlaying}
              onPlaySong={handlePlaySong}
              onFeedback={(song, event) => recordFeedback(song, event, recommendationResult.intention)}
              feedbackMessage={feedbackMessage}
              pendingFeedback={pendingFeedback}
            />
          )}
        </AnimatePresence>
      </main>
      <AnimatePresence>
        {currentSong && (
          <BottomPlayer
            currentSong={currentSong}
            isPlaying={isPlaying}
            setIsPlaying={setIsPlaying}
            onNext={handleNext}
            onPrev={handlePrevious}
            onEnded={() => handlePlaybackComplete(currentSong)}
            pendingSkipCount={pendingSkipCount}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default App;
