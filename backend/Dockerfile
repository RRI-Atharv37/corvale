# Build context is the repository root (see docker-compose.yml) because the backend's
# tsconfig.json compiles backend/ and shared/src/ together into a shared dist/ tree.
FROM node:20-alpine AS build
WORKDIR /app

COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci

COPY backend ./backend
COPY shared ./shared
RUN cd backend && npm run build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci --omit=dev
COPY backend/scripts/linkDistNodeModules.js ./backend/scripts/linkDistNodeModules.js

COPY --from=build /app/dist ./dist
# Re-link dist/node_modules against *this* stage's backend/node_modules (prod deps only) -
# the copy above brings in the build stage's symlink, which happens to resolve correctly here
# too since both stages share the same /app layout, but re-running the link script makes that
# explicit instead of relying on the coincidence.
RUN node backend/scripts/linkDistNodeModules.js
# SEC-67: run as the node image's built-in unprivileged `node` user (uid 1000). It only needs
# write access to the local-disk receipt directory (unused once RECEIPT_STORAGE_DRIVER=s3); the
# code and node_modules stay root-owned and read-only.
RUN mkdir -p /app/backend/uploads/receipts && chown -R node:node /app/backend/uploads

WORKDIR /app/backend
EXPOSE 5000
USER node

# SEC-67: liveness probe. Hits the DB-free /health route so a wedged process is restarted
# without flapping on a transient Mongo blip (that is /ready's job, checked by the orchestrator).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "require('http').get('http://127.0.0.1:5000/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "../dist/backend/src/server.js"]
