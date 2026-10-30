import { motion as Motion } from 'framer-motion';
import { Play, Pause, Music2, ThumbsUp, ThumbsDown } from 'lucide-react';
import { cn } from '../lib/utils';

const MoodSongs = ({ recommendations = [], currentSong, isPlaying, onPlaySong, onFeedback, feedbackMessage }) => (
  <section id="songs-section" aria-labelledby="recommendations-title" className="mx-auto min-h-[50vh] w-full max-w-6xl scroll-mt-24 px-5 py-16 sm:px-8 md:py-24">
    <Motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mb-8 sm:mb-10">
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-amber-100/75">Made for this moment</p>
      <h2 id="recommendations-title" className="mb-2 text-3xl font-semibold tracking-tight text-white md:text-4xl">Your recommendations</h2>
      <p className="text-sm text-white/55 sm:text-base">A considered mix ranked by your mood, intention, and the music catalog.</p>
      {feedbackMessage && <p role="status" aria-live="polite" className="mt-4 text-sm text-amber-100">{feedbackMessage}</p>}
    </Motion.div>

    {recommendations.length === 0 ? (
      <div className="rounded-3xl border border-white/10 bg-white/[0.035] px-6 py-12 text-center sm:px-10">
        <Music2 aria-hidden="true" className="mx-auto mb-4 h-7 w-7 text-amber-100/70" />
        <p className="font-medium text-white">There are no tracks for this mix yet.</p>
        <p className="mt-2 text-sm text-white/55">Try another mood or come back as the catalog grows.</p>
      </div>
    ) : (
      <Motion.div initial="hidden" animate="show" className="grid grid-cols-1 gap-4 pb-8 sm:grid-cols-2 lg:grid-cols-3">
        {recommendations.map((recommendation, index) => {
          const song = recommendation.song;
          const isThisSongPlaying = currentSong?.audio === song.audio && isPlaying;
          return (
            <Motion.article key={song._id || song.audio || index} whileHover={{ y: -2 }} className={cn('rounded-2xl border bg-[#1a1a18] p-4 transition-colors sm:p-5', isThisSongPlaying ? 'border-amber-100/40' : 'border-white/[0.08] hover:border-white/15')}>
              <button type="button" onClick={() => onPlaySong(song)} disabled={!song.audio} aria-label={`${isThisSongPlaying ? 'Pause' : 'Play'} ${song.title || 'track'}${song.artist ? ` by ${song.artist}` : ''}`} className="group flex min-h-16 w-full items-center gap-4 text-left disabled:cursor-not-allowed disabled:opacity-55">
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-100/20 to-amber-900/20 text-amber-50">
                  {isThisSongPlaying ? <Pause aria-hidden="true" className="h-5 w-5" /> : song.audio ? <Play aria-hidden="true" className="ml-0.5 h-5 w-5" /> : <Music aria-hidden="true" className="h-5 w-5" />}
                </span>
                <span className="min-w-0 flex flex-col">
                  <span className="truncate font-semibold text-white">{song.title || 'Untitled track'}</span>
                  <span className="truncate text-sm text-white/55">{song.artist || 'Unknown artist'}</span>
                </span>
              </button>
              <div className="mt-4 flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/50">
                {song.mood && <span className="capitalize">{song.mood}</span>}
                {song.genre && <><span aria-hidden="true">·</span><span>{song.genre}</span></>}
              </div>
              <p className="mt-3 min-h-10 text-sm leading-5 text-white/65">{recommendation.reason}</p>
              <div className="mt-3 flex gap-2 border-t border-white/[0.08] pt-3">
                <button type="button" onClick={() => onFeedback(song, 'like')} aria-label={`Like ${song.title || 'track'}`} className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm text-white/60 transition hover:bg-white/[0.06] hover:text-amber-100">
                  <ThumbsUp aria-hidden="true" className="h-4 w-4" /> Like
                </button>
                <button type="button" onClick={() => onFeedback(song, 'dislike')} aria-label={`Dislike ${song.title || 'track'}`} className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm text-white/60 transition hover:bg-white/[0.06] hover:text-white">
                  <ThumbsDown aria-hidden="true" className="h-4 w-4" /> Dislike
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
