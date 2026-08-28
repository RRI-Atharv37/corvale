---
title: Environment Variables
---

## Backend environment variables

Create a `.env` file in the `backend/` folder.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `5000` | HTTP port for the API server |
| `MONGO_URI` | Yes | - | MongoDB connection string |
| `JWT_SECRET` | Yes | - | Secret key for signing JWT access tokens. Must be a unique random string — the server refuses to start if it is left at the `.env.example` placeholder or another well-known weak value, and when `NODE_ENV=production` it must be at least 32 characters. See [Security notes](#security-notes) |
| `JWT_EXPIRY` | Yes | - | Access token expiry (e.g., `15m`, `1h`) |
| `NODE_ENV` | No | `development` | `development` \| `production` \| `test`. Controls stack traces in error responses, reset-link console logging, and secure-cookie flags |
| `JWT_REFRESH_EXPIRY` | No | `7d` | Refresh token expiry |
| `REFRESH_TOKEN_COOKIE_NAME` | No | `corvale_refresh` | httpOnly cookie name for refresh tokens |
| `REFRESH_COOKIE_SAME_SITE` | No | `lax` | `lax` \| `strict` \| `none` — see [Deployment topology](#deployment-topology) below. `none` is only accepted when `NODE_ENV=production` |
| `CLIENT_URL` | Yes | - | Frontend origin for CORS (e.g., `http://localhost:5173`). The desktop app's origins (`tauri://localhost`, `http://tauri.localhost`) are always admitted alongside it — see `backend/utils/corsOriginAllowlist.ts` |
| `OFFLINE_GRANT_PRIVATE_KEY` | Yes | - | EC (P-256) private key, PEM-encoded with real newlines replaced by literal `\n`, that signs the client's offline session grant. See [Offline session grant](#offline-session-grant) below |
| `OFFLINE_GRANT_DAYS` | No | `30` | How many days a client may render its cached data offline before the signed grant expires |
| `PASSWORD_RESET_EXPIRY_MS` | No | `600000` (10 minutes) | Password reset token lifetime |
| `EMAIL_VERIFICATION_EXPIRY_MS` | No | `600000` (10 minutes) | Email verification token lifetime. Login is hard-blocked until the address is verified; a blocked user gets a fresh link from the unauthenticated `POST /auth/email-verification/resend` (`{ email }` body, enumeration-safe) |
| `SMTP_HOST` | No | unset | SMTP server host. Leave unset in dev to log reset/verification links to the console instead of emailing them. Setting it switches on real delivery, so only set it once the sending domain's SPF/DKIM/DMARC records are published and verified. Current provider is Resend (`smtp.resend.com`) |
| `SMTP_PORT` | No | `587` | SMTP server port (`465` switches to implicit TLS) |
| `SMTP_USER` | Only if `SMTP_HOST` set | unset | SMTP account username (for Resend this is the literal string `resend`) |
| `SMTP_PASS` | Only if `SMTP_HOST` set | unset | SMTP account password (for Resend, a "Sending access" API key, `re_…`) |
| `SMTP_FROM` | No | `Corvale <no-reply@send.corvale.app>` | "From" address on outgoing password-reset and email-verification messages. Its domain must be the verified sending domain or DKIM will not align |
| `SMTP_REPLY_TO` | No | `Corvale Support <support@corvale.app>` | "Reply-To" address on outgoing mail — a real monitored inbox, since `SMTP_FROM` is a no-reply mailbox |
| `AUTH_RATE_LIMIT_WINDOW_MS` | No | `900000` (15 min) | Rate limit window for auth routes, and for `/auth/refresh` + `/auth/logout` |
| `AUTH_RATE_LIMIT_MAX` | No | `10` | Max requests per window per IP for auth routes, and for `/auth/refresh` + `/auth/logout` |
| `SYNC_PUSH_RATE_LIMIT_WINDOW_MS` | No | `60000` (1 min) | Rate limit window for `POST /sync/push` |
| `SYNC_PUSH_RATE_LIMIT_MAX` | No | `120` | Max `POST /sync/push` requests per window per IP |
| `GLOBAL_RATE_LIMIT_WINDOW_MS` | No | `900000` (15 min) | Rate limit window for mutating requests (POST/PUT/PATCH/DELETE) across the whole API |
| `GLOBAL_RATE_LIMIT_MAX` | No | `300` | Max mutating requests per window per IP across the whole API |
| `TRUST_PROXY` | No | unset (`false`) | Express `trust proxy` setting — set to the number of hops (e.g. `1`) behind a reverse proxy so rate limiters key on the real client IP |
| `VIRUS_SCAN_ENABLED` | No | `false` | Enable ClamAV scan on receipt upload |
| `CLAMAV_HOST` | No | `127.0.0.1` | ClamAV daemon host |
| `CLAMAV_PORT` | No | `3310` | ClamAV daemon port |
| `CLAMAV_TIMEOUT_MS` | No | `30000` (30 sec) | ClamAV scan connection timeout |
| `VIRUS_SCAN_FAIL_CLOSED` | No | `true` | Reject uploads when a scan errors out (not the same as an infected result). Already fail-closed unless explicitly set to the literal string `false` |
| `BACKUP_MAX_UNCOMPRESSED_BYTES` | No | `209715200` (200 MB) | Cap on a restored backup zip's total declared uncompressed size, checked against the archive's central directory before any entry is inflated |
| `BACKUP_MAX_ZIP_ENTRIES` | No | `10000` | Cap on the number of entries in a restored backup zip |
| `BACKUP_MAX_COMPRESSION_RATIO` | No | `100` | Cap on any single entry's uncompressed-to-compressed size ratio in a restored backup zip |
| `RECEIPT_STORAGE_DRIVER` | No | unset (local disk) | Set to `s3` to store receipts in an S3-compatible bucket instead of `uploads/receipts/` on local disk. Required for any hosted deployment — local disk is ephemeral and not shared between instances |
| `RECEIPT_S3_BUCKET` | Only if driver is `s3` | - | Bucket name receipts are stored in |
| `RECEIPT_S3_REGION` | No | `us-east-1` | Bucket region |
| `RECEIPT_S3_ENDPOINT` | No | unset (real AWS S3) | Custom endpoint for an S3-compatible provider (Cloudflare R2, MinIO, Backblaze B2) |
| `RECEIPT_S3_FORCE_PATH_STYLE` | No | `false` | Set to `true` for providers that require path-style requests (e.g. MinIO) |
| `RECEIPT_S3_ACCESS_KEY_ID` | Only if driver is `s3` | - | Access key for the bucket |
| `RECEIPT_S3_SECRET_ACCESS_KEY` | Only if driver is `s3` | - | Secret key for the bucket |
| `RECEIPT_STORAGE_QUOTA_BYTES` | No | unset (no quota) | Per-user cap on total receipt bytes, enforced at upload under either storage driver |
| `SENTRY_DSN` | No | unset (error tracking off) | Sentry (or Sentry-compatible) ingest DSN. When unset, 5xx errors are only written to the structured JSON logs, not reported anywhere external |
| `SENTRY_ENVIRONMENT` | No | `NODE_ENV` | Environment tag attached to reported errors, e.g. `production`, `staging` |
| `CAPTCHA_ENABLED` | No | `false` | Require a valid CAPTCHA token (`captchaToken` in the request body) on `POST /auth/register`. Off by default, same as ClamAV/SMTP |
| `CAPTCHA_SECRET_KEY` | Only if `CAPTCHA_ENABLED=true` | - | Server-side secret used to verify the token against the hCaptcha `siteverify` endpoint |

All three rate limiters above (auth, sync-push, global) are backed by a MongoDB-stored counter
(`backend/utils/mongoRateLimitStore.ts`), not per-process memory, so a client's budget is shared
across every horizontally-scaled instance instead of being multiplied by the instance count.

### Example backend `.env`

```
PORT=5000
MONGO_URI=mongodb://127.0.0.1:27017/corvale
JWT_SECRET=replace-with-a-long-random-string
JWT_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d
CLIENT_URL=http://localhost:5173
OFFLINE_GRANT_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nMIGHAgEA...\n-----END PRIVATE KEY-----
```

Replace the `JWT_SECRET` and `OFFLINE_GRANT_PRIVATE_KEY` placeholders with real generated values
before starting the server — it validates both at boot and refuses to run on the shipped
placeholders (see [Security notes](#security-notes) and [Offline session
grant](#offline-session-grant)).

## Frontend environment variables

Create a `.env` file in the `frontend/corvale/` folder (copy from `.env.example`).

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_API_URL` | No | `http://localhost:5000/api/v1` | Backend API base URL |
| `VITE_API_ORIGIN` | No | `http://localhost:5000` | Same backend, origin only (no `/api/v1` path) - builds the `connect-src` directive in the page's Content-Security-Policy. Keep in sync with `VITE_API_URL`'s origin |
| `VITE_DOCS_URL` | No | `http://localhost:5174` | URL the "Docs" link in the dashboard header opens |
| `VITE_LOCAL_FIRST` | No | `false` | Enables the offline local-first sync engine, its settings UI, and local-store reads/writes on dashboard pages |
| `VITE_OFFLINE_GRANT_PUBLIC_KEY` | Yes | - | EC (P-256) public key, PEM-encoded with real newlines replaced by literal `\n`, matching the backend's `OFFLINE_GRANT_PRIVATE_KEY`. Without it, offline rendering of cached data fails closed — see [Offline session grant](#offline-session-grant) below |
| `VITE_CAPTCHA_ENABLED` | No | `false` | Renders the hCaptcha widget on Signup and sends `captchaToken` on register. Must match the backend's `CAPTCHA_ENABLED` — this only controls the UI; the backend is what enforces it. Also widens the CSP (`script-src`/`style-src`/`connect-src`/`frame-src`) to admit hCaptcha's origins; unset leaves the CSP byte-for-byte unchanged |
| `VITE_CAPTCHA_SITE_KEY` | Only if `VITE_CAPTCHA_ENABLED=true` | - | hCaptcha *site* key (public). Pairs with the backend's `CAPTCHA_SECRET_KEY` |

### Example frontend `.env`

```
VITE_API_URL=http://localhost:5000/api/v1
VITE_API_ORIGIN=http://localhost:5000
VITE_DOCS_URL=http://localhost:5174
VITE_LOCAL_FIRST=false
VITE_OFFLINE_GRANT_PUBLIC_KEY=-----BEGIN PUBLIC KEY-----\nMFkwEwYH...\n-----END PUBLIC KEY-----
```

### Desktop build overrides

The desktop (Tauri) app runs Vite in a separate `desktop` mode rather than sharing the plain
web build. `frontend/corvale/.env.desktop` layers on top of the files above and is the only place
`VITE_LOCAL_FIRST=true` is set. The web build deliberately stays `false` — offline data is a
desktop feature by design. The desktop app stores its local copy in a SQLCipher-encrypted
database on disk; on the web the local store is browser storage, so the web app keeps the server
as the single source of truth rather than shipping a partly-offline experience. `npm run
tauri:dev`/`npm run tauri:build` pick `.env.desktop` up automatically (they run `vite --mode
desktop` / `vite build --mode desktop` under the hood); a plain `npm run dev`/`npm run build`
never reads it.

## Deployment topology

Corvale's refresh session relies on an httpOnly cookie, and cookies are topology-sensitive:
**the pinned, supported deployment is same-site** — the frontend and API sharing one
registrable domain (e.g. `app.corvale.example` + `api.corvale.example`, or an API reverse-proxied
under the same origin as the frontend). This is a hard requirement, not a suggestion: with a
same-site deployment, leave `REFRESH_COOKIE_SAME_SITE` unset and the refresh cookie is sent as
`SameSite=Lax`, which works correctly.

Deploying the frontend and API on unrelated domains (for example a Vercel frontend against a
Render/Fly API) is **cross-site**, and `SameSite=Lax` cookies are not sent on cross-site
requests at all. Symptom: users are silently logged out every time the 15-minute access token
expires, with no error anywhere — `POST /auth/refresh` just never receives the cookie. If a
cross-site deployment is genuinely required, set `REFRESH_COOKIE_SAME_SITE=none` explicitly
(only accepted with `NODE_ENV=production`, since `SameSite=None` cookies must also be `Secure`
or browsers reject them). Note this does **not** add CSRF protection for the auth routes —
that lands with the wider token-storage rework (`SEC-18`) — so treat `none` as a stopgap, not
a long-term posture.

The desktop (Tauri) app is a distinct cross-site case tracked separately (`SEC-10`/`SEC-11`
cross-cutting note in `ROADMAP.md`) and is expected to use a non-cookie refresh path rather
than `SameSite=None`.

## Offline session grant

Corvale keeps the access token itself in memory only, never in `localStorage` — a page reload has
no token to read back, so the app calls `POST /auth/refresh` (backed by the httpOnly refresh
cookie) on boot to get a fresh one instead. That's the online path.

Offline is different: with no server reachable, the app falls back to the last-known cached
user, gated by a signed **offline session grant** rather than a plain expiry date. Every
successful login, refresh, or reconnect issues a fresh grant — a JWT signed with
`OFFLINE_GRANT_PRIVATE_KEY` — that the client stores and can verify locally with the matching
`VITE_OFFLINE_GRANT_PUBLIC_KEY`, but can never mint or extend on its own. If the grant is
missing, tampered with, or has expired, offline rendering is refused rather than allowed by
default — generate a real keypair per deployment and never reuse the sample values above:

```bash
openssl ecparam -genkey -name prime256v1 -noout -out offline-grant-private.pem
openssl ec -in offline-grant-private.pem -pubout -out offline-grant-public.pem
```

Paste each file's contents into the matching env var with real newlines replaced by literal
`\n`, keeping the value on one line.

## Monitoring

Corvale exposes two endpoints for operators, with no configuration required:

- `GET /health` — liveness. Returns `200` as soon as the process is up, without touching
  MongoDB, so it stays fast even if the database is down.
- `GET /ready` — readiness. Returns `200` only once the MongoDB connection is actually
  established, and `503` otherwise.

Point an external uptime monitor (UptimeRobot, Better Uptime, Pingdom, or your hosting
provider's built-in health check) at `GET /health` to get alerted the moment the process stops
responding, and at `GET /ready` if you want load-balancer or orchestrator traffic held back
until the database connection is up.

Every request is also logged as one structured JSON line to stdout (or stderr for errors),
suitable for ingestion by any log aggregator that reads container/process logs — no extra
configuration needed. Set `SENTRY_DSN` to additionally forward unexpected 5xx errors to Sentry
for alerting and stack-trace triage; leave it unset in development.

## Security notes

- Never commit `.env` files to version control
- Use a strong, unique `JWT_SECRET` — never the `.env.example` placeholder. The server rejects
  placeholder and well-known weak values at startup, and requires at least 32 characters when
  `NODE_ENV=production`. Generate one with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
  ```
- Generate a dedicated `OFFLINE_GRANT_PRIVATE_KEY` keypair per deployment and never commit it —
  only the public half belongs in the frontend build
- Set `CLIENT_URL` to your actual frontend domain in production
- Deploy the frontend and API same-site; see [Deployment topology](#deployment-topology) above
  before considering a cross-site setup
- Use a managed MongoDB instance with authentication in production

## Related pages

- [Installation](../getting-started/installation.md)
- [Developer Overview](./overview.md)
