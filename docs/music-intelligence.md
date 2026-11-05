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

The configured default model is `gemini-3.8-flash`. The backend currently uploads bytes through Gemini's Files API and requests structured JSON through `generateContent`. Google now labels `generateContent` legacy but says it remains supported; the Interactions API is recommended for new projects. A future provider migration should be verified before changing this adapter. The response is validated against controlled values, then the code attempts to delete the temporary Gemini file in a `finally` block. Provider file cleanup failure is logged safely; Google's documented 48-hour retention is only the fallback.

Google documents 20 MB as the maximum total inline request size, so this implementation uses the Files API and imposes a stricter 25 MiB application transfer limit. Google's Files API currently documents up to 2 GB per file, 20 GB per project, and 48-hour retention; the app's smaller limit is intentional. Google's audio guide lists WAV, MP3, AIFF, AAC, OGG, FLAC, MPEG, M4A, L16, Opus, ALAW, MULAW, and WebM MIME types and a maximum audio length of 9.5 hours per prompt. The current app accepts MP3, WAV, FLAC, OGG/OGA, Opus, M4A/MP4, AAC, and WebM uploads; it does not currently inspect duration before upload, so exceptionally long low-bitrate files may be refused by Gemini. Only semantic suggestions are requested: mood, genre, energy, contexts, instrumentation, vocal type, optional language, and tags. It does not claim to measure BPM, key, danceability, acousticness, duration, embeddings, or exact emotion. No confidence score is stored because this provider path has no calibrated confidence measure.

Google describes Gemini audio understanding for supported audio MIME types, the current API recommendation, file limits, and structured outputs in its [audio guide](https://ai.google.dev/gemini-api/docs/audio), [Interactions API overview](https://ai.google.dev/gemini-api/docs/interactions-overview), [Files API guide](https://ai.google.dev/gemini-api/docs/files), and [structured output guide](https://ai.google.dev/gemini-api/docs/structured-output). The provider boundary is isolated in `gemini-music-provider.service.js` so a future provider or a dedicated feature-extraction service can be added without placing provider calls in route handlers.

Uploading audio for analysis sends that audio to Google when the provider is enabled. The UI discloses this in the upload screens. Private audio is retrieved by the backend; its signed ImageKit URL is never sent as model content or written to logs.

## Jobs, retries, and recovery

Job states are `queued`, `processing`, `completed`, and `failed`. Attempt count, bounded maximum, next eligible time, worker lease, safe failure code, provider, model, and result state are persisted. HTTP upload returns without waiting for analysis; a provider, network, validation, or queue failure does not roll back the saved song. Terminal diagnostic codes are safe identifiers and do not contain provider response text.

Automatic retries apply only to classified transient errors such as network/timeout, HTTP 408/429, and provider 5xx responses. Provider 429 responses use bounded exponential backoff with jitter; the worker does not currently honor a provider `Retry-After` header. Invalid model output, unsupported audio, expired or denied asset access, and other non-transient 4xx responses are terminal until a person retries after correcting the cause. Owners can retry their own failed private-song jobs. Administrators can inspect paginated jobs and retry eligible failed jobs. The configured lease must outlive the provider timeout and asset-fetch window so another worker does not normally take over an in-flight request.

ImageKit delivery URLs are signed server-side for 900 seconds. Each analysis attempt obtains a fresh signed URL, checks HTTPS origin and configured path, rejects redirects, bounds transfer size and time, and never logs the URL. This behavior is verified by mocked local tests only; no live ImageKit asset request has been made.

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
- `POST /library/admin/analysis/backfill` scans one bounded batch of public approved catalog and legacy records. It defaults to dry-run; `{ "dryRun": false }` explicitly queues that batch. Optional fields are `limit` (1–100, default 50), `afterId` (ObjectId cursor), and `reprocess` (default false). The response reports scanned, eligible, wouldQueue, skipped, queued, and failed counts, safe skip-reason counts, and a cursor for another batch. Rejected, pending, private, unavailable, unsupported, already active, and failed-job records are skipped. Successfully analyzed records are skipped unless `reprocess` is true; active jobs are never duplicated, and failed jobs use the separate retry endpoint.

Analysis responses exclude audio URLs, storage IDs, owner IDs, credentials, and raw provider messages. Retry endpoints have the dedicated `RATE_LIMIT_ANALYSIS_MAX` request limit. The existing recommendation endpoint keeps its public catalog visibility filter and deterministic scoring. For authenticated listeners it additionally scores canonical, human-reviewed metadata using favorites and up to the latest 100 account-linked feedback events. Feedback remains subject to the existing 90-day TTL. There is no separate listening-history model and no embedding or semantic search.

## Configuration and deployment

Optional settings are documented in `backend/.env.example`:

- `MUSIC_AI_PROVIDER` (currently `gemini`)
- `GEMINI_API_KEY` (server secret)
- `GEMINI_MODEL` (defaults to `gemini-3.8-flash`)
- `GEMINI_API_BASE_URL` (HTTPS endpoint only)
- `MUSIC_AI_TIMEOUT_MS`, `MUSIC_AI_MAX_ATTEMPTS`, `MUSIC_AI_WORKER_CONCURRENCY`, `MUSIC_AI_JOB_LEASE_MS`, and `MUSIC_AI_RETRY_BASE_MS`
- `RATE_LIMIT_ANALYSIS_MAX`

Deployment requires a separate long-running worker process, MongoDB access from both API and worker, and outbound HTTPS access to ImageKit and Google Generative Language APIs. Keep the Gemini key in a secret manager or server-only environment. Worker concurrency should be tuned for provider rate limits and MongoDB capacity. Run API and worker shutdown under the process supervisor so jobs left in a processing lease are recovered after restart. Catalog backfill is never run at startup; an administrator must review a dry-run batch and explicitly submit each enqueue batch.

## Verification and limitations

Provider, worker, API authorization, backfill, and browser tests use mocked provider responses and in-memory models. No live Gemini call, real audio-quality assessment, live MongoDB queue recovery, or ImageKit-to-Gemini transfer has been executed. Run a separately approved end-to-end test using only the dedicated integration database and a disposable authorized audio asset before enabling provider processing for real users. The provider's semantic classifications require human review and may be incorrect; the system does not claim measured acoustic features.

The excluded RAG, vector retrieval, MCP, semantic embeddings, and conversational copilot work are not part of this implementation.
