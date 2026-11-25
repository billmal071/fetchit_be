# ─── Stage 1: Dependencies ────────────────────────────────────────────────────
FROM node:20-alpine AS deps

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma/

RUN pnpm install --frozen-lockfile

# ─── Stage 2: Builder ─────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN pnpm db:generate && pnpm build

# ─── Optional: migrations (needs the prisma CLI, so built from the builder) ──
# docker build --target migrate -t fetchit-migrate . && docker run --env-file .env fetchit-migrate
FROM builder AS migrate
CMD ["pnpm", "db:migrate:deploy"]

# ─── Stage 3: Production ──────────────────────────────────────────────────────
FROM node:20-alpine AS production

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

ENV NODE_ENV=production

# Production deps only. The `prisma` CLI is a devDependency, so `pnpm db:generate`
# cannot run after a --prod install; reuse the node_modules the builder already
# generated the client into, then drop devDependencies.
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma/
COPY --from=builder /app/node_modules ./node_modules
RUN pnpm prune --prod

# Copy built output
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/nest-cli.json ./

# Non-root user for security
RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001
USER nestjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/health/liveness || exit 1

CMD ["node", "dist/main"]
