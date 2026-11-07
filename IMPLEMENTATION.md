# Review Matters implementation

The supplied workspace was empty. This project uses Next.js App Router, TypeScript,
Prisma, PostgreSQL (proposed; not connected), database-backed sessions, SMTP, and
private filesystem storage. No production connection or credentials are included.

## Stages

1. Shared grading rules, provisional reputation policy, persistence schema.
2. Public website, directory, permanent business profiles, evidence viewer.
3. Authentication, account settings, customer reviews, private uploads.
4. Pending ownership claims, owner dashboard, replies, stable QR downloads/posters.
5. Administrator moderation, notifications, configuration, audit history.
6. Build, typecheck, lint, grading/security tests and browser checks.

## Database handoff — completed 2026-10-16

The provided PostgreSQL database was inspected read-only (`prisma db pull`): it was
empty, so no existing data required reconciliation. The initial schema was applied
via `migrate deploy` (`prisma/migrations/20261016214435_init`).

Note: `prisma migrate dev` cannot create a shadow database on this remote server.
For future schema changes, generate SQL with `migrate diff`, add a timestamped
migration directory, and apply with `db:deploy` (never `db push` on live data).

## Policies

- At least 3 published reviews by default before showing a definitive business grade.
- Reputation is the arithmetic mean of eligible published review scores.
- Reviews snapshot whether support was enabled. Later changes never recalculate history.
  A currently disabled support category is hidden on public cards/profiles; historical
  overall scores retain their original formula and disclose this fact.
- One non-removed review per customer per business. A database uniqueness constraint
  and transaction enforce this. Pending/rejected reviews retain their active slot.
