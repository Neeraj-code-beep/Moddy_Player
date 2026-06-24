import React, { useRef, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Pause, SkipBack, SkipForward, Volume2, Music2 } from 'lucide-react';
import { cn } from '../../lib/utils';

const BottomPlayer = ({ currentSong, isPlaying, setIsPlaying, onNext, onPrev }) => {
  const audioRef = useRef(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (isPlaying && audioRef.current) {
      audioRef.current.play().catch((err) => console.log('Autoplay blocked:', err));
    } else if (!isPlaying && audioRef.current) {
      audioRef.current.pause();
    }
  }, [isPlaying, currentSong]);

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setProgress((audioRef.current.currentTime / audioRef.current.duration) * 100 || 0);
    }
  };

  const handleSeek = (e) => {
    if (audioRef.current) {
      const seekTime = (e.target.value / 100) * audioRef.current.duration;
      audioRef.current.currentTime = seekTime;
      setProgress(e.target.value);
    }
  };

  const togglePlay = () => {
    setIsPlaying(!isPlaying);
  };

  if (!currentSong) return null;

  return (
    <motion.div
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 100, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 200, damping: 25 }}
      className="fixed bottom-0 left-0 right-0 z-50 p-4 pb-6 md:pb-4"
    >
      <div className="max-w-6xl mx-auto glass-panel rounded-2xl p-4 flex flex-col md:flex-row items-center justify-between gap-4 border border-white/10 shadow-[0_-10px_40px_rgba(0,0,0,0.5)]">
        
        {/* Hidden Audio Element */}
        <audio
          ref={audioRef}
          src={currentSong.audio}
          onTimeUpdate={handleTimeUpdate}
          onEnded={onNext}
          className="hidden"
        />

        {/* Track Info */}
        <div className="flex items-center gap-4 w-full md:w-1/3">
          <motion.div
            animate={{ rotate: isPlaying ? 360 : 0 }}
            transition={{ duration: 10, repeat: Infinity, ease: 'linear' }}
            className={cn(
              "w-12 h-12 rounded-full flex items-center justify-center bg-gradient-to-tr from-primary to-accent shadow-lg",
              !isPlaying && "animation-paused"
            )}
            style={{ animationPlayState: isPlaying ? 'running' : 'paused' }}
          >
            <Music2 className="w-5 h-5 text-white" />
          </motion.div>
          <div className="flex flex-col overflow-hidden">
            <span className="text-white font-semibold truncate">{currentSong.title}</span>
            <span className="text-gray-400 text-sm truncate">{currentSong.artist}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-col items-center w-full md:w-1/3 gap-2">
          <div className="flex items-center gap-6">
            <button onClick={onPrev} className="text-gray-400 hover:text-white transition-colors">
              <SkipBack className="w-5 h-5" />
            </button>
            <button
              onClick={togglePlay}
              className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 active:scale-95 transition-transform"
            >
              {isPlaying ? <Pause className="w-5 h-5 fill-black" /> : <Play className="w-5 h-5 fill-black ml-1" />}
            </button>
            <button onClick={onNext} className="text-gray-400 hover:text-white transition-colors">
              <SkipForward className="w-5 h-5" />
            </button>
          </div>
          
          {/* Progress Bar */}
          <div className="w-full flex items-center gap-2 group">
            <input
              type="range"
              min="0"
              max="100"
              value={progress}
              onChange={handleSeek}
              className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-primary group-hover:h-2 transition-all"
            />
          </div>
        </div>

        {/* Extra Controls */}
        <div className="hidden md:flex items-center justify-end w-1/3 gap-3">
          <Volume2 className="w-5 h-5 text-gray-400" />
          <div className="w-24 h-1 bg-gray-700 rounded-lg">
            <div className="w-2/3 h-full bg-gray-300 rounded-lg"></div>
          </div>
        </div>

      </div>
    </motion.div>
  );
};

export default BottomPlayer;
