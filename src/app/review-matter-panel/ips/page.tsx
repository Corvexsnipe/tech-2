import Link from "next/link";
import { Prisma, SecurityState } from "@prisma/client";
import { panelUser } from "@/lib/admin";
import { db } from "@/lib/db";
import { pageNumber } from "@/lib/data";
import { securityConfig } from "@/lib/security/config";
import { decryptIp, ipHashes } from "@/lib/security/ip-resolver";
import { parseIp } from "@/lib/security/cidr";
import { EmptyState, Pagination } from "@/components/shared";
import { StatusPill } from "@/components/admin-blocks";
import { RiskBadge, SecurityStatePill, STATE_LABELS } from "@/components/security-blocks";

const BASE = "/review-matter-panel/ips";
const STATES = Object.keys(STATE_LABELS) as SecurityState[];

// Reviewer network identities. IPs are stored AES-256-GCM encrypted at rest
// (key derived from ANTI_VPN_HMAC_SECRET) and purged after
// ANTI_VPN_IP_RETENTION_DAYS — this page decrypts them for staff only.
export default async function ReviewIpLog({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await panelUser("ADMIN");
  const params = await searchParams;
  const state = STATES.includes(params.state as SecurityState) ? (params.state as SecurityState) : undefined;
  const q = (params.q || "").slice(0, 100);
  const page = pageNumber(params.page), take = 25, skip = (page - 1) * take;
  const config = securityConfig();

  // Searching a literal IP matches by HMAC hash — the column is encrypted with
  // a random IV, so equality must go through the deterministic hash.
  const parsedQ = parseIp(q);
  const search: Prisma.ReviewWhereInput = parsedQ
    ? { ipHash: { in: ipHashes(parsedQ.text) } }
    : q
      ? { OR: [{ headline: { contains: q, mode: "insensitive" } }, { business: { name: { contains: q, mode: "insensitive" } } }, { user: { email: { contains: q, mode: "insensitive" } } }] }
      : {};
  const where: Prisma.ReviewWhereInput = {
    securityAssessment: { isNot: null },
    ...(state ? { securityState: state } : {}),
    ...search,
  };
  const [rows, count] = await Promise.all([
    db().review.findMany({ where, orderBy: { createdAt: "desc" }, take, skip, include: { securityAssessment: true, business: { select: { name: true } }, user: { select: { displayName: true, email: true } } } }),
    db().review.count({ where }),
  ]);
  const query = { state: state ?? "", q };

  return <>
    <div className="page-heading"><span className="eyebrow purple">REVIEW IP LOG</span><h1>Reviewer network addresses.</h1>
      <p>The client IP each review was submitted from, decrypted for staff. Stored encrypted at rest and purged {config.ipRetentionDays} days after the assessment was created. Never shown publicly; used for duplicate enforcement and security verification.</p></div>

    <form className="search-bar" style={{ gridTemplateColumns: "2fr 1fr auto" }} action={BASE}>
      <input name="q" aria-label="Search" defaultValue={q} placeholder="IP address, business, headline, or reviewer email…" maxLength={100} />
      <label><span className="sr-only">State</span><select name="state" defaultValue={state ?? ""}><option value="">Any state</option>{STATES.map(s => <option key={s} value={s}>{STATE_LABELS[s]}</option>)}</select></label>
      <button className="button primary">Filter</button>
    </form>

    {count === 0 ? <EmptyState title="No reviews found." description="Reviews with a security assessment will appear here." /> :
      <table className="data-table"><thead><tr><th>Client IP</th><th>Review</th><th>Business</th><th>Risk</th><th>Security state</th><th>Review status</th><th>Submitted</th><th></th></tr></thead><tbody>
        {rows.map(r => {
          const ip = decryptIp(r.securityAssessment?.encryptedIp);
          return <tr key={r.id}>
            <td>{ip ? <code>{ip}</code> : <small style={{ color: "var(--muted)" }}>{r.securityAssessment?.encryptedIp === null && r.securityAssessment?.ipHash ? "purged" : "unresolved"}</small>}<br /><small style={{ color: "var(--muted)" }}>hash v{r.ipHashVersion}</small></td>
            <td><strong>{r.headline}</strong><br /><small style={{ color: "var(--muted)" }}>{r.user.displayName} · {r.user.email}</small></td>
            <td>{r.business.name}</td>
            <td>{r.securityAssessment ? <RiskBadge score={r.securityAssessment.riskScore} bands={{ lowRiskMax: config.lowRiskMax, highRiskMin: config.highRiskMin }} /> : "—"}</td>
            <td><SecurityStatePill state={r.securityState} /></td>
            <td><StatusPill status={r.status} /></td>
            <td><small>{r.createdAt.toLocaleString()}</small></td>
            <td><Link className="text-link" href={`/review-matter-panel/reviews/${r.id}`}>Open →</Link></td>
          </tr>;
        })}
      </tbody></table>}
    <Pagination base={BASE} query={query} page={page} total={count} pageSize={take} />
  </>;
}
