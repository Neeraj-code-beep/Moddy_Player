import React, { useState, useEffect } from 'react';
import Lenis from 'lenis';
import { AnimatePresence } from 'framer-motion';

import Navbar from './components/layout/Navbar';
import Hero from './components/sections/Hero';
import MoodDetector from './components/MoodDetector';
import MoodSongs from './components/MoodSongs';
import BottomPlayer from './components/player/BottomPlayer';

const App = () => {
  const [songs, setSongs] = useState([]);
  const [currentSong, setCurrentSong] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);

  // Initialize smooth scrolling
  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.2,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      orientation: 'vertical',
      gestureOrientation: 'vertical',
      smoothWheel: true,
      wheelMultiplier: 1,
      smoothTouch: false,
      touchMultiplier: 2,
      infinite: false,
    });

    function raf(time) {
      lenis.raf(time);
      requestAnimationFrame(raf);
    }

    requestAnimationFrame(raf);

    return () => {
      lenis.destroy();
    };
  }, []);

  const handlePlaySong = (song) => {
    if (currentSong?.audio === song.audio) {
      setIsPlaying(!isPlaying); // Toggle play/pause if same song
    } else {
      setCurrentSong(song);
      setIsPlaying(true);
    }
  };

  const handleNext = () => {
    if (songs.length === 0) return;
    const activeIndex = songs.findIndex((song) => song.audio === currentSong?.audio);
    const nextIndex = ((activeIndex < 0 ? -1 : activeIndex) + 1) % songs.length;
    setCurrentSong(songs[nextIndex]);
    setIsPlaying(true);
  };

  const handlePrev = () => {
    if (songs.length === 0) return;
    const activeIndex = songs.findIndex((song) => song.audio === currentSong?.audio);
    const prevIndex = activeIndex <= 0 ? songs.length - 1 : activeIndex - 1;
    setCurrentSong(songs[prevIndex]);
    setIsPlaying(true);
  };

  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/30 relative">
      <Navbar />
      
      <main>
        <Hero />
        
        <div id="discover">
          <MoodDetector setSongs={setSongs} />
        </div>
        
        <AnimatePresence mode="wait">
          {songs.length > 0 && (
            <MoodSongs 
              Songs={songs} 
              currentSong={currentSong} 
              isPlaying={isPlaying} 
              onPlaySong={handlePlaySong} 
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
            onPrev={handlePrev}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default App;
