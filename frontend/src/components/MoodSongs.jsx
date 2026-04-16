// import { useState } from 'react';

import { useState } from 'react';

const MoodSongs = ({ Songs }) => {
  const [isPlaying, setIsPlaying] = useState(null);

  const handlePlayPause = (index) => {
    if (isPlaying === index) {
      setIsPlaying(null);
    } else {
      setIsPlaying(index);
    }
  };
  return (
    <div className="flex justify-center flex-col items-center mood-songs p-5 w-full pt-0 text-amber-200 font-mono text-lg">
      <h2 className="mb-4 text-3xl">Recommended Songs</h2>
      {Songs.map((song, index) => (
        <div className="flex w-full justify-center mx-0 my-1.5" key={index}>
          <div className="title">
            <h3>{song.title}</h3>
            <p>{song.artist}</p>
          </div>
          <div className="play-pause-button">
            {isPlaying === index && (
              <audio
                src={song.audio}
                className="hidden"
                autoPlay={isPlaying === index}
              ></audio>
            )}
            <button onClick={() => handlePlayPause(index)}>
              {isPlaying === index ? (
                <i className="ri-pause-line"></i>
              ) : (
                <i className="ri-play-circle-fill"></i>
              )}
              ;
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

export default MoodSongs;
