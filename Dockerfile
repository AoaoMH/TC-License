# ============================================================================
# Stage 1: Build Frontend (Vite + React) & Backend (TypeScript)
# ============================================================================
FROM node:22.23.4-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json tsconfig.server.json vite.config.ts ./
COPY src ./src

RUN npm run build

# ============================================================================
# Stage 2: Production Runtime (node:22-alpine with built-in node:sqlite)
# ============================================================================
FROM node:22.23.4-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

# 持久化目录：SQLite 数据库与各产品 Ed25519 密钥对
VOLUME ["/app/data", "/app/keys"]

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "dist/server/index.js"]
