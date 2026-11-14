# Scholé: one image serving the API, the realtime server, the media server (mediasoup) and the web app.
#   docker build -t schole .
# See infrastructure/docker/README.md for running it with MongoDB, coturn and HTTPS (docker compose).

# 1. The web app (static files, same origin as the API).
FROM node:22-bookworm-slim AS web
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# 2. Production dependencies. mediasoup fetches a prebuilt media worker for linux-x64/arm64 and
#    compiles one if none fits, hence the build tools (they do not reach the final image).
FROM node:22-bookworm-slim AS deps
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip python3-venv make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# 3. Runtime: Node, FFmpeg (recordings), tini (signals), an unprivileged user.
FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000 \
    SERVE_FRONTEND_DIST=/app/frontend/dist \
    RECORDINGS_DIR=/data/recordings
WORKDIR /app/backend
COPY --from=deps /app/backend/node_modules ./node_modules
COPY backend/package.json ./
COPY backend/src ./src
COPY --from=web /app/frontend/dist /app/frontend/dist
RUN mkdir -p /data/recordings /data/backups && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/server.js"]
