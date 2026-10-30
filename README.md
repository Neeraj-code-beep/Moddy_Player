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

## Mood Recommendations and Listening Feedback

`POST /recommendations` accepts JSON with an optional `mood`, an `intention` (defaults to `match` for compatibility), and an optional `limit` from 1 to 50 (default 12). Supported normalized moods are `angry`, `disgusted`, `fearful`, `happy`, `neutral`, `sad`, and `surprised`. Common legacy spellings such as `fear`, `anger`, and `happiness` are normalized. An unrecognized mood is treated as unspecified and the selected intention still returns a useful catalog ranking.

Available intentions:

- `match` favors an exact mood match, then nearby valence, then other available tracks.
- `cheer_up` favors more positive mood labels and higher energy; a requested mood provides additional credit to more positive transitions.
- `calm_down` favors low energy, then medium energy, neutral mood, and calm descriptive tags. High energy is inferred only for ranking when no explicit energy is stored.
- `surprise` favors tracks outside the requested mood and keeps a familiar mood in the mix when useful.

Ranking is deterministic and uses these weights:

- Mood valence is ordered `sad` (0), `angry`/`disgusted`/`fearful` (1), `neutral` (2), `surprised` (3), and `happy` (4). `match` adds 100 for an exact mood, 25 for a one-step valence neighbor, 5 for an unrecognized catalog mood, or 20 for an open mood choice.
- `cheer_up` adds 15 times candidate valence, 20 for high or 10 for medium energy, 15 when the candidate is more positive than the requested mood, and 5 for `uplifting` or `energetic` tags.
- `calm_down` adds 45 for low or 20 for medium energy, 20 for neutral mood, 15 for moving below a high-energy selected mood, and 5 for `calm`, `relaxing`, or `ambient` tags; it subtracts 10 for angry or fearful mood.
- `surprise` adds 60 for a different recognized mood, 25 when the mood is absent or unrecognized, and 5 for a familiar mood.
- During selection, each already chosen track from the same artist costs 15 points and each already chosen track from the same genre costs 5 points. Ties use newest creation time and then song ID.

Candidates are fetched by most recent catalog order with a hard cap of 500. Mood-derived energy estimates are temporary ranking hints; the server does not write inferred values to existing records. Stored energy is optional (`low`, `medium`, or `high`); uploads can also provide optional `genre` and up to five comma-separated descriptive `tags`. Existing records need no migration. Recommendations include each existing song object, an explainable `reason`, and the server-generated score.

Example request:

```json
{ "mood": "sad", "intention": "cheer_up", "limit": 12 }
```

Example response:

```json
{
  "message": "Recommendations generated successfully",
  "recommendations": [
    {
      "song": { "_id": "...", "title": "Example", "artist": "Artist", "mood": "happy", "audio": "https://example.invalid/audio.mp3" },
      "score": 95,
      "reason": "has an uplifting mood tag; has a high energy profile; moves toward a more uplifting mood"
    }
  ],
  "requestedMood": "sad",
  "normalizedMood": "sad",
  "intention": "cheer_up"
}
```

Camera use is opt-in. Users can manually choose one of the supported moods or request an intention with no mood selected. No face image is uploaded or stored.

`POST /feedback` records `{ "sessionId": "<version-4 UUID>", "songId": "<MongoDB song ID>", "event": "like|dislike|skip|completed", "intention": "match|cheer_up|calm_down|surprise" }`. Like and dislike are explicit button actions, skip is recorded when the listener advances tracks, and completed is recorded only when the audio element reaches its end. Feedback is stored separately from songs, checked against an atomic 500-event per-session quota, and expires after 90 days. The quota uses a separate session counter with a unique index and rolling expiry. MongoDB startup creates this quota index before the API accepts traffic. A reserved slot remains consumed if feedback persistence returns an error, since the write outcome can be ambiguous; this can reduce that session's remaining quota until expiry. Callers can create new session UUIDs, so this is not authentication or a complete abuse defense. The session ID is not used to personalize rankings. Events are client-reported signals and are not proof of a real-world preference. This is collection plumbing, not cross-session personalization or a mature feedback model.

## API abuse controls and deployment

