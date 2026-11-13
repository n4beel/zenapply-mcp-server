# Build stage
FROM node:22-slim AS builder

WORKDIR /app

# Install dependencies required for native builds (better-sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Prune devDependencies to keep image small
RUN npm prune --omit=dev

# Production runtime stage
FROM node:22-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

# Create data directory for SQLite volume with ownership for non-root user 'node'
RUN mkdir -p /data && chown -R node:node /data

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules/ ./node_modules/
COPY --from=builder /app/dist/ ./dist/

USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "dist/index.js"]
