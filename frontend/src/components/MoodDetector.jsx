import React, { useRef, useState, useEffect } from 'react';
import './MoodPlayer.css'; 

const MoodDetector = () => {
  const videoRef = useRef(null);
  const [isScanning, setIsScanning] = useState(false);

  // THIS IS THE NEW CODE: It asks for webcam access and streams it to the video tag
  useEffect(() => {
    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error("Camera access denied or broken:", err);
      }
    };

    startCamera();

    // Cleanup: Turn off the camera when you leave the page
    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
        videoRef.current.srcObject.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const detectMood = () => {
    setIsScanning(true);
    console.log("Webcam captured! Sending to AI...");
    setTimeout(() => setIsScanning(false), 2500); 
  };

  return (
    <div className="retro-container">
      <div className="noise-overlay"></div>

      <header className="retro-header">
        <h1>MoodTape.</h1>
        <p>Your emotional frequency, captured on tape.</p>
      </header>

      <main className="player-grid">
        <div className="scanner-section">
          <div className="polaroid-frame">
            <div className="video-placeholder">
              {isScanning && <div className="scan-line"></div>}
              {/* The webcam stream attaches here */}
              <video ref={videoRef} autoPlay playsInline muted className="webcam-feed" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
            <div className="polaroid-caption">
              <button onClick={detectMood} className="retro-btn" disabled={isScanning}>
                {isScanning ? 'Processing...' : 'Scan Mood'}
              </button>
            </div>
          </div>
        </div>

        <div className="playlist-section">
          <h2>Current Vibe</h2>
          <div className="cassette-tape">
            <div className="tape-wheels">
              <div className="wheel"></div>
              <div className="wheel"></div>
            </div>
            <div className="tape-label">Golden Hour Mix</div>
          </div>
          
          <ul className="track-list">
             <li><span>1.</span> Sunset Lover - Petit Biscuit</li>
             <li><span>2.</span> Dreams - Fleetwood Mac</li>
             <li><span>3.</span> L$D - A$AP Rocky</li>
          </ul>
        </div>
      </main>
    </div>
  );
};

export default MoodDetector;