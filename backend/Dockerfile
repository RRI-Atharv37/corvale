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
RUN mkdir -p /app/backend/uploads/receipts

WORKDIR /app/backend
EXPOSE 5000
CMD ["node", "../dist/backend/server.js"]
