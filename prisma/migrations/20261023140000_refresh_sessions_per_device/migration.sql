-- Bug #12: a single refresh_token column on users meant logging in on a
-- second device silently logged out the first (every login/refresh
-- overwrote the same row). Move to one row per session.
-- CreateTable
CREATE TABLE "refresh_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "refresh_sessions_token_hash_key" ON "refresh_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_sessions_user_id_idx" ON "refresh_sessions"("user_id");

-- AddForeignKey
ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- users.refresh_token is deliberately NOT dropped here. deploy.yml runs
-- migrations on the CI runner before rsync + pm2 reload, so the
-- still-running old process (old generated Prisma client, still selecting
-- this column on every authenticated request via JwtStrategy) would start
-- failing the moment this migration lands if the column were gone. Drop it
-- in a separate follow-up migration once this code has been live a while.
-- Existing sessions are single-device anyway (the bug this fixes), so
-- there is nothing to backfill into refresh_sessions — every currently
-- logged-in user just needs to log in again once the new code is live.
