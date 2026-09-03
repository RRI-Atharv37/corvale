# Build context is the repository root (see docker-compose.yml), not frontend/corvale/, because
# the frontend imports the top-level shared/ package via the "@shared" alias in vite.config.ts,
# and that config's build.outDir points at ../../dist/frontend (repo-root-relative) rather than
# a local dist/ folder - both need the repo root visible in the build context to resolve.
#
# Vite bakes VITE_* variables into the built JS at build time, not at container start — so they
# arrive as build ARGs here, not as runtime environment variables. See
# docs/developers/guides/deployment.md for how docker-compose.yml wires these from a root .env file.
FROM node:20-alpine AS build
WORKDIR /app

COPY frontend/corvale/package.json frontend/corvale/package-lock.json ./frontend/corvale/
RUN cd frontend/corvale && npm ci

COPY frontend/corvale ./frontend/corvale
COPY shared ./shared

WORKDIR /app/frontend/corvale

ARG VITE_API_URL=http://localhost:5000/api/v1
ARG VITE_API_ORIGIN=http://localhost:5000
ARG VITE_DOCS_URL=
ARG VITE_LOCAL_FIRST=false
ARG VITE_OFFLINE_GRANT_PUBLIC_KEY=
ARG VITE_CAPTCHA_ENABLED=false
ARG VITE_CAPTCHA_SITE_KEY=
ENV VITE_API_URL=$VITE_API_URL \
    VITE_API_ORIGIN=$VITE_API_ORIGIN \
    VITE_DOCS_URL=$VITE_DOCS_URL \
    VITE_LOCAL_FIRST=$VITE_LOCAL_FIRST \
    VITE_OFFLINE_GRANT_PUBLIC_KEY=$VITE_OFFLINE_GRANT_PUBLIC_KEY \
    VITE_CAPTCHA_ENABLED=$VITE_CAPTCHA_ENABLED \
    VITE_CAPTCHA_SITE_KEY=$VITE_CAPTCHA_SITE_KEY

RUN npm run build

# SEC-67: the unprivileged nginx image runs its master + workers as the `nginx` user (uid 101)
# and expects its listener on a high port — nginx.conf listens on 8080 to match.
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
USER root
COPY --from=build /app/dist/frontend /usr/share/nginx/html
COPY frontend/corvale/nginx.conf /etc/nginx/conf.d/default.conf
USER nginx
EXPOSE 8080

# SEC-67: liveness probe against the static /health location.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -q --spider http://127.0.0.1:8080/health || exit 1
