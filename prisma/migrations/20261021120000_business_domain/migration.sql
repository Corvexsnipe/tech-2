-- Adds the normalized business domain used for /review/<domain> profiles.
-- Backfill derives the domain from the website; when several listings point
-- at the same domain the oldest keeps it and the rest stay NULL (they remain
-- reachable through their slug) so the unique index can be created.
ALTER TABLE "Business" ADD COLUMN "domain" TEXT;

WITH derived AS (
  SELECT id,
         lower(regexp_replace(regexp_replace(regexp_replace(regexp_replace(website, '^[a-zA-Z][a-zA-Z0-9+.-]*://', ''), '^[^@/]*@', ''), '^www\.', ''), '[/?#:].*$', '')) AS domain,
         ROW_NUMBER() OVER (
           PARTITION BY lower(regexp_replace(regexp_replace(regexp_replace(regexp_replace(website, '^[a-zA-Z][a-zA-Z0-9+.-]*://', ''), '^[^@/]*@', ''), '^www\.', ''), '[/?#:].*$', ''))
           ORDER BY "createdAt" ASC, id ASC
         ) AS rn
  FROM "Business"
  WHERE website IS NOT NULL AND website <> ''
)
UPDATE "Business" b SET domain = d.domain FROM derived d WHERE b.id = d.id AND d.rn = 1;

CREATE UNIQUE INDEX "Business_domain_key" ON "Business"("domain");
