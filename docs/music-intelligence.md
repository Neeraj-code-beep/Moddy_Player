# Music Intelligence

## Current architecture

Music Intelligence runs outside upload requests. The Express API saves a song first, then creates or reuses one MongoDB-backed `SongAnalysisJob` for that song. A separate worker process claims due jobs with an atomic `findOneAndUpdate` lease. MongoDB's unique `songId` index prevents duplicate jobs. Expired leases are reclaimed; attempts are bounded and transient failures use exponential backoff with jitter.

Run the API and worker as separate processes from `backend/`:

```powershell
npm start
npm run worker:music-ai
```

The worker requires a reachable MongoDB database and configured Gemini key. Do not start it in deployments that have not enabled provider processing. MongoDB startup creates the Song, Feedback, and analysis-job indexes before serving the API.

## Audio method and limits

The backend fetches the stored asset using a short-lived ImageKit delivery URL. It validates the URL against the configured ImageKit HTTPS origin, rejects redirects, enforces the 25 MiB analysis limit, and does not log the URL. The supported uploaded types passed to Gemini are MP3, WAV, FLAC, OGG, Opus, M4A/MP4 audio, AAC, and WebM audio.

The server uploads the bytes through Gemini's Files API, requests structured JSON through `generateContent`, validates the response against controlled values, then attempts to delete the temporary Gemini file in a `finally` block. Gemini documents automatic deletion after 48 hours; cleanup is attempted immediately, but this code does not assert that provider-side deletion succeeded. Only semantic suggestions are requested: mood, genre, energy, contexts, instrumentation, vocal type, optional language, and tags. It does not claim to measure BPM, key, danceability, acousticness, duration, embeddings, or exact emotion. Language is omitted when the model reports uncertainty. No confidence score is stored because this provider path has no calibrated confidence measure.

Google describes Gemini audio understanding for supported audio MIME types and structured outputs in its [audio guide](https://ai.google.dev/gemini-api/docs/audio), [Files API guide](https://ai.google.dev/gemini-api/docs/files), and [structured output guide](https://ai.google.dev/gemini-api/docs/structured-output). The provider boundary is isolated in `gemini-music-provider.service.js` so a future provider or a dedicated feature-extraction service can be added without placing provider calls in route handlers.

Uploading audio for analysis sends that audio to Google when the provider is enabled. The UI discloses this in the upload screens. Private audio is retrieved by the backend; its signed ImageKit URL is never sent as model content or written to logs.

## Jobs, retries, and recovery

Job states are `queued`, `processing`, `completed`, and `failed`. Attempt count, bounded maximum, next eligible time, worker lease, safe failure code, provider, model, and result state are persisted. HTTP upload returns without waiting for analysis; a provider, network, validation, or queue failure does not roll back the saved song. Terminal diagnostic codes are safe identifiers and do not contain provider response text.

Automatic retries apply only to classified transient errors such as network/timeout, HTTP 429, and provider 5xx responses. Invalid model output and unsupported audio are permanent failures until an administrator corrects the cause or the owner changes the file. Owners can retry their own failed private-song jobs. Administrators can inspect paginated jobs and retry eligible failed jobs. The configured lease must outlive the provider timeout and asset-fetch window so another worker does not normally take over an in-flight request.

The job record is one-per-song and reused on retry. A worker writes suggestions only when the song's `metadataRevision` still matches the revision captured by the job. A newer owner/admin edit marks the result stale rather than applying it. Manual/accepted/rejected per-field suggestion decisions are retained during subsequent analysis.

## Metadata and human review

The Song stores uploaded/canonical metadata separately from `aiSuggestions`. AI suggestions have a provider/model, generation time, status, and field-level review status and source. Their source is `ai`; they never become canonical recommendation metadata automatically. Owners may review their private songs. Administrators may review public catalog suggestions. Accepting a suggestion copies that value into canonical song metadata and records the reviewer as the canonical field source (`user` or `admin`); rejecting it leaves canonical metadata unchanged.

Processing updates `aiSuggestions` only. It cannot publish a pending catalog song or change its moderation state. Existing user and admin canonical metadata is never overwritten by a later analysis.

## API contracts

All endpoints are under the existing `/library` router:

- `GET /library/songs/:id/analysis` and `POST /library/songs/:id/analysis/retry` are owner-only for private uploads.
- `PATCH /library/songs/:id/metadata-review` accepts `{ "fields": { "mood": "accepted", "genre": "rejected" } }` with per-field decisions.
- `GET /library/admin/analysis/jobs?status=&page=&limit=` is admin-only and paginated.
- `POST /library/admin/analysis/jobs/:id/retry` is admin-only and retries failed jobs.
- `GET /library/admin/songs/:id/analysis` and `PATCH /library/admin/songs/:id/metadata-review` are admin-only.

Analysis responses exclude audio URLs, storage IDs, owner IDs, credentials, and raw provider messages. Retry endpoints have the dedicated `RATE_LIMIT_ANALYSIS_MAX` request limit. The existing recommendation endpoint keeps its public catalog visibility filter and deterministic scoring. For authenticated listeners it additionally scores canonical, human-reviewed metadata using favorites and up to the latest 100 account-linked feedback events. Feedback remains subject to the existing 90-day TTL. There is no separate listening-history model and no embedding or semantic search.

## Configuration and deployment

Optional settings are documented in `backend/.env.example`:

- `MUSIC_AI_PROVIDER` (currently `gemini`)
- `GEMINI_API_KEY` (server secret)
- `GEMINI_MODEL` (defaults to `gemini-3.8-flash`)
- `GEMINI_API_BASE_URL` (HTTPS endpoint only)
- `MUSIC_AI_TIMEOUT_MS`, `MUSIC_AI_MAX_ATTEMPTS`, `MUSIC_AI_WORKER_CONCURRENCY`, `MUSIC_AI_JOB_LEASE_MS`, and `MUSIC_AI_RETRY_BASE_MS`
- `RATE_LIMIT_ANALYSIS_MAX`

Deployment requires a separate long-running worker process, MongoDB access from both API and worker, and outbound HTTPS access to ImageKit and Google Generative Language APIs. Keep the Gemini key in a secret manager or server-only environment. Worker concurrency should be tuned for provider rate limits and MongoDB capacity. Run API and worker shutdown under the process supervisor so jobs left in a processing lease are recovered after restart.

## Verification and limitations

Provider, worker, API authorization, and browser tests use mocked provider responses and in-memory models. No live Gemini call, real audio-quality assessment, live MongoDB queue recovery, or ImageKit-to-Gemini transfer has been executed in this phase. Run a separately approved end-to-end test using a dedicated test database and a disposable audio asset before enabling provider processing for real users. The provider's semantic classifications require human review and may be incorrect; the system does not claim measured acoustic features.

The excluded RAG, vector retrieval, MCP, semantic embeddings, and conversational copilot work are not part of this implementation.
