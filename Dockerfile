# One container = NestJS API + the built React PWA (same origin → secure cookies, no CORS).
# Used by Railway (see railway.json). Build context: repository root.

# ---------- 1. Web (React PWA) ----------
FROM node:22-bookworm-slim AS web
WORKDIR /build/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---------- 2. Backend build ----------
FROM node:22-bookworm-slim AS api
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /build/backend
COPY backend/package.json backend/package-lock.json ./
COPY backend/prisma ./prisma
RUN npm ci --no-audit --no-fund
COPY backend/ ./
RUN npx prisma generate && npm run build && npm prune --omit=dev

# ---------- 3. Runtime ----------
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    WEB_DIST_PATH=/app/web/dist \
    PORT=3000
WORKDIR /app/backend
COPY --from=api /build/backend/node_modules ./node_modules
COPY --from=api /build/backend/dist ./dist
COPY --from=api /build/backend/prisma ./prisma
COPY --from=api /build/backend/package.json ./package.json
COPY --from=web /build/web/dist /app/web/dist
USER node
EXPOSE 3000
# Apply pending migrations (idempotent), then start. tini forwards SIGTERM for graceful shutdown.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