The API is public and has no account authentication. Per-IP fixed-window limits are enabled by default: uploads allow 3 requests, feedback 30, recommendations 60, and catalog reads 120 per 60 seconds. Configure `RATE_LIMIT_WINDOW_MS` (1,000–3,600,000 ms) and `RATE_LIMIT_UPLOAD_MAX`, `RATE_LIMIT_FEEDBACK_MAX`, `RATE_LIMIT_RECOMMENDATION_MAX`, and `RATE_LIMIT_CATALOG_MAX` (positive integers) in the backend environment. Blocked requests receive the usual `{ "error": { "code", "message" } }` shape with status 429 and `RateLimit-*` / `Retry-After` headers. The in-memory store is bounded to 20,000 active keys and is suitable only for one Node.js process. When the store fills or fails, limited endpoints fail closed with 503. For multiple instances, supply a shared store implementing `async consume(key, windowMs) -> { count, resetAt }` to `createApp({ rateLimitStore })`, then pass that app to the exported `startServer({ app })`. The shared adapter must atomically increment the same fixed-window key across instances and use a TTL; this repository does not include a Redis adapter or Redis dependency.

By default Express does not trust forwarded IP headers. Set `TRUSTED_PROXY_HOPS` to an integer from 1 to 10 only when the service is reachable exclusively through a known proxy chain that overwrites forwarded headers; set it to the exact number of trusted hops. Keep it at `0` for direct access. Incorrect proxy topology can let callers spoof the IP used by rate limits. These limits and the one-upload-at-a-time process cap reduce accidental or simple repeated abuse; they do not provide identity, bot resistance, or per-user quotas. Public uploads can still incur provider costs, and session UUIDs can be changed to bypass session-based feedback caps. Production deployments should also use edge-level abuse controls and operational quotas appropriate to their hosting provider.

Uploads remain limited to 25 MiB by default (`MAX_UPLOAD_SIZE_BYTES`, range 1 byte–100 MiB), one active upload per app process, one audio file, six metadata fields, bounded field lengths, and the existing MIME/extension/signature checks. The remote upload is stored under a generated UUID filename; the original filename is not used as a remote path. `IMAGEKIT_UPLOAD_RESPONSE_TIMEOUT_MS` defaults to 30,000 ms and accepts 1,000–120,000 ms. It bounds how long the API waits before returning 504; the installed ImageKit SDK does not expose a transport timeout or cancellation option, so it does not cancel the provider request. The upload slot stays occupied until that upload request settles; a late successful asset is deleted best-effort after the upload settles. A provider request that never settles can therefore still occupy the slot indefinitely; do not forcibly release it while the network request might remain active. Configure outbound network timeouts at the hosting layer and monitor long-running uploads. A failure to save the song triggers best-effort provider cleanup, but cleanup failures may leave an orphaned remote file.

`GET /live` reports process liveness without consulting MongoDB; `GET /health` remains readiness and returns 503 when MongoDB is not ready. The backend sets `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and `X-Permitted-Cross-Domain-Policies`. CORS only echoes origins in the configured allowlist; set `CORS_ALLOWED_ORIGINS` to comma-separated production frontend origins (scheme and host included), and do not rely on CORS as protection for non-browser clients. Song schemas declare catalog indexes; feedback schemas declare session/song indexes and a 90-day TTL index. Startup explicitly creates the feedback-quota unique session index and rolling TTL index before listening, so the MongoDB runtime role must have permission to create those indexes. Allow for TTL deletion to run asynchronously.

The default test suite uses mocked database and storage behavior. Set `MONGODB_INTEGRATION_URL` only to a dedicated disposable non-production MongoDB URI targeting `moddy_player_integration_test` to enable `backend/test/mongodb.integration.test.js`; a strict guard rejects any other database, and cleanup drops only this exact database. Its upload provider is mocked, so it does not verify ImageKit. No shared Redis-compatible adapter is included; the injected-store test uses a deterministic local fake and does not verify an actual distributed store. Production proxy topology and live ImageKit behavior require separate deployment-level verification.

Environment defaults and ranges are listed in [`backend/.env.example`](backend/.env.example). Start the local backend with `npm start` from `backend/` after setting valid MongoDB and ImageKit credentials in an ignored local `.env` file. Set `CORS_ALLOWED_ORIGINS` to the frontend's exact deployed origin(s) in production.

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
