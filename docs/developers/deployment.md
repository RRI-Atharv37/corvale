---
title: Deployment Guide
---

## Who this is for

This guide is for self-hosters: anyone running Corvale on their own server or home lab, outside
of local development. It covers the Docker Compose stack shipped in the repository root, plus
the production-specific configuration (HTTPS, backups, virus scanning, receipt storage) that
[Installation](../getting-started/installation.md) and [Running
Locally](../getting-started/running-locally.md) don't need to cover.

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
- A domain name and a reverse proxy if you want HTTPS and a real hostname (see
  [Putting it behind HTTPS](#putting-it-behind-https)) - not required to try Corvale locally

## Quickstart

```bash
git clone https://github.com/RRI-Atharv37/spndr.git
cd spndr
cp backend/.env.example backend/.env
cp .env.example .env
```

Edit `backend/.env` and fill in at minimum:

- `JWT_SECRET` - a long, random string
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

Edit the root `.env` (a separate file from `backend/.env`) and set `VITE_OFFLINE_GRANT_PUBLIC_KEY`
to the public half of the same keypair, plus `VITE_API_URL`/`VITE_API_ORIGIN` if you're not using
the default `localhost` ports. These become part of the compiled frontend JS at build time, so
they must be correct *before* building, not changed afterward - see [Why the frontend needs its
own .env](#why-the-frontend-needs-its-own-env-file).

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
| `mongo` | `mongo:7` | System of record. Data persists in the `mongo-data` volume |
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
`backend/.env` takes effect.

## Putting it behind HTTPS

The Compose stack above serves plain HTTP on `:8080`/`:5000`, which is fine for local use or an
internal network. For anything reachable from the internet, put a reverse proxy in front that
terminates TLS and forwards to the frontend container. [Caddy](https://caddyserver.com/) does
this with automatic Let's Encrypt certificates and almost no configuration - a `Caddyfile` on
the host, outside the Compose stack:

```
corvale.example.com {
    reverse_proxy localhost:8080
}
```

Update the `CLIENT_URL` override under `backend.environment` in `docker-compose.yml` (not
`backend/.env` - see [Quickstart](#quickstart) above) to `https://corvale.example.com`, and rebuild
the frontend image with `VITE_API_URL`/`VITE_API_ORIGIN` pointing at wherever the API is reachable
through your proxy (either the same domain under a `/api` path you proxy separately, or a
subdomain like `api.corvale.example.com` - either keeps the deployment same-site). An nginx or
Traefik reverse proxy works the same way; the requirement is only that TLS terminates in front of
both containers and `CLIENT_URL` matches the public frontend URL exactly.

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

1. Follow [Installation](../getting-started/installation.md) to install dependencies and
   configure `backend/.env` and `frontend/corvale/.env`.
2. `cd backend && npm run build && npm start` - runs the compiled API under plain Node. Use a
   process manager (`pm2`, `systemd`, a container orchestrator) to keep it running and restart
   it on crash or reboot; nothing in this repository does that for you outside Docker's own
   `restart: unless-stopped`.
3. `cd frontend/corvale && npm run build` - produces static files in `dist/`. Serve them with any
   static file server that supports SPA fallback routing (nginx, Caddy, Netlify, S3 + CloudFront
   all work) - see `frontend/corvale/nginx.conf` in the repository for a minimal example
   configuration.
4. Point both at a MongoDB instance you run or manage yourself, and follow the same environment
   variable, HTTPS, virus-scanning, and receipt-storage guidance above - none of it is
   Docker-specific.

## Related pages

- [Environment Variables](./environment-variables.md)
- [Backup & Restore Runbook](./backup-restore-runbook.md)
- [Project Structure](./project-structure.md)
