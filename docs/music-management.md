# Music management

## Ownership and discovery

`Song.uploadedBy` is the canonical uploader identity. `ownerId` remains for records written by the earlier authenticated upload flow and is accepted only as a compatibility ownership field. New user uploads always store both IDs from the authenticated request. The client cannot set either ID, `visibility`, `uploadSource`, or catalog state.

Personal uploads are `visibility: private`, `uploadSource: user`, and have no catalog status. Administrator uploads are public catalog submissions in `pending` status. A private upload cannot be submitted for or approved into the shared catalog. ImageKit file IDs and AI suggestion internals are excluded from ordinary song responses. Library responses issue signed delivery URLs with a 15 minute expiry; the canonical URL remains stored in MongoDB.

Public discovery accepts public songs that are approved and sourced from the admin/legacy catalog. For compatibility, a record is treated as legacy only when all ownership and catalog fields (`uploadedBy`, `ownerId`, `visibility`, `catalogStatus`, and `uploadSource`) are absent. A missing owner alone is not enough to expose it. New records receive explicit source and visibility fields.

No bulk migration is run at startup. The database connection creates the Song, Favorite, and Playlist indexes before serving requests. Review existing records before any future data backfill; do not assign owners to old records by inference.

The phase adds no environment variables. It uses the existing `MONGODB_URL`, `IMAGEKIT_PUBLIC_KEY`, `IMAGEKIT_PRIVATE_KEY`, `IMAGEKIT_URL_ENDPOINT`, `MAX_UPLOAD_SIZE_BYTES`, and `IMAGEKIT_UPLOAD_RESPONSE_TIMEOUT_MS` settings. Keep credentials server-side and out of docs and browser builds.

## API

All library endpoints require an authenticated account.

- `GET /library/songs?q=&mood=&page=&limit=` lists the caller's private uploads.
- `POST /library/songs` accepts multipart metadata and one `audio` file. It creates a private upload and marks categorization `not_configured`.
- `PATCH /library/songs/:id` edits owned metadata and validated suggestion fields.
- `DELETE /library/songs/:id` removes owned media and its favorite/playlist references. Provider failures retain a non-playable owner-visible `deletion_failed` record with a retry action. A missing provider asset is treated as already deleted.
- `GET /library/favorites`, `POST /library/favorites/:songId`, and `DELETE /library/favorites/:songId` list and manage unique song favorites.
- `GET /library/playlists`, `POST /library/playlists`, `GET /library/playlists/:id`, `PATCH /library/playlists/:id`, and `DELETE /library/playlists/:id` manage private playlists. Updates require the current `revision`; playlists are limited to 500 unique accessible song IDs.
- Administrators use `GET /library/admin/songs?status=pending` and `PATCH /library/admin/songs/:id` for review and metadata changes. Existing `POST /songs` remains the administrator catalog upload route.

The unique Favorite `(userId, songId)` index prevents duplicate favorites. Playlist documents have owner lookup indexes and bounded unique IDs. Startup waits for these indexes alongside existing authentication and quota indexes.

## AI metadata

The repository has no audio categorization provider. This phase does not invent model output or add AI dependencies. The schema keeps validated AI suggestion fields, processing status, timestamps, and per-field provenance so a backend provider can be added later. Upload succeeds with `not_configured`; user-entered metadata is marked as user-provided, and administrator-reviewed catalog metadata is marked as admin-provided.

## Frontend

Authenticated users can open **My Library** from the navigation to upload, search/filter through the API contract, edit, play, favorite, and delete songs, and create, rename, reorder, and remove private playlists. Administrators also see a catalog upload and moderation queue. The existing discovery and shared player remain in the same application shell.
