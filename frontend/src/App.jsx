import { useState } from 'react';
import MoodDetector from './components/MoodDetector';
import MoodSongs from './components/MoodSongs';

const App = () => {
  const [Songs, setSongs] = useState([
    // {
    //   title: 'test_title',
    //   artist: 'test_artist',
    //   url: 'test_url',
    // },
    // {
    //   title: 'test_title',
    //   artist: 'test_artist',
    //   url: 'test_url',
    // },
    // {
    //   title: 'test_title',
    //   artist: 'test_artist',
    //   url: 'test_url',
    // },
  ]);

  return (
    <>
      <MoodDetector setSongs={setSongs} />
      <MoodSongs Songs={Songs} />
    </>
  );
};

export default App;
