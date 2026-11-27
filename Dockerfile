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

# ─── Production dependencies: the builder's node_modules (Prisma client already
# generated) with devDependencies pruned. Pruning in its own stage means the
# full tree is never copied into a production layer. `migrate` above stays on
# the unpruned builder, so the prisma CLI is still available there.
FROM builder AS prod-deps
RUN pnpm prune --prod

# ─── Stage 3: Production ──────────────────────────────────────────────────────
FROM node:20-alpine AS production

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

ENV NODE_ENV=production

# Production deps only (pruned in the prod-deps stage). The `prisma` CLI is a
# devDependency, so `pnpm db:generate` cannot run after a --prod install; the
# generated client comes along in the pruned node_modules.
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma/
COPY --from=prod-deps /app/node_modules ./node_modules

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
