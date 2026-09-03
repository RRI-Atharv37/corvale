---
title: Deployment Guide
---

## Who this is for

This guide is for self-hosters: anyone running Corvale on their own server or home lab, outside
of local development. It covers the Docker Compose stack shipped in the repository root, plus
the production-specific configuration (HTTPS, backups, virus scanning, receipt storage) that
[Installation](../../getting-started/installation.md) and [Running
Locally](../../getting-started/running-locally.md) don't need to cover.

If you'd rather run the API and frontend directly with Node instead of Docker, everything below
still applies conceptually - jump to [Deploying without Docker](#deploying-without-docker).

## Deployment topology, in short

Corvale's session cookie is `SameSite=Lax` by default, which requires the frontend and API to
share one registrable domain (same-site, though they can live on different ports or
subdomains). The Docker Compose stack below satisfies this out of the box by exposing the
frontend on `:8080` and the API on `:5000` of the same host. Read [Deployment
topology](./environment-variables.md#deployment-topology) before moving the two onto genuinely
unrelated domains (for example, a frontend on Vercel calling an API on Render).

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose v2 (`docker compose`, not
  the older standalone `docker-compose`)
- A domain name and a reverse proxy that terminates TLS (see [Putting it behind
  HTTPS](#putting-it-behind-https)). This is **required** for any deployment reachable from the
  internet - not just a nice-to-have. It's only skippable for a purely local or internal-network
  trial that never leaves your machine.

## Quickstart

```bash
git clone https://github.com/RRI-Atharv37/corvale.git
cd corvale
cp backend/.env.example backend/.env
cp .env.example .env
```

Edit `backend/.env` and fill in at minimum:

- `JWT_SECRET` - a unique random string of at least 32 characters. Don't leave it at the
  placeholder - the API refuses to start on a placeholder or well-known weak value, and on
  anything shorter than 32 characters when `NODE_ENV=production`. Generate one with:

  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
  ```

- `OFFLINE_GRANT_PRIVATE_KEY` - generate a keypair as described in [Offline session
  grant](./environment-variables.md#offline-session-grant)

Leave `MONGO_URI` and `CLIENT_URL` as-is - `docker-compose.yml` overrides both so the container
always talks to the bundled `mongo` service and admits CORS requests from the frontend
container's actual origin (`http://localhost:8080` by default), regardless of what's in the
file - useful since most people leave `backend/.env`'s own `CLIENT_URL` pointed at `:5173` for
their normal non-Docker `npm run dev`. If you change the frontend's published port in
`docker-compose.yml`, or put it behind a reverse proxy on a real domain (see [Putting it behind
HTTPS](#putting-it-behind-https)), update the `CLIENT_URL` override there to match, not the value
in `backend/.env`.

Edit the root `.env` (a separate file from `backend/.env`) and set:

- `MONGO_ROOT_PASSWORD` - a strong password for the bundled MongoDB, which runs with
  authentication enabled. `docker compose up` refuses to start until this is set. Use only
  URL-safe characters (letters, digits, and `- _ . ~`) - the password is substituted into the
  API's connection string unescaped. `MONGO_ROOT_USERNAME` can stay at its `corvale` default.
- `VITE_OFFLINE_GRANT_PUBLIC_KEY` - the public half of the offline-grant keypair, plus
  `VITE_API_URL`/`VITE_API_ORIGIN` if you're not using the default `localhost` ports. These
  become part of the compiled frontend JS at build time, so they must be correct *before*
  building, not changed afterward - see [Why the frontend needs its own
  .env](#why-the-frontend-needs-its-own-env-file).

Then build and start everything:

```bash
docker compose up -d --build
```

- Frontend: `http://localhost:8080`
- API: `http://localhost:5000/api/v1`
- MongoDB: internal to the Compose network only, not published to the host

Check that both services are healthy:

```bash
curl http://localhost:5000/health   # {"success":true,"data":{"status":"ok"}}
curl http://localhost:5000/ready    # {"success":true,"data":{"status":"ready"}}
```

## What's in the stack

| Service | Image / build | Purpose |
|---------|---------------|---------|
| `mongo` | `mongo:7` | System of record. Runs with authentication enabled (root user from `MONGO_ROOT_USERNAME`/`MONGO_ROOT_PASSWORD`); never published to the host. Data persists in the `mongo-data` volume |
| `backend` | built from `backend/Dockerfile` | The Express API, compiled with `tsc` and run under Node |
| `frontend` | built from `frontend/corvale/Dockerfile` | The Vite production build, served as static files by nginx with SPA routing |
| `clamav` | `clamav/clamav:stable` | Optional receipt virus scanning - only started with `--profile clamav` |

The `backend` Dockerfile builds from the repository root (not `backend/` alone) because the
API's TypeScript config compiles `backend/` and the top-level `shared/` package together into
one `dist/` tree - see [Project Structure](./project-structure.md).

### Why the frontend needs its own `.env` file

Vite inlines every `VITE_*` variable into the JavaScript bundle when you run `vite build` -
there's no runtime step where a container can substitute different values later. That's why the
frontend's configuration comes in through Docker build `args` (wired from the root `.env`)
instead of `env_file`, which only affects a container's runtime environment. If you change a
`VITE_*` value, you must rebuild the frontend image (`docker compose build frontend`), not just
restart the container.

## Persistent data

Two named volumes hold everything that must survive a redeploy:

- `mongo-data` - the MongoDB data files
- `uploads-data` - locally-stored receipts, mounted at `/app/backend/uploads` in the `backend`
  container. Only relevant when `RECEIPT_STORAGE_DRIVER` is unset in `backend/.env` (the
  default). If you configure the S3-compatible driver instead (see below), this volume stays
  empty and isn't required.

Back up `mongo-data` the same way you'd back up any MongoDB deployment - see the [Backup &
Restore Runbook](./backup-restore-runbook.md) for `mongodump`/`mongorestore` commands and
cadence guidance. That runbook also covers backing up receipts under either storage driver.

### Using a managed MongoDB instead of the bundled container

To point at MongoDB Atlas or another managed provider instead of the `mongo` service, remove
the `mongo` service and its `depends_on` entry from `docker-compose.yml`, and delete the
`MONGO_URI` override under `backend.environment` so the real connection string in
`backend/.env` takes effect. `MONGO_ROOT_USERNAME`/`MONGO_ROOT_PASSWORD` in the root `.env` are
then unused - the managed provider's own connection string (with its own credentials) is the
whole story. Managed MongoDB always has authentication on; if you run your own instance instead,
enable it there too.

## Database authentication

The bundled `mongo` service runs with authentication enabled. Two things protect the data, and
you need to keep both:

- **The root credentials.** `MONGO_ROOT_USERNAME` (default `corvale`) and `MONGO_ROOT_PASSWORD`
  from the root `.env` create a root user on the `mongo-data` volume the first time it's
  created, and the API connects with them over `authSource=admin`.
- **Network isolation.** The `mongo` service has no `ports:` mapping, so it's reachable only
  from the other containers on the Compose network, never from the host or the internet. This
  is deliberate and load-bearing - a comment on the service in `docker-compose.yml` says so.
  Don't add a port mapping "just to debug"; run `docker compose exec mongo mongosh -u corvale
  -p "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin` instead.

### Enabling auth on an existing mongo-data volume

`MONGO_INITDB_ROOT_USERNAME`/`_PASSWORD` only create the root user when the data directory is
**empty**. If you're upgrading a deployment whose `mongo-data` volume already has data, adding
the credentials to `.env` makes the container start with `--auth` while no user exists - and the
API can't connect.

Create the user once by hand first, while `MONGO_ROOT_PASSWORD` is still unset (so `mongo` is
still running without auth):

```bash
docker compose exec mongo mongosh admin --eval 'db.createUser({ user: "corvale", pwd: "PUT_YOUR_MONGO_ROOT_PASSWORD_HERE", roles: [{ role: "root", db: "admin" }] })'
```

Then set `MONGO_ROOT_PASSWORD` in `.env` to that same value and run `docker compose up -d`. The
`mongo` container restarts with auth on, and the API authenticates as the user you just created.

## Putting it behind HTTPS

The Compose stack above serves plain HTTP on `:8080`/`:5000`. That is fine for a local or
internal-network trial, but **any deployment reachable from the internet must run behind a TLS
terminator** - this is a hard requirement, for three concrete reasons:

- The refresh-token cookie is only marked `Secure` when `NODE_ENV=production`, and even then a
  browser will only keep a `Secure` cookie that arrived over HTTPS. Served over plain HTTP,
  session cookies travel in cleartext.
- Passwords and every financial record cross the wire in cleartext without TLS. Corvale's
  privacy policy states credentials are transmitted only over encrypted connections - that is a
  property of your deployment, and this is how you make it true.
- The `Strict-Transport-Security` header the frontend sends is inert until the site is actually
  served over HTTPS.

Put a reverse proxy in front that terminates TLS and forwards to the frontend container.
[Caddy](https://caddyserver.com/) does this with automatic Let's Encrypt certificates and
almost no configuration - a `Caddyfile` on the host, outside the Compose stack:

```
corvale.example.com {
    reverse_proxy localhost:8080
}
```

Caddy redirects HTTP to HTTPS automatically. If you use a different proxy (nginx, Traefik),
configure the HTTP→HTTPS redirect explicitly and make sure it forwards `X-Forwarded-Proto` - the
frontend container falls back to its own HTTP→HTTPS redirect when it sees
`X-Forwarded-Proto: http`. Set `NODE_ENV=production` in `backend/.env` as well, so the
refresh-token cookie is marked `Secure`.

Update the `CLIENT_URL` override under `backend.environment` in `docker-compose.yml` (not
`backend/.env` - see [Quickstart](#quickstart) above) to `https://corvale.example.com`, and rebuild
the frontend image with `VITE_API_URL`/`VITE_API_ORIGIN` pointing at wherever the API is reachable
through your proxy (either the same domain under a `/api` path you proxy separately, or a
subdomain like `api.corvale.example.com` - either keeps the deployment same-site). An nginx or
Traefik reverse proxy works the same way; the requirement is only that TLS terminates in front of
both containers and `CLIENT_URL` matches the public frontend URL exactly.

### Network exposure and the loopback binding

The tracked `docker-compose.yml` publishes the `backend` and `frontend` ports on `127.0.0.1`
only (`127.0.0.1:5000:5000`, `127.0.0.1:8080:8080`). The reverse proxy runs on the host and
reaches them over loopback, but nothing outside the machine can. This is deliberate: the proxy
is the only thing that should ever be internet-facing.

Two things to know:

- **A host firewall (`ufw`, `firewalld`) is not enough on its own.** Docker inserts its own
  `iptables` DNAT rules that are evaluated before `ufw`'s, so a container published on
  `0.0.0.0` stays reachable even when `ufw` claims the port is closed. Verify exposure at the
  cloud provider's network firewall / security group as well — don't rely on the host firewall
  alone.
- **If the proxy runs on a different host** (not the same machine as the containers), loopback
  won't reach it. Bind to the private-network interface instead via a
  `docker-compose.override.yml` — copy `docker-compose.override.example.yml`, which Compose
  merges over the tracked file automatically so `git pull` never conflicts, and change the
  `ports:` entries there (e.g. `10.0.0.5:5000:5000`). Never bind back to `0.0.0.0` on a
  public-facing host.

## Security headers

The frontend container's nginx (`frontend/corvale/nginx.conf`) sends these on every response:

- `Content-Security-Policy: frame-ancestors 'none'` and `X-Frame-Options: DENY` - together these
  stop the app being embedded in a hostile page and used for clickjacking. The CSP in
  `index.html` can't do this on its own, because `frame-ancestors` is ignored when it comes from
  a `<meta>` tag.
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` denying every powerful browser feature Corvale never uses (camera,
  microphone, geolocation, payment, USB, and the rest). The API sends the same policy.
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`. The API sends a matching
  `max-age`. `preload` is deliberately not sent - it commits every `corvale.app` subdomain to
  HTTPS-only and is hard to reverse.

If you serve the built frontend some other way (see [Deploying without
Docker](#deploying-without-docker)), replicate these headers at your web server or CDN. If your
reverse proxy adds its own headers, make sure it doesn't strip or duplicate these.

## Container hardening

Both application containers run as an unprivileged user, not root - the `backend` image as the
Node image's built-in `node` user, and the `frontend` image on the `nginxinc/nginx-unprivileged`
base (which is why nginx listens on `8080` inside the container, mapped from the host's `8080`).
Both declare a Docker `HEALTHCHECK` against their `/health` endpoint, so `docker compose ps` and
your orchestrator can see when a container has wedged.

## Enabling ClamAV virus scanning

Receipt uploads are scanned with ClamAV in production - see [Environment
Variables](./environment-variables.md) for the full `VIRUS_SCAN_*` reference. To turn it on:

```bash
docker compose --profile clamav up -d --build
```

Then set in `backend/.env`:

```
VIRUS_SCAN_ENABLED=true
CLAMAV_HOST=clamav
```

and restart the `backend` service (`docker compose up -d backend`). ClamAV's virus database
takes a few minutes to download on first start; uploads fail closed until it's ready, per
`VIRUS_SCAN_FAIL_CLOSED`.

## Using S3-compatible receipt storage

Local-disk receipts (the default) live on the `backend` container's filesystem, backed by the
`uploads-data` volume - fine for a single-host deployment, but they won't survive switching
hosts without also moving that volume. To use an S3-compatible bucket instead (AWS S3,
Cloudflare R2, Backblaze B2, or a self-hosted MinIO), set the `RECEIPT_S3_*` variables in
`backend/.env` as documented in [Environment Variables](./environment-variables.md) and restart
the `backend` service. The `uploads-data` volume becomes unused once the driver is switched.

## Updating

```bash
git pull
docker compose up -d --build
```

Docker Compose only rebuilds and recreates the services whose images actually changed, so this
is safe to run even when only one side (frontend or backend) has new commits. Check
`docker compose logs -f backend` after an update if you want to confirm the new version came up
cleanly before relying on it.

## Deploying without Docker

If you'd rather not use Docker, run the same three pieces as standalone processes:

1. Follow [Installation](../../getting-started/installation.md) to install dependencies and
   configure `backend/.env` and `frontend/corvale/.env`.
2. `cd backend && npm run build && npm start` - runs the compiled API under plain Node. Use a
   process manager (`pm2`, `systemd`, a container orchestrator) to keep it running and restart
   it on crash or reboot; nothing in this repository does that for you outside Docker's own
   `restart: unless-stopped`.
3. `cd frontend/corvale && npm run build` - produces static files in `dist/`. Serve them with any
   static file server that supports SPA fallback routing (nginx, Caddy, Netlify, S3 + CloudFront
   all work) - see `frontend/corvale/nginx.conf` in the repository for a minimal example
   configuration.
4. Point both at a MongoDB instance you run or manage yourself - with **authentication enabled**
   and not exposed to any untrusted network - and put its full connection string (credentials
   included) in `backend/.env`'s `MONGO_URI`. Then follow the same environment variable, HTTPS,
   virus-scanning, and receipt-storage guidance above - none of it is Docker-specific.

## Related pages

- [Environment Variables](./environment-variables.md)
- [Backup & Restore Runbook](./backup-restore-runbook.md)
- [Project Structure](./project-structure.md)
