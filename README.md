# Review Matters

A Next.js / TypeScript review platform for **https://reviewmatters.org**. The supplied
workspace was empty; no application or existing database records were replaced.

**Database integration is pending the actual connection details.** No database has
been connected or modified. The PostgreSQL Prisma schema is a proposal to reconcile
with the existing database, not an instruction to replace it.

## Run locally

Use Node.js 22 LTS or a compatible supported version.

```sh
npm ci
npm run db:generate
npm run dev
```

Open http://localhost:3000. Without a database, public educational pages work and
directory/account actions show honest setup or authentication states. There are no
fabricated businesses, ratings, testimonials, or seeded production users.
The homepage uses labeled scoring illustrations, not customer testimonials.

Create `.env` from `.env.example`, keeping secrets out of source control. Next loads
`.env` automatically; Prisma CLI also reads it. CLI scripts expect variables exported
in their process environment (or use Node's `--env-file=.env` option with `tsx`).

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Actual approved database connection; wait for schema inspection |
| `APP_URL` | Exact origin: `http://localhost:3000` locally, `https://reviewmatters.org` in production |
| `APP_SECRET` | Cryptographically random secret of at least 32 characters; hashes rate-limit identities |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` | TLS email delivery; port 587/STARTTLS or 465/TLS |
| `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | Email authentication and sender identity |
| `UPLOAD_DIR` | Absolute persistent private directory, outside `public/` |
| `BOOTSTRAP_ADMIN_EMAIL` | Operator-only initial verified administrator account |

Generate a secret locally with a secure password manager or
`node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"`.
Do not paste that output into source files, tickets, or logs.

## Implemented flows

- Responsive homepage, interactive 3D walkthrough, grade explanation, privacy, terms,
  contact intake, and business onboarding.
- Database-backed directory with name search, category filter, sorting, pagination,
  stable profile URLs, published reviews, provisional grades, and monthly trends.
- Registration, bcrypt password hashes, verification, reset, session revocation,
  protected routes, profile settings, status history, and in-app notifications.
- Category-based reviews, exact grade rules, optional support snapshots, pending
  publication, and transaction + unique-key duplicate prevention.
- Up to four optional proof images with upload progress, server-side magic-byte checks,
  full image decoding/re-encoding, metadata removal, ownership checks, and keyboard
  accessible evidence dialogs. PDFs and executable documents are not accepted.
- Claims remain pending until independent administrator verification. Owners can edit
  business details and logos, respond to reviews, manage support settings, and access QR
  downloads and print posters.
- High-resolution 1600px PNG and SVG QR downloads encode the permanent canonical URL.
  Generated images use a bounded cache; ownership and availability are checked on each
  request. Names may change without changing slugs.
- A full admin panel at `/review-matter-panel` (staff roles: Moderator, Admin,
  Super Admin): overview metrics with date ranges, user/role management with bulk
  actions and deletion requests, business management and ownership assignment,
  claim review with assignment and info requests, review moderation with hide and
  appeal workflows, proof-attachment queues, categorized reports with priorities,
  managed categories, analytics with CSV exports, editable email templates with a
  delivery log, admin team overview, audit and sign-in security log, platform
  settings, SEO/announcement controls, and live integration health checks.
  `/admin` redirects here. Every metric reads live database rows.
- Server-side permissions, same-origin write checks, database-backed rate limits,
  private storage, safe errors, secure production cookies, and security headers.

Customer uploads and business logos use a private filesystem volume. Production
needs persistent shared storage if running multiple instances; ephemeral serverless
filesystems are unsuitable without replacing this adapter with private object storage.

## Database — connected

The provided PostgreSQL database was inspected read-only first: it was empty, so
`prisma/migrations/20261016214435_init` was applied with `prisma migrate deploy`
and all application tables now exist. `20261017103000_admin_panel` added roles,
assignment/appeal fields, staff notes, email templates/logs, and categories —
all additive, no data touched. A smoke test verified real connectivity,
unique `activeKey` duplicate-review enforcement, and clean teardown.
SMTP is configured through ZeptoMail and a test delivery was accepted.

For future schema changes: this remote server does not allow `migrate dev`'s
shadow database. Generate SQL with `prisma migrate diff --from-migrations
--to-schema-datamodel prisma/schema.prisma --script`, add a timestamped
migration folder, and apply with `npm run db:deploy`. Never run `db push` or
`migrate reset` against live data. Back up before each migration.

The first Super Admin was created with `npm run admin:bootstrap` using
`BOOTSTRAP_ADMIN_EMAIL` (and `BOOTSTRAP_ADMIN_PASSWORD` when creating a new
account). The script refuses to run once a privileged account exists and never
creates or prints a default password. Change the initial password after first
sign-in from Account settings.

## Review and moderation policies

Category points: **A+ 100, A 80, B 70, C 50, D 15**. The two categories have equal weight
when support is enabled; otherwise Service Quality determines the score.
Thresholds: **A+ ≥90, A ≥80, B ≥70, C ≥50, D <50**. Scores are never rounded before grading.

Business reputation is the arithmetic mean of published review scores. The initial
minimum is three reviews, configurable upward by an administrator. Smaller samples
show a provisional average without a definitive grade.

Reviews snapshot their category configuration. Disabling support hides that category
on public forms/cards/profiles, while historical scores retain their original formula.
An explanatory note keeps those historical scores interpretable.

The active review slot is a database unique key derived from the account and business.
Pending, published, and rejected reviews keep their slot; withdrawal/removal releases it.
Restoring a removed review conflicts if a replacement already occupies the slot.

Evidence, reviews, and business replies have independent moderation states. Publishing
a review does not publish its attachments automatically. Evidence is never presented
as a guarantee of authenticity. An administrator cannot moderate their own submissions
or decide their own business claim.

## Verification

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run test:browser
```

Browser tests expect the server at `TEST_BASE_URL` (default localhost:3000), no configured
database, and installed Chrome. They cover public navigation, walkthrough and proof
dialogs, mobile overflow, protected redirects, CSRF rejection, and setup errors.
Core tests cover all grade combinations, threshold boundaries, provisional aggregates,
upload rejection/sanitization, evidence permissions, password hashing, and decoded QR
destinations. Database transactions and SMTP delivery require real integration testing
after handoff; pure unit/browser checks are not substitutes for those tests.

## Deployment

### Coolify

The repo ships a `Dockerfile` and `docker-compose.yml` — both work with Coolify.

**Dockerfile deploy (external Postgres, simplest):**

1. New Resource → **Dockerfile** (or Git repo with Dockerfile build pack).
2. Set the environment variables below in Coolify's panel; expose port **3000**.
3. Mount a persistent volume at `/app/private-uploads` (proof attachments are
   stored on disk, outside `public/` by design).
4. The container runs `prisma migrate deploy` on every start, then `next start`.
   `/api/health` is used for health checks.

**Docker Compose deploy (app + Postgres, self-contained):**

1. New Resource → **Docker Compose** → the included `docker-compose.yml`
   starts `app` + `postgres` with volumes for data and uploads.
2. To use an existing database instead, delete the `db` service and set your
   own `DATABASE_URL`.

**Required environment variables:**

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | Postgres connection string (compose default points at the bundled `db` service) |
| `APP_URL` | `https://yourdomain.tld` — must match the public origin (CSRF + links) |
| `APP_SECRET` | ≥32 chars; sessions/hashing |
| `UPLOAD_DIR` | `/app/private-uploads` (must be a persistent volume) |
| `TRUST_PROXY` | `x-forwarded-for` behind Coolify's Traefik (it always sets the header). Behind Cloudflare use `cf-connecting-ip` and firewall the origin to CF ranges |
| `ANTI_VPN_HMAC_SECRET` | ≥32 chars; deduplicates reviewers by hashed IP |
| `SMTP_*`, `MAIL_FROM` | ZeptoMail/SES etc. |
| `SUPPORT_ALERT_EMAIL` | Operations inbox |

**After first deploy:** `docker exec <container> npx tsx scripts/bootstrap-admin.ts`
to create the staff account, then `npx tsx scripts/security-worker.ts --feeds`
once to import IP intelligence feeds (the in-process scheduler keeps them fresh).

### Manual

1. Complete database and SMTP handoff above; provision private persistent uploads.
2. Run `npm ci`, `npm run build`, then `npm start` behind an HTTPS reverse proxy.
3. Point DNS for `reviewmatters.org` to the approved hosting deployment and install TLS.
   Set `APP_URL=https://reviewmatters.org`; preserve the browser's Origin header.
4. Limit request bodies to 5 MiB plus small proxy overhead; set timeouts and global edge
   request limits. App-level review limits use authenticated user IDs, not shared IPs.
5. Check `/api/health`; it returns 503 while setup is incomplete and 200 when the database
   is reachable. Back up the database and private upload volume together.
6. Schedule maintenance to expire sessions, account tokens, rate buckets, and orphaned
   pre-submission uploads. Preserve moderation/audit records according to your retention policy.
6b. Anti-VPN engine: set `ANTI_VPN_HMAC_SECRET` and the proxy trust variables, run
   `npm run security:worker -- --feeds` once to import intelligence feeds, then either keep
   `ANTI_VPN_INPROCESS_SCHEDULER=true` (single instance) or cron `npm run security:worker`
   every 15 minutes. Monitor `GET /api/admin/security` (staff session). Reviews stay pending
   until a check clears them; see IMPLEMENTATION.md for the state machine, privacy model,
   provider setup, rollback (`ANTI_VPN_ENABLED=false`) and known limitations.
7. Verify a real signup/verification/reset, customer review, ownership decision, evidence
   moderation, business reply, and scanned printed QR on staging before public release.

No DNS, hosting, production credentials, or email-provider access was supplied, so no
deployment or live email-delivery claim is made. Account email changes/deletion requests
use the administrator contact workflow. Avatars and automated ownership verification
are not implemented. The operator should finalize the legal policies for its jurisdiction,
contact entity, service providers, and retention obligations before launch.
