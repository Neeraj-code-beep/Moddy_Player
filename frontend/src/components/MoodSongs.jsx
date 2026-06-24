import React from 'react';
import { motion } from 'framer-motion';
import { Play, Pause, Music } from 'lucide-react';
import { cn } from '../lib/utils';

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1
    }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 24 } }
};

const MoodSongs = ({ Songs, currentSong, isPlaying, onPlaySong }) => {
  if (!Songs || Songs.length === 0) return null;

  return (
    <section id="songs-section" className="w-full max-w-6xl mx-auto py-24 px-6 min-h-screen">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        className="mb-12"
      >
        <h2 className="text-3xl md:text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400 mb-2">
          Recommended Tracks
        </h2>
        <p className="text-gray-400">Curated based on your current vibe</p>
      </motion.div>

      <motion.div
        variants={containerVariants}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-100px" }}
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-32"
      >
        {Songs.map((song, index) => {
          const isThisSongPlaying = currentSong?.audio === song.audio && isPlaying;
          
          return (
            <motion.div
              key={index}
              variants={itemVariants}
              whileHover={{ y: -5, scale: 1.02 }}
              className={cn(
                "group relative glass-panel rounded-2xl p-4 flex items-center gap-4 cursor-pointer transition-all duration-300",
                isThisSongPlaying ? "border-primary/50 shadow-[0_0_30px_rgba(79,70,229,0.15)]" : "hover:border-white/20"
              )}
              onClick={() => onPlaySong(song, index)}
            >
              {/* Fake Album Art Container (Backend doesn't provide images, using beautiful gradient) */}
              <div className="relative w-16 h-16 rounded-xl overflow-hidden shrink-0 shadow-lg bg-gradient-to-br from-gray-800 to-gray-900">
                <div className="absolute inset-0 bg-gradient-to-tr from-primary/40 to-accent/40 mix-blend-overlay"></div>
                <div className="absolute inset-0 flex items-center justify-center">
                  {isThisSongPlaying ? (
                    <div className="flex gap-1 items-end h-6">
                      <motion.div animate={{ height: [8, 24, 8] }} transition={{ repeat: Infinity, duration: 1 }} className="w-1.5 bg-white rounded-t-sm" />
                      <motion.div animate={{ height: [16, 8, 16] }} transition={{ repeat: Infinity, duration: 0.8 }} className="w-1.5 bg-white rounded-t-sm" />
                      <motion.div animate={{ height: [12, 20, 12] }} transition={{ repeat: Infinity, duration: 1.2 }} className="w-1.5 bg-white rounded-t-sm" />
                    </div>
                  ) : (
                    <Music className="w-6 h-6 text-white/50 group-hover:text-white transition-colors" />
                  )}
                </div>

                {/* Hover Play Button Overlay */}
                <div className={cn(
                  "absolute inset-0 bg-black/40 backdrop-blur-[2px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity",
                  isThisSongPlaying && "opacity-100 bg-transparent backdrop-blur-none"
                )}>
                  {isThisSongPlaying ? (
                    <Pause className="w-6 h-6 text-white drop-shadow-md hidden group-hover:block" />
                  ) : (
                    <Play className="w-6 h-6 text-white ml-1 drop-shadow-md" />
                  )}
                </div>
              </div>

              {/* Song Info */}
              <div className="flex flex-col flex-grow overflow-hidden">
                <h3 className={cn(
                  "font-bold truncate text-lg transition-colors",
                  isThisSongPlaying ? "text-primary" : "text-white group-hover:text-gray-200"
                )}>
                  {song.title}
                </h3>
                <p className="text-gray-400 text-sm truncate group-hover:text-gray-300 transition-colors">
                  {song.artist}
                </p>
              </div>

              {/* Index Number */}
              <div className="w-8 flex justify-end text-gray-500 font-mono text-sm opacity-50 group-hover:opacity-100 transition-opacity">
                {String(index + 1).padStart(2, '0')}
              </div>
            </motion.div>
          );
        })}
      </motion.div>
    </section>
  );
};

export default MoodSongs;
