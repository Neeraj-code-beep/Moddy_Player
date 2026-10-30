# Moddy Player frontend

The frontend is a React 19 and Vite application styled with Tailwind CSS 4. It currently provides a mood and listening-intention recommendation flow, optional on-device camera mood estimation, feedback actions, and a persistent audio player. There is no router or account system yet.

## Structure

- `src/App.jsx` coordinates recommendation requests, playback selection, and feedback.
- `src/components/layout/Navbar.jsx` contains the responsive Home and Discover navigation.
- `src/components/sections/Hero.jsx` introduces the current discovery experience.
- `src/components/MoodDetector.jsx` handles manual mood/intention selection and opt-in camera estimation.
- `src/components/MoodSongs.jsx` renders recommendation cards and feedback controls.
- `src/components/player/BottomPlayer.jsx` owns audio playback controls and progress.
- `src/api/` contains the backend client and request-contract helpers.
- `src/index.css` defines the neutral and warm accent palette, global focus treatment, and reduced-motion behavior.

## Local development

Run `npm install` once, then use `npm run dev` from this directory. The app expects the backend at `http://localhost:3000/songs` by default. To use another backend, set `VITE_API_BASE_URL` in `frontend/.env` to the full songs endpoint, such as `http://localhost:4000/songs`. Vite environment values are public in the browser bundle; do not put secrets in this file.

## Checks

- `npm test` runs the frontend contract and helper tests.
- `npm run lint` runs ESLint.
- `npm run build` creates the production bundle in `dist/`.

## Interaction and accessibility conventions

- Use semantic headings, links, buttons, and labeled controls. Keep interactive targets comfortable for touch and keyboard use.
- Preserve visible `:focus-visible` states and respect the user's reduced-motion setting through `MotionConfig` and CSS.
- Camera capture starts only after the user opts in. Face-expression estimation runs in the browser; no camera image is sent to the backend.
- Keep feedback requests on the existing `/feedback` contract and recommendation requests on `/recommendations`.
- Keep mobile layouts intentional: stack player details and controls, account for device safe areas, and avoid relying on hover.

## Current limitations

- Login, library, playlists, and persistent user history are not implemented; the interface should not advertise these as available destinations.
- Playback requires valid audio URLs in the existing catalog. There is no waveform, queue editing, or server-side playback state.
- Camera results are a best-effort expression estimate, not a definitive reading of a listener's emotional state.
- Framer Motion is part of the initial bundle. The face-api.js detector is loaded only when the user enables camera detection; its production chunk is still sizable. Camera model files are served from `public/models/` and should be kept local to the app origin.
