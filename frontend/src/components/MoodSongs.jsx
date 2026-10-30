import React from 'react';
import { motion as Motion } from 'framer-motion';
import { Play, Pause, Music, ThumbsUp, ThumbsDown } from 'lucide-react';
import { cn } from '../lib/utils';

const MoodSongs = ({ recommendations = [], currentSong, isPlaying, onPlaySong, onFeedback, feedbackMessage }) => (
  <section id="songs-section" className="w-full max-w-6xl mx-auto py-20 px-6 min-h-[50vh]">
    <Motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-10">
      <h2 className="text-3xl md:text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400 mb-2">Your recommendations</h2>
      <p className="text-gray-400">Ranked using mood, intention, and available song metadata.</p>
      {feedbackMessage && <p role="status" className="mt-3 text-sm text-secondary">{feedbackMessage}</p>}
    </Motion.div>

    {recommendations.length === 0 ? (
      <p className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center text-gray-300">No songs are available for this request yet. Add tracks to the catalog and try again.</p>
    ) : (
      <Motion.div initial="hidden" animate="show" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 pb-28">
        {recommendations.map((recommendation, index) => {
          const song = recommendation.song;
          const isThisSongPlaying = currentSong?.audio === song.audio && isPlaying;
          return (
            <Motion.article key={song._id || song.audio || index} whileHover={{ y: -3 }} className={cn('glass-panel rounded-2xl p-5 border border-white/10', isThisSongPlaying && 'border-primary/50')}>
              <button type="button" onClick={() => onPlaySong(song)} className="w-full flex items-center gap-4 text-left">
                <span className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0 bg-gradient-to-br from-primary/40 to-accent/40">
                  {isThisSongPlaying ? <Pause className="w-6 h-6 text-white" /> : song.audio ? <Play className="w-6 h-6 text-white" /> : <Music className="w-6 h-6 text-white" />}
                </span>
                <span className="min-w-0 flex flex-col">
                  <span className="font-bold text-white truncate">{song.title || 'Untitled track'}</span>
                  <span className="text-sm text-gray-400 truncate">{song.artist || 'Unknown artist'}</span>
                </span>
              </button>
              <p className="mt-4 text-sm text-gray-300">{recommendation.reason}</p>
              <div className="mt-4 flex gap-3">
                <button type="button" onClick={() => onFeedback(song, 'like')} aria-label={`Like ${song.title || 'track'}`} className="flex items-center gap-2 text-sm text-gray-400 hover:text-secondary">
                  <ThumbsUp className="w-4 h-4" /> Like
                </button>
                <button type="button" onClick={() => onFeedback(song, 'dislike')} aria-label={`Dislike ${song.title || 'track'}`} className="flex items-center gap-2 text-sm text-gray-400 hover:text-red-300">
                  <ThumbsDown className="w-4 h-4" /> Dislike
                </button>
              </div>
            </Motion.article>
          );
        })}
      </Motion.div>
    )}
  </section>
);

export default MoodSongs;