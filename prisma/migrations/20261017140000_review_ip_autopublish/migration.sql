-- One active review per client network per business, plus email dedupe keys.
-- ipHash stores a keyed HMAC of the normalized client IP, never the raw IP.
ALTER TABLE "Review" ADD COLUMN "ipHash" TEXT;
ALTER TABLE "EmailLog" ADD COLUMN "dedupeKey" TEXT;

-- Partial unique index: only reviews that count as active hold the slot.
-- REJECTED/REMOVED rows keep their hash for audit but no longer block the IP,
-- which also lets a moderator publish an auto-blocked review as an override
-- once the conflicting active review is handled.
CREATE UNIQUE INDEX "Review_businessId_ipHash_key"
  ON "Review"("businessId", "ipHash")
  WHERE "ipHash" IS NOT NULL AND "status" IN ('PENDING', 'PUBLISHED', 'HIDDEN', 'INFO_REQUESTED');

CREATE UNIQUE INDEX "EmailLog_dedupeKey_key" ON "EmailLog"("dedupeKey");
