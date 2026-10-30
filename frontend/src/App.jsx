import React, { useState, useRef } from 'react';
import { AnimatePresence } from 'framer-motion';

import Navbar from './components/layout/Navbar';
import Hero from './components/sections/Hero';
import MoodDetector from './components/MoodDetector';
import MoodSongs from './components/MoodSongs';
import BottomPlayer from './components/player/BottomPlayer';
import { fetchRecommendations, sendFeedback } from './api/api';

const App = () => {
  const [recommendationResult, setRecommendationResult] = useState(null);
  const [currentSong, setCurrentSong] = useState(null);
  const [currentIntention, setCurrentIntention] = useState('match');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [recommendationError, setRecommendationError] = useState('');
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const recommendationSequenceRef = useRef(0);

  const handleRecommend = async (request, options) => {
    const sequence = ++recommendationSequenceRef.current;
    setIsLoading(true);
    setRecommendationError('');
    setFeedbackMessage('');
    try {
      const result = await fetchRecommendations(request, options);
      if (sequence !== recommendationSequenceRef.current) return;
      setRecommendationResult(result);
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
    try {
      await sendFeedback({ songId: song._id, event, intention });
      setFeedbackMessage(event === 'like' ? 'Thanks for the like.' : event === 'dislike' ? 'Feedback saved.' : 'Listening feedback saved.');
    } catch {
      setFeedbackMessage('Feedback could not be saved. Please try again.');
    }
  };

  const handlePlaySong = (song) => {
    if (currentSong?.audio === song.audio) {
      setIsPlaying((playing) => !playing);
    } else {
      setCurrentSong(song);
      setCurrentIntention(recommendationResult?.intention || 'match');
      setIsPlaying(true);
    }
  };

  const handleNext = () => {
    const songs = recommendationResult?.recommendations.map((item) => item.song) || [];
    if (!songs.length) return;
    if (currentSong) void recordFeedback(currentSong, 'skip');
    const activeIndex = songs.findIndex((song) => song.audio === currentSong?.audio);
    const nextIndex = ((activeIndex < 0 ? -1 : activeIndex) + 1) % songs.length;
    setCurrentSong(songs[nextIndex]);
    setIsPlaying(true);
  };

  const handlePrevious = () => {
    const songs = recommendationResult?.recommendations.map((item) => item.song) || [];
    if (!songs.length) return;
    if (currentSong) void recordFeedback(currentSong, 'skip');
    const activeIndex = songs.findIndex((song) => song.audio === currentSong?.audio);
    const previousIndex = activeIndex <= 0 ? songs.length - 1 : activeIndex - 1;
    setCurrentSong(songs[previousIndex]);
    setIsPlaying(true);
  };

  const handlePlaybackComplete = () => {
    if (currentSong) void recordFeedback(currentSong, 'completed');
    setIsPlaying(false);
  };

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
            onEnded={handlePlaybackComplete}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default App;
