# Moddy Player authentication

## Configuration

Backend startup requires `AUTH_ACCESS_TOKEN_SECRET` with at least 32 random bytes. Keep it in the ignored backend `.env` file or a secret manager. `AUTH_ACCESS_TOKEN_TTL_SECONDS` defaults to 600 seconds (maximum 3600); `AUTH_REFRESH_TTL_DAYS` defaults to 30 (maximum 90). Production cookies are secure by default. `AUTH_COOKIE_SAME_SITE=none` requires `AUTH_COOKIE_SECURE=true`.

Set `CORS_ALLOWED_ORIGINS` to the exact frontend origins. Credentialed requests are allowed only for those origins. Do not use wildcard origins. The frontend keeps access tokens in memory and sends refresh and CSRF cookies with requests. Refresh cookies are HttpOnly and restricted to `/auth`; the readable CSRF cookie is compared with the `X-CSRF-Token` header for refresh, logout, and password changes.

## Accounts and endpoints

- `POST /auth/register` and `POST /auth/login` issue an access token and refresh/CSRF cookies.
- `POST /auth/refresh` rotates the refresh token in a MongoDB transaction. Reuse of a rotated token revokes its token family.
- `POST /auth/logout` revokes the current token family; `POST /auth/logout-all` revokes all sessions.
- `POST /auth/password`, `GET /auth/me`, and `GET/PATCH /users/me` require a valid bearer access token.
- Passwords use Argon2id. Registration cannot select a role. New accounts always receive the `user` role.
- Song uploads require an active administrator and start public but `pending`; an admin must explicitly approve or reject one through `PATCH /admin/songs/:id/catalog-status`. The Song model defaults new records to private, so future user-upload paths must opt into the private owner library and cannot accidentally publish. Existing records with no visibility or review status remain visible as legacy public catalog content. API catalog, recommendation, and feedback lookups exclude unapproved catalog records and filter private records by owner.

To provision the first administrator, set `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and optionally `ADMIN_NAME` in the process environment, then run `npm run admin:provision` from `backend`. This explicit operator command connects to `MONGODB_URL`, creates or promotes that account, and does not print the password. Never set the admin credentials in source control or browser configuration.

## Tests and operational limits

Run backend tests with `npm test` from `backend`, frontend unit tests with `npm test` from `frontend`, Playwright tests with `npm run test:browser` from `frontend`, and frontend checks with `npm run lint` and `npm run build`.

Rate limits currently use an in-memory, per-process store. Production deployments with multiple workers need a shared atomic store before relying on rate limits across instances. Password recovery, email verification, MFA, account deletion, and broader administrative user-management endpoints are not implemented. Visibility filtering protects API discovery; uploaded ImageKit assets currently use provider URLs that may be directly reachable, so private media delivery requires a private-storage/signed-URL design before private songs should be treated as confidential.

Authentication registration and refresh use MongoDB transactions. The production MongoDB deployment must support transactions (for example, Atlas or a replica set).
