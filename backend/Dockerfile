FROM node:20-alpine AS build
WORKDIR /app
# bcrypt compiles a native addon on install; alpine (musl) isn't covered by
# its prebuilt binaries, so it falls back to source, which needs these.
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && apk del python3 make g++
COPY --from=build /app/dist ./dist
COPY src/db/migrations ./dist/db/migrations

EXPOSE 4000
CMD ["node", "dist/server.js"]
