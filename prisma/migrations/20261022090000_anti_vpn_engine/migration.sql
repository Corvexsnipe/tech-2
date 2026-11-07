-- Anti-VPN / proxy / Tor detection engine.
--
-- Existing reviews were published under the previous policy and are grand-
-- fathered as SECURITY_CLEARED so grades do not change retroactively. New
-- reviews default to PENDING_SECURITY_CHECK and only publish once cleared.
CREATE TYPE "SecurityState" AS ENUM ('PENDING_SECURITY_CHECK', 'SECURITY_CHECK_IN_PROGRESS', 'SECURITY_CLEARED', 'FLAGGED_VPN', 'FLAGGED_PROXY', 'FLAGGED_TOR', 'FLAGGED_HIGH_RISK', 'SECURITY_CHECK_FAILED', 'MANUAL_REVIEW_REQUIRED');
CREATE TYPE "IpCategory" AS ENUM ('VPN', 'PROXY', 'TOR', 'HOSTING', 'MALICIOUS');

ALTER TABLE "Review" ADD COLUMN "ipHashVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Review" ADD COLUMN "securityState" "SecurityState" NOT NULL DEFAULT 'SECURITY_CLEARED';
ALTER TABLE "Review" ALTER COLUMN "securityState" SET DEFAULT 'PENDING_SECURITY_CHECK';
CREATE INDEX "Review_securityState_createdAt_idx" ON "Review"("securityState", "createdAt");

