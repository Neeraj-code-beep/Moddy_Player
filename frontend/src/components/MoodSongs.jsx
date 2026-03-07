import { useState } from 'react';

const MoodSongs = () => {
  const [Songs, setSongs] = useState([
    {
      title: 'test_title',
      artist: 'test_artist',
      url: 'test_url',
    },
    {
      title: 'test_title',
      artist: 'test_artist',
      url: 'test_url',
    },
    {
      title: 'test_title',
      artist: 'test_artist',
      url: 'test_url',
    },
  ]);

  return (
    <div className="mood-songs p-5 w-full pt-0 text-amber-200 font-mono text-lg">
      <h2 className="mb-4">Recommended Songs</h2>
      {Songs.map((song, index) => (
        <div className="flex w-full justify-between mx-0 my-1.5" key={index}>
          <div className="title">
            <h3>{song.title}</h3>
            <p>{song.artist}</p>
          </div>
          <div className="play-pause-button">
            <i className="ri-play-circle-fill"></i>
            <i className="ri-pause-line"></i>
          </div>
        </div>
      ))}
    </div>
  );
};

export default MoodSongs;
