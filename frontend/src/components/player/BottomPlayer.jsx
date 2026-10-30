import { useEffect, useRef, useState } from 'react';
import { motion as Motion } from 'framer-motion';
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Music2 } from 'lucide-react';
import { formatPlaybackTime } from '../../lib/format-playback-time';

const BottomPlayer = ({ currentSong, isPlaying, setIsPlaying, onNext, onPrev, onEnded }) => {
  const audioRef = useRef(null);
  const playbackAttemptRef = useRef(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.7);
  const [playbackError, setPlaybackError] = useState('');
  const canSeek = Number.isFinite(duration) && duration > 0;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;
    const attempt = ++playbackAttemptRef.current;
    if (isPlaying) {
      audio.play().then(() => {
        if (attempt === playbackAttemptRef.current) setPlaybackError('');
      }).catch(() => {
        if (attempt !== playbackAttemptRef.current) return;
        setPlaybackError('Playback could not start. Check the audio source and try again.');
        setIsPlaying(false);
      });
    } else {
      audio.pause();
    }
    return () => { playbackAttemptRef.current += 1; };
  }, [isPlaying, currentSong, setIsPlaying]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume, currentSong]);

  if (!currentSong) return null;

  const handleSeek = (event) => {
    const time = Number(event.target.value);
    if (!audioRef.current || !canSeek) return;
    audioRef.current.currentTime = time;
    setCurrentTime(time);
  };

  const handlePlay = () => {
    setPlaybackError('');
    setIsPlaying((playing) => !playing);
  };

  const handleError = () => {
    setPlaybackError('This track could not be loaded. Try another recommendation.');
    setIsPlaying(false);
  };

  return (
    <Motion.section
      initial={{ y: 32, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 32, opacity: 0 }}
      transition={{ duration: 0.22 }}
      aria-label="Music player"
      className="fixed inset-x-0 bottom-0 z-50 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6"
    >
      <audio
        key={currentSong.audio}
        ref={audioRef}
        src={currentSong.audio}
        preload="metadata"
        onLoadStart={() => { setCurrentTime(0); setDuration(0); setPlaybackError(''); }}
        onLoadedMetadata={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
        onDurationChange={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onEnded={onEnded}
        onError={handleError}
        className="sr-only"
      />
      <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 rounded-2xl border border-white/10 bg-[#171715]/95 p-3 shadow-[0_-12px_48px_rgba(0,0,0,0.42)] backdrop-blur-xl md:grid-cols-[1fr_1.2fr_1fr] md:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-200/10 text-amber-100">
            <Music2 aria-hidden="true" className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">{currentSong.title || 'Untitled track'}</p>
            <p className="truncate text-xs text-white/55">{currentSong.artist || 'Unknown artist'}</p>
          </div>
        </div>

        <div className="col-span-2 flex min-w-0 flex-col items-center gap-2 md:col-span-1">
          <div className="flex items-center gap-5">
            <button type="button" onClick={onPrev} aria-label="Play previous track" className="player-icon-button">
              <SkipBack aria-hidden="true" className="h-4 w-4" />
            </button>
            <button type="button" onClick={handlePlay} aria-label={isPlaying ? 'Pause' : 'Play'} className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-[#171715] transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-100">
              {isPlaying ? <Pause aria-hidden="true" className="h-4 w-4 fill-current" /> : <Play aria-hidden="true" className="ml-0.5 h-4 w-4 fill-current" />}
            </button>
            <button type="button" onClick={onNext} aria-label="Play next track" className="player-icon-button">
              <SkipForward aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
          <div className="flex w-full items-center gap-2 text-[10px] tabular-nums text-white/50">
            <span aria-hidden="true">{formatPlaybackTime(currentTime)}</span>
            <input
              type="range"
              min="0"
              max={canSeek ? duration : 1}
              step="0.1"
              value={canSeek ? Math.min(currentTime, duration) : 0}
              onChange={handleSeek}
              disabled={!canSeek}
              aria-label="Seek track"
              aria-valuetext={`${formatPlaybackTime(currentTime)} of ${formatPlaybackTime(duration)}`}
              className="h-2 min-w-0 flex-1 cursor-pointer accent-amber-100 disabled:cursor-not-allowed disabled:opacity-40"
            />
            <span aria-hidden="true">{formatPlaybackTime(duration)}</span>
          </div>
        </div>

        <div className="hidden items-center justify-end gap-2 md:flex">
          <label htmlFor="player-volume" className="text-white/60">
            {volume === 0 ? <VolumeX aria-hidden="true" className="h-4 w-4" /> : <Volume2 aria-hidden="true" className="h-4 w-4" />}
            <span className="sr-only">Volume</span>
          </label>
          <input id="player-volume" type="range" min="0" max="1" step="0.01" value={volume} onChange={(event) => setVolume(Number(event.target.value))} aria-label="Volume" className="h-2 w-24 cursor-pointer accent-amber-100" />
        </div>
        {playbackError && <p role="alert" className="col-span-2 text-xs text-amber-100 md:col-span-3">{playbackError}</p>}
      </div>
    </Motion.section>
  );
};

export default BottomPlayer;