-- Local intelligence records. `network` is a native cidr column; the GiST
-- index makes "which ranges contain this IP" an indexed prefix lookup.
CREATE TABLE "IpIntelligenceRecord" (
  "id" TEXT NOT NULL,
  "cidr" TEXT NOT NULL,
  "network" cidr NOT NULL,
  "ipVersion" INTEGER NOT NULL,
  "category" "IpCategory" NOT NULL,
  "source" TEXT NOT NULL,
  "confidence" INTEGER NOT NULL,
  "metadata" JSONB,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  CONSTRAINT "IpIntelligenceRecord_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "IpIntelligenceRecord_source_cidr_category_key" ON "IpIntelligenceRecord"("source", "cidr", "category");
CREATE INDEX "IpIntelligenceRecord_source_idx" ON "IpIntelligenceRecord"("source");
CREATE INDEX "IpIntelligenceRecord_expiresAt_idx" ON "IpIntelligenceRecord"("expiresAt");
CREATE INDEX "IpIntelligenceRecord_network_idx" ON "IpIntelligenceRecord" USING gist ("network" inet_ops);

CREATE TABLE "IpIntelligenceFeed" (
  "id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "category" "IpCategory" NOT NULL,
  "confidence" INTEGER NOT NULL,
  "format" TEXT NOT NULL DEFAULT 'lines',
  "license" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "status" TEXT NOT NULL DEFAULT 'never',
  "lastAttemptAt" TIMESTAMP(3),
  "lastSuccessAt" TIMESTAMP(3),
  "recordsImported" INTEGER NOT NULL DEFAULT 0,
  "errorCode" TEXT,
  "errorSummary" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IpIntelligenceFeed_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "IpIntelligenceFeed_source_key" ON "IpIntelligenceFeed"("source");

CREATE TABLE "ReviewSecurityAssessment" (
  "id" TEXT NOT NULL,
  "reviewId" TEXT NOT NULL,
  "ipHash" TEXT,
  "ipHashVersion" INTEGER NOT NULL DEFAULT 1,
  "encryptedIp" TEXT,
  "riskScore" INTEGER NOT NULL DEFAULT 0,
  "classification" TEXT NOT NULL DEFAULT 'INSUFFICIENT_EVIDENCE',
  "decision" "SecurityState" NOT NULL DEFAULT 'PENDING_SECURITY_CHECK',
  "signals" JSONB NOT NULL DEFAULT '[]',
  "providerStatus" JSONB NOT NULL DEFAULT '[]',
  "datasetVersion" TEXT,
  "checkedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "nextRetryAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReviewSecurityAssessment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReviewSecurityAssessment_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ReviewSecurityAssessment_reviewId_key" ON "ReviewSecurityAssessment"("reviewId");
CREATE INDEX "ReviewSecurityAssessment_decision_nextRetryAt_idx" ON "ReviewSecurityAssessment"("decision", "nextRetryAt");
CREATE INDEX "ReviewSecurityAssessment_datasetVersion_expiresAt_idx" ON "ReviewSecurityAssessment"("datasetVersion", "expiresAt");
CREATE INDEX "ReviewSecurityAssessment_riskScore_idx" ON "ReviewSecurityAssessment"("riskScore");
CREATE INDEX "ReviewSecurityAssessment_checkedAt_idx" ON "ReviewSecurityAssessment"("checkedAt");

CREATE TABLE "ReviewSecurityAuditLog" (
  "id" TEXT NOT NULL,
  "reviewId" TEXT NOT NULL,
  "actorId" TEXT,
  "action" TEXT NOT NULL,
  "previousState" "SecurityState",
  "newState" "SecurityState",
  "reasonCode" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReviewSecurityAuditLog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReviewSecurityAuditLog_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ReviewSecurityAuditLog_reviewId_createdAt_idx" ON "ReviewSecurityAuditLog"("reviewId", "createdAt");
CREATE INDEX "ReviewSecurityAuditLog_createdAt_idx" ON "ReviewSecurityAuditLog"("createdAt");

CREATE TABLE "IpProviderCache" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "ipHash" TEXT NOT NULL,
  "result" JSONB NOT NULL,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IpProviderCache_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "IpProviderCache_provider_ipHash_key" ON "IpProviderCache"("provider", "ipHash");
CREATE INDEX "IpProviderCache_expiresAt_idx" ON "IpProviderCache"("expiresAt");

CREATE TABLE "SecurityProviderHealth" (
  "provider" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "lastAttemptAt" TIMESTAMP(3),
  "lastSuccessAt" TIMESTAMP(3),
  "lastLatencyMs" INTEGER,
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  "errorSummary" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SecurityProviderHealth_pkey" PRIMARY KEY ("provider")
);

CREATE TABLE "SecurityJobRun" (
  "id" TEXT NOT NULL,
  "job" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "summary" JSONB,
  "error" TEXT,
  CONSTRAINT "SecurityJobRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SecurityJobRun_job_startedAt_idx" ON "SecurityJobRun"("job", "startedAt");
-- Lease: at most one running instance per job name, across all processes.
CREATE UNIQUE INDEX "SecurityJobRun_running_key" ON "SecurityJobRun"("job") WHERE "status" = 'running';

-- Default public feeds. Each is fetched only by the background job, never on
-- a request path. Licensing must be verified by the operator before
-- commercial use; the dashboard shows the recorded license note.
INSERT INTO "IpIntelligenceFeed" ("id", "source", "url", "category", "confidence", "license", "updatedAt") VALUES
  ('feed_tor_exits', 'torproject-exit-list', 'https://check.torproject.org/torbulkexitlist', 'TOR', 95, 'Tor Project bulk exit list — public, free to use; attribution: torproject.org', CURRENT_TIMESTAMP),
  ('feed_x4b_vpn4', 'x4bnet-vpn-ipv4', 'https://raw.githubusercontent.com/X4BNet/lists_vpn/main/output/vpn/ipv4.txt', 'VPN', 70, 'X4BNet/lists_vpn on GitHub — MIT per repository; verify before commercial use', CURRENT_TIMESTAMP),
  ('feed_x4b_dc4', 'x4bnet-datacenter-ipv4', 'https://raw.githubusercontent.com/X4BNet/lists_vpn/main/output/datacenter/ipv4.txt', 'HOSTING', 70, 'X4BNet/lists_vpn on GitHub — MIT per repository; verify before commercial use', CURRENT_TIMESTAMP);
