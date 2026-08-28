# S-20 single-service deploy (decision 037): one image serves both the
# built frontend (static assets) and the backend API. Render builds this
# Dockerfile directly; backend/Dockerfile stays in place, unchanged, for
# local docker-compose use only.

FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/tsconfig.json frontend/vite.config.ts frontend/index.html ./
COPY frontend/src ./src
RUN npm run build

FROM node:20-alpine AS backend-build
WORKDIR /app
# bcrypt compiles a native addon on install; alpine (musl) isn't covered by
# its prebuilt binaries, so it falls back to source, which needs these.
RUN apk add --no-cache python3 make g++
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache python3 make g++
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && apk del python3 make g++
COPY --from=backend-build /app/dist ./dist
COPY backend/src/db/migrations ./dist/db/migrations
COPY --from=frontend-build /app/frontend/dist ./frontend-dist

EXPOSE 4000
CMD ["node", "dist/server.js"]