- Reviews never publish automatically on submission. Once security checks
  clear, they wait for an explicit staff approval (Publish / Reject / Hide /
  Remove) before becoming public. Attachments and replies are moderated
  independently — approving a review never approves its proof and vice versa.
  Submissions also enforce one active review per client network (HMAC'd IP)
  per business — duplicates are held as REJECTED so a moderator can override
  false positives from shared networks or VPNs.
- All claims are pending until an administrator checks evidence and approves.
- Proof is optional, not identity verification. Images only (JPEG, PNG, WebP),
  up to 4 files, 5 MiB each. Invoice/receipt photos are supported; PDFs and active
  documents are rejected to avoid unsafe inline rendering.
- Images are decoded/re-encoded, stripped of metadata, and stored outside public/.
- Business owners cannot moderate customer reviews or edit scores.
- In-app notifications are transactional. Account emails require configured SMTP;
  failed delivery is never presented as successful delivery.

## Admin panel (`/review-matter-panel`)

A dedicated staff panel with its own sidebar layout (public header/footer hidden
on these routes). `/admin` redirects here. Access is enforced in
`src/lib/admin.ts` (`panelUser`, `requireRole`) with three staff roles:
MODERATOR < ADMIN < SUPER_ADMIN. Every privileged action passes through
`/api/action` → `performAction` with a per-action minimum role.

Modules: Overview (live metrics, date ranges, grade distribution, audit feed),
Users & Roles (search/sort/filter, bulk suspend/restore, CSV, user detail with
sessions, history, notes, role changes, deletion requests), Businesses
(verification states, create/edit/disable, owner assignment, duplicate signals,
QR links), Business Claims (assignment, approve/reject/request-info, signals),
Reviews & Moderation (pending/published/rejected/hidden/reported/appealed/
removed tabs + full record pages), Proof Attachments, Reports & Disputes
(categories, priorities, assignment, resolution), Categories (managed list,
transactional rename), Analytics & Exports (date-ranged aggregates, CSV with
permission checks and audit), Notifications & Email (editable templates with
{{name}}/{{url}} placeholders, test sends, delivery log), Admin Team,
Audit & Security (action filter, sign-in stats), Platform Settings
(minimum-reviews policy [super admin], upload limits, read-only mode),
SEO & Content (site title/description, announcement banner, sitemap/robots),
System Health (live DB/SMTP/storage/secret probes + contact inbox), and global
Search.

Schema migration `20261017103000_admin_panel` (additive only): Role gained
MODERATOR + SUPER_ADMIN; Status gained HIDDEN + INFO_REQUESTED; Claim/Report/
Review gained assignee; Report gained kind + priority; Review gained appeal
fields; User gained deletionRequestedAt; new AdminNote, EmailTemplate, EmailLog,
Category tables; PlatformConfig gained site metadata, announcement, read-only
flag, and upload limits.

## Support tickets + claim verification updates

- New business claims require a website (server-enforced in `business-claim`);
  ownership is verified through the official domain.
- `admin-domain-proof` emails a per-claim verification code to the claimant
  (or all owners for a disputed business), marks the claim INFO_REQUESTED,
  and records the code in the audit log.
- Ticket system: `Ticket` (sequential `BUS-#####` numbers via a Postgres
  sequence), `TicketMessage` (internal notes flag), `TicketEvent` (history),
  and `Attachment.ticketMessageId` reusing the private image pipeline.
- Owner UI under `/dashboard/support`; staff UI at `/review-matter-panel/support`
  (MODERATOR+; assignment requires ADMIN). Internal notes are excluded from
  owner queries and never emailed. Owner replies reopen WAITING_OWNER/RESOLVED
  tickets. Emails: new-ticket alert + owner confirmation, staff-reply and
  owner-reply notifications, status-change notices — all deduplicated via
  EmailLog.dedupeKey and logged; failures never lose ticket data.
- Operations inbox: `SUPPORT_ALERT_EMAIL` (default zaidirehan904@gmail.com).
- `serial()` transactions use a 20s timeout / 10s maxWait because the remote
  database has high round-trip latency (default 5s caused P2028 failures).

## Anti-VPN / proxy / Tor detection engine

Code lives in `src/lib/security/` and is wired into the review lifecycle,
the admin panel (`/review-matter-panel/security`) and `/api/admin/security`.

### Review lifecycle (state machine)

```
submit ─► Review(status=PENDING, securityState=PENDING_SECURITY_CHECK)
          + ReviewSecurityAssessment(ipHash, encryptedIp)        [one tx]
       ─► runSecurityCheck (after commit, time-budgeted inline, else worker)
            claim: PENDING/FAILED → SECURITY_CHECK_IN_PROGRESS   [atomic updateMany]
            providers run outside any transaction
            score → decide → apply                                [one short tx]
              CLEAN            → SECURITY_CLEARED, status PUBLISHED, confirmation email
              high band        → FLAGGED_VPN/PROXY/TOR/HIGH_RISK, status stays PENDING
                                 (PUBLISHED → HIDDEN on re-evaluation)
              medium band      → MANUAL_REVIEW_REQUIRED
              no authoritative → SECURITY_CHECK_FAILED + nextRetryAt (backoff, max
                 result            ANTI_VPN_MAX_RETRIES, then MANUAL_REVIEW_REQUIRED)
              no IP            → MANUAL_REVIEW_REQUIRED (IP_UNAVAILABLE)
```

Invariant: `status = PUBLISHED ⇒ securityState = SECURITY_CLEARED`. Moderation
(`admin-moderate`) refuses to publish anything not cleared. Every aggregate
uses `ELIGIBLE_REVIEW_WHERE` (`review-eligibility.ts`): `businessReputation`,
profile/dashboard/business-record listings and trends, admin metrics,
analytics, business review counts. Flagged, pending, held and hidden reviews
never contribute to grades, counts, trends or the published-reviews figure.
Grades are computed on read from eligible rows (no stored points ledger
exists in this platform), so recalculation is idempotent by construction and
"reversing" a review's contribution is simply its state change. Existing
reviews were grandfathered as SECURITY_CLEARED by the migration.

### Modules

| Module | Role |
|---|---|
| `config.ts` | Validates every `ANTI_VPN_*` variable once; throws on invalid values; `warnings[]` surfaces missing pieces (startup log, Security Center, System Health). |
| `cidr.ts` | Dependency-free IPv4/IPv6/CIDR parsing (RFC 5952 output), used for feed validation and trusted-proxy chains. |
| `ip-resolver.ts` | `resolveClientIp` (header-name trust via `TRUST_PROXY`, or right-to-left chain walk over `ANTI_VPN_TRUSTED_PROXY_CIDRS`), normalization, versioned HMAC (`ipHashCurrent`/`ipHashes`), AES-256-GCM at-rest IP encryption. |
| `providers/types.ts` | `IntelligenceProvider` interface, `Signal` (category, confidence, weight, correlation `group`), weights. |
| `providers/local.ts` | Local intelligence (VPN/PROXY/TOR/MALICIOUS; authoritative), network classification (HOSTING; supporting only), submission velocity (behaviour). Lookups are `network >>= ip::inet` on a GiST-indexed `cidr` column. |
| `providers/external.ts` | Optional vendor adapter (`ipapi-is` implemented, not live-verified — no key). Server-side only, IP is the only data sent, AbortSignal timeout, 3 attempts with jittered backoff, 4-way concurrency cap, per-IP-hash cache (`IpProviderCache`), health in `SecurityProviderHealth`. |
| `risk-scoring.ts` | Confidence-scaled weights → max per correlation group → noisy-OR across groups → cap `SUPPORTING_ONLY_CAP=45` without endpoint evidence; stale data ×0.7. `decide()` maps to classification/state and never clears without an authoritative OK result. |
| `review-security.ts` | `createAssessment`, `runSecurityCheck`, `runSecurityCheckWithBudget`, `manualSecurityDecision` (clear/hold/reject; original assessment kept; audited with actor + previous state). |
| `feeds.ts` | Feed download (https only, public hosts only, 25 MB cap), line parser, atomic per-source replace inside one transaction (failure keeps old data), `feedHealth`. |
| `jobs.ts` | `runSecurityJobs`: feed refresh when due, retry due checks, re-evaluate cleared reviews after a dataset change (bounded batches, cached vendor verdicts reused), purge expired cache/records and raw IPs past retention. Lease via partial unique index on `SecurityJobRun(job) WHERE status='running'`. In-process scheduler (15 min) started from `src/instrumentation.ts`; `npm run security:worker` is the cron alternative. |
| `audit.ts` | `ReviewSecurityAuditLog` writer + `redact()` for structured logs (IPs → `[ip]`, secret-like keys removed). |
| `dashboard.ts` | Aggregates for Security Center / health endpoint (counts only, no IPs/hashes/keys). |

Default scoring weights at 100% confidence: TOR 80, VPN 70, PROXY 70,
HOSTING 25, MALICIOUS 20, VELOCITY 30. Bands 0–29 low / 30–69 medium / 70–100
high (`ANTI_VPN_*_RISK_*`). A single list hit at confidence 60 scores 42 →
manual review, not rejection. Hosting + abuse + velocity together cannot
exceed 45. Scores are estimates from listed evidence, never probabilities.

### Data and privacy

- Raw IPs are never stored in `Review`. `Review.ipHash` is HMAC-SHA-256 with
  `ANTI_VPN_HMAC_SECRET` (version 2) or `APP_SECRET` (version 1, legacy rows);
  `ipHashVersion` records which. Duplicate checks match every key version so
  rotation cannot reopen a slot; the partial unique index guards races.
- `ReviewSecurityAssessment.encryptedIp` (AES-256-GCM, key derived from the
  HMAC secret) is kept so pending checks can retry, cleared reviews can be
  re-evaluated after feed updates, and staff can see which network a review
  came from. The cleanup job nulls it after `ANTI_VPN_IP_RETENTION_DAYS`
  (default 30, max 365); after that a review can only be re-checked manually
  and only if the IP is resolvable again.
- Staff visibility: `/review-matter-panel/ips` (ADMIN+) lists every reviewed
  IP decrypted on demand, with hash-version, risk and state; IP search goes
  through the deterministic HMAC so equality works despite the random IV.
  The review record's assessment panel shows the same address to admins.
- A resolved client IP that is not globally routable (loopback, private,
  CGNAT, reserved, documentation ranges) can never be verified — it holds
  the review as `MANUAL_REVIEW_REQUIRED` with reason `IP_NOT_PUBLIC` rather
  than clearing it as clean. Legitimate submissions must arrive through a
  proxy that forwards the real public client address.
- Logs, emails, the health endpoint and the dashboard carry no IPs, hashes,
  secrets or raw vendor payloads.
- IPv6 users are never merged by subnet. If a /64 policy is ever wanted it
  must be an explicit, documented anti-abuse rule with its false-positive
  trade-offs reviewed.

### Deployment

1. `npm run db:deploy` (migration `20261022090000_anti_vpn_engine`), `npm run build`.
2. Set `ANTI_VPN_*` (see `.env.example`); set `ANTI_VPN_HMAC_SECRET` (≥32 chars)
   before go-live. Rotating it later changes hash version to 2; old rows keep
   version 1 and still match during duplicate checks.
3. Reverse proxy: either `TRUST_PROXY=x-forwarded-for` with a proxy that
   **overwrites** the header, or `ANTI_VPN_TRUSTED_PROXY_CIDRS=<proxy ranges>`
   with a proxy that **appends** (client cannot prepend a fake address). The
   app cannot see the TCP peer, so one of these must hold; exposing Node
   directly with a trusted header lets clients spoof their IP.
   Behind Cloudflare use `TRUST_PROXY=cf-connecting-ip`: the header is
   honoured only when `CF-RAY` is present and `X-Forwarded-For` resolves to
   the same client, which blocks forged headers on direct traffic — but the
   origin must still accept Cloudflare traffic only (firewall rules or
   Cloudflare Tunnel), since the TCP peer is invisible to the application.
4. Import feeds once: `npm run security:worker -- --feeds`. Until the first
   import succeeds new reviews stay pending (fail-closed).
5. Scheduling: single instance → leave `ANTI_VPN_INPROCESS_SCHEDULER=true`;
   multiple instances → set it `false` and cron `npm run security:worker`
   every 15 minutes. Both may run together; the lease serialises them.
6. Optional vendor: `ANTI_VPN_EXTERNAL_PROVIDER=ipapi-is`,
   `ANTI_VPN_EXTERNAL_API_KEY=…`. Verify the adapter against the vendor's
   current response format and licence/cache terms before relying on it.
7. Monitoring: `GET /api/admin/security` (staff session) returns
   `status: ok|attention` + `warnings[]`; alert on `attention`, on
   `dataset.stale`, on provider `consecutiveFailures ≥ 3`, and on `totals.manual`
   growth. System Health also shows the engine row.
8. Rollback: set `ANTI_VPN_ENABLED=false` (reviews skip detection and mark
   cleared on their next check with reason `DETECTION_DISABLED`; they still
   await staff approval before publishing).
   The migration is additive; dropping it is not required.

### Known limitations

- Local-only mode detects only endpoints present in the imported lists; new,
  residential, rotating and private VPN exits are not covered. The three
  seeded feeds are IPv4 only — IPv6 reviews are checked against them but
  will rarely match until an IPv6 feed is added.
- Feed licences must be verified by the operator for commercial use; the
  dashboard records the licence note per feed.
- The `ipapi-is` adapter was written from the vendor's documented fields and
  has not been exercised against the live API in this environment.
- Reviews rejected for duplicate IP free the network slot (existing policy);
  a VPN-flagged review that staff reject therefore also frees it.

## Domain-based review profiles

- `Business.domain` (unique, normalized: scheme/www/port/path stripped) stores
  the official domain; new claims require it alongside the website and must
  match the website host.
- Public profiles live at `/review/<domain>` (legacy slugs still resolve and
  redirect to the canonical address). `/business/:slug` and
  `/business/:slug/review` issue real 308s via next.config redirects; the
  write-a-review form is `/review/<domain>/write`.
- New registrations get `slug = domain`. Existing businesses keep name-based
  slugs; `domain` was backfilled from `website` (oldest listing wins on
  collisions) and is resynced whenever the website changes in
  business-update / admin-business-edit / admin-business-create.
- QR codes, posters, sitemap, and every internal link use `/review/<domain>`.
- Mail delivery resolves SMTP hosts via the OS resolver (`dns.lookup`) to
  sidestep broken resolver configs (e.g. a VPN's dead loopback DNS), with the
  real hostname preserved through TLS SNI. All ticket/notification sends retry
  transient failures (3 attempts) and release their dedupe key on failure so
  legitimate resends are never blocked.
