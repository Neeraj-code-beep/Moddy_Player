# 🎧 Moddy Player

![React](https://img.shields.io/badge/Frontend-React-blue)
![Node](https://img.shields.io/badge/Backend-Node.js-green)
![Express](https://img.shields.io/badge/Framework-Express-black)
![MongoDB](https://img.shields.io/badge/Database-MongoDB-darkgreen)
![Tailwind](https://img.shields.io/badge/UI-TailwindCSS-38B2AC)
![FaceAPI](https://img.shields.io/badge/AI-face--api.js-orange)
![Storage](https://img.shields.io/badge/Storage-ImageKit-purple)

Moddy Player is an experimental **AI-powered mood-based music recommendation web application**.

The app detects a user's **facial expression through their webcam**, determines their **current mood**, and suggests songs accordingly.

This project mainly focuses on **core functionality and system architecture**, combining **Computer Vision, AI concepts, and Web Development**.

---

# 🚀 Project Overview

The goal of **Moddy Player** is to explore how **facial emotion recognition** can be used to recommend music dynamically.

Instead of asking users what they want to listen to, the system analyzes their **facial expressions and automatically suggests songs**.

---

# 🧠 How It Works

1. User opens the application  
2. Webcam captures the user's face  
3. **face-api.js** detects facial expressions  
4. The system predicts the user's **mood**  
5. Mood is sent to the **Node.js backend**  
6. Backend fetches songs from **MongoDB**  
7. Songs are displayed to the user  

---

# 🛠 Tech Stack

## Frontend
- React
- TailwindCSS
- face-api.js
- Vite

## Backend
- Node.js
- Express.js

## Database
- MongoDB

## Storage
- ImageKit (for storing songs)

---

# 📂 Project Structure

```
moddy-player
│
├── server.js                 # Express backend server
│
├── frontend
│   ├── public
│   │
│   ├── src
│   │   ├── api
│   │   │   └── api.js        # API requests
│   │   │
│   │   ├── components
│   │   │   ├── MoodDetector.jsx   # Detects user mood
│   │   │   └── MoodSongs.jsx      # Displays recommended songs
│   │   │
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── index.css
│   │
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   └── eslint.config.js
│
├── .gitignore
├── README.md
└── Notes.md
```

---

# 🎯 Current Features

- Face detection using webcam
- Mood detection using facial expressions
- Song recommendation based on mood
- Song storage using ImageKit
- MongoDB for storing song metadata
- React frontend with TailwindCSS

---

# ⚠️ Current Limitations

- UI is very basic
- Songs are manually uploaded
- No authentication system yet
- Limited dataset of songs

This project mainly focuses on **learning and experimenting with AI + Web Development**.

---

# 🔮 Future Plans

Planned improvements include:

- Using **Gemini AI** to automatically classify songs by genre and mood
- Automatic mood tagging of songs
- Spotify API integration
- Mood analytics and listening history
- Improved UI/UX
- Personalized recommendations

---

# ⚙️ Running the Project Locally

## 1. Fork the Repository

Click the **Fork** button on the top-right of the GitHub repository.

---

## 2. Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/moddy-player.git
```

---

## 3. Navigate to the Project

```bash
cd moddy-player
```

---

# 🔧 Backend Setup

From the repository root, install dependencies and start the backend:

```bash
cd backend
npm install
npm start
```

The backend listens on port `3000` by default. Set `PORT` to change it. Startup waits for MongoDB and exits with a safe error if the database is unavailable. MongoDB server selection times out after 10 seconds by default.

When MongoDB is connected, the readiness endpoint is:

```
http://localhost:3000/health
```

It returns `200 { "status": "ready" }` when MongoDB is connected and `503 { "status": "not_ready" }` otherwise.

The upload route is currently public and has no authentication or per-user rate limiting. Only one upload is processed at a time per backend process to limit simultaneous in-memory buffering; this does not prevent repeated uploads. Restrict upload access at the deployment boundary before exposing it to untrusted clients. Browser CORS allows the local Vite origins by default; set `CORS_ALLOWED_ORIGINS` to a comma-separated list of exact frontend origins for deployment. CORS does not authenticate non-browser clients.

---

# 🎨 Frontend Setup

Open a new terminal and run:

```bash
cd frontend
npm install
npm run dev
```

Frontend will run at:

```
http://localhost:5173
```

---

# 🔑 Environment Variables

Create `backend/.env` with the following settings:

```
MONGODB_URL=your_mongodb_connection_string
MONGODB_CONNECT_TIMEOUT_MS=10000
PORT=3000
MAX_UPLOAD_SIZE_BYTES=26214400

IMAGEKIT_PUBLIC_KEY=your_public_key
IMAGEKIT_PRIVATE_KEY=your_private_key
IMAGEKIT_URL_ENDPOINT=your_url_endpoint
```

`MONGODB_URL` is required to start the backend. `IMAGEKIT_PUBLIC_KEY`, `IMAGEKIT_PRIVATE_KEY`, and `IMAGEKIT_URL_ENDPOINT` are required for uploads. Keep real values out of source control. `MAX_UPLOAD_SIZE_BYTES` defaults to 25 MiB (`26214400`) and can be set from 1 byte through 100 MiB. `MONGODB_CONNECT_TIMEOUT_MS` defaults to 10000 and accepts values from 1 through 120000.

`CORS_ALLOWED_ORIGINS` is optional for local development, where the backend allows `http://localhost:5173` and `http://127.0.0.1:5173`. Set it to exact comma-separated origins in deployment, for example `https://player.example.com`.

The frontend defaults to `http://localhost:3000/songs`. If the backend port or host changes, set `VITE_API_BASE_URL` in `frontend/.env` to the full song endpoint URL, for example `http://localhost:4000/songs`.

## Song API

`POST /songs` accepts `multipart/form-data` with one `audio` file and the required text fields `title`, `artist`, and `mood`. Text is trimmed; maximum lengths are 120, 120, and 40 characters. Supported common formats are MP3, WAV, FLAC, OGG/Opus, M4A/MP4 audio, AAC, and WebM audio. The server checks the declared MIME type, extension, and a format signature; these checks do not scan for malware. Files are uploaded to ImageKit with a unique generated filename. The API returns the stored song metadata and does not return the raw ImageKit upload response.

Uploaded files are delivered using the ImageKit URL returned by its upload API. This application does not configure signed or private delivery URLs, so treat catalog audio URLs as public.

The server checks declared MIME type, extension, and container signatures only. It does not fully decode media or verify that containers such as MP4/WebM contain an audio track.

Successful upload response (201):

```json
{
  "message": "Song created successfully",
  "song": {
    "title": "Example",
    "artist": "Artist",
    "mood": "happy",
    "audio": "https://example.invalid/audio.mp3"
  }
}
```

`GET /songs` accepts optional `mood`, `page`, and `limit` query parameters. Missing or empty `mood` returns all songs. `page` defaults to 1 and must be from 1 through 1000000; `limit` defaults to 50 and must be from 1 through 100. The frontend requests all matching pages, up to 100 pages of 100 songs (10,000 songs); it reports an error for larger or inconsistent catalogs instead of looping indefinitely or displaying a partial list.

Example: `GET /songs?mood=happy&page=1&limit=50`

```json
{
  "message": "Songs fetched successfully",
  "songs": [],
  "pagination": { "page": 1, "limit": 50, "total": 0, "totalPages": 0 }
}
```

Errors use a consistent shape, for example `400`, `413`, or `415`:

```json
{ "error": { "code": "INVALID_METADATA", "message": "title is required." } }
```

Run backend unit/API tests from `backend/` with `npm test`, and frontend pagination tests from `frontend/` with `npm test`. Backend tests use mocked storage and database behavior; they do not require MongoDB or ImageKit credentials. A real backend startup and upload still require a reachable MongoDB database and valid ImageKit configuration.

---

# 🤝 Contributing

Contributions are welcome.

Steps to contribute:

1. Fork the repository

2. Create a new branch

```
git checkout -b feature-name
```

3. Commit your changes

```
git commit -m "Added new feature"
```

4. Push your branch

```
git push origin feature-name
```

5. Open a Pull Request

---

## 💖 Contributors

Thanks to all the amazing people who contribute to **Moddy_Player** 🚀

<p align="center">
  <a href="https://github.com/Neeraj-code-beep/Moddy_Player/graphs/contributors">
    <img src="https://contrib.rocks/image?repo=Neeraj-code-beep/Moddy_Player" alt="Contributors"/>
  </a>
</p>

---

## ⭐ Project Support

<p align="center">
  <a href="https://github.com/Neeraj-code-beep/Moddy_Player/stargazers">
    <img src="https://img.shields.io/github/stars/Neeraj-code-beep/Moddy_Player?style=social" alt="Stars">
  </a>
  &nbsp;&nbsp;
  <a href="https://github.com/Neeraj-code-beep/Moddy_Player/network/members">
    <img src="https://img.shields.io/github/forks/Neeraj-code-beep/Moddy_Player?style=social" alt="Forks">
  </a>
</p>

---

# 👨‍💻 Author

Neeraj Mishra

This project was built to experiment with:

- AI + Computer Vision
- Emotion Detection
- Music Recommendation Systems
- Full Stack Development

---

# ⭐ Support

If you like this project, consider giving it a **star on GitHub**.
