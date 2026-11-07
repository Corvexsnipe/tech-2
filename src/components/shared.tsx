import Link from "next/link";
import { Search, ChevronLeft, ChevronRight } from "lucide-react";
import { configured } from "@/lib/db";
import { gradeFor } from "@/lib/grades";

export function SetupNotice() {
  if (configured()) return null;
  return <div className="notice warning" role="status">Platform setup is in progress. Live business data and account actions will be available after the database is connected. No customer data or ratings are being simulated.</div>;
}
export function EmptyState({ title, description, href, label }: { title: string; description: string; href?: string; label?: string }) {
  return <div className="empty-state"><span className="feature-icon"><Search /></span><h2>{title}</h2><p>{description}</p>{href && <Link href={href} className="button primary">{label || "Get started"}</Link>}</div>;
}
export function PageHeading({ eyebrow, title, description }: { eyebrow?: string; title: string; description?: string }) {
  return <div className="page-heading">{eyebrow && <span className="eyebrow purple">{eyebrow}</span>}<h1>{title}</h1>{description && <p>{description}</p>}</div>;
}
export function Pagination({ page, total, pageSize = 12, base, query = {} }: { page: number; total: number; pageSize?: number; base: string; query?: Record<string, string> }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1 && page === 1) return null;
  const href = (value: number) => `${base}?${new URLSearchParams({ ...query, page: String(value) })}`;
  return <nav className="pagination" aria-label="Pagination">{page > 1 && <Link href={href(page - 1)} className="button secondary small"><ChevronLeft size={14} /> Previous</Link>}<span>Page {page} of {pages}</span>{page < pages && <Link href={href(page + 1)} className="button secondary small">Next <ChevronRight size={14} /></Link>}</nav>;
}
export function Trend({ data }: { data: { month: string; score: number; count: number }[] }) {
  if (data.length < 3) return <p className="trend-caption">A reputation trend appears after reviews span at least three months.</p>;
  return <><div className="trend-bars" role="img" aria-label={data.map(d => `${d.month}: ${d.score.toFixed(1)} from ${d.count} reviews`).join("; ")}>{data.map(d => <div key={d.month} className="trend-bar" style={{ height: `${d.score}%` }} title={`${d.month}: ${d.score.toFixed(1)} (${d.count} reviews)`}><span>{new Date(`${d.month}-01T00:00:00Z`).toLocaleDateString("en", { month: "short", timeZone: "UTC" })}</span></div>)}</div><p className="trend-caption">Monthly averages of published reviews. Individual months may have limited data.</p></>;
}
export function ReputationPanel({ stats, supportEnabled }: { stats: { count: number; score: number | null; service: number | null; support: number | null; grade: string | null; minimum: number }; supportEnabled: boolean }) {
  return <section className="panel reputation-panel"><span className="eyebrow">BUSINESS REPUTATION</span>{stats.grade ? <><div className="reputation-score"><strong>{stats.grade}</strong><span>{stats.score!.toFixed(1)} / 100</span></div><p>Based on {stats.count} published {stats.count === 1 ? "review" : "reviews"}.</p></> : <><h3 style={{ marginTop: 16 }}>Not yet rated</h3><p>{stats.count} published {stats.count === 1 ? "review" : "reviews"}. At least {stats.minimum} are needed for a public grade.</p>{stats.score !== null && <p>Provisional average: {stats.score.toFixed(1)} / 100</p>}</>}
    {stats.service !== null && <div className="category-stat"><span>Service Quality</span><b>{stats.grade ? `${gradeFor(stats.service)} · ` : "Provisional · "}{stats.service.toFixed(1)}</b></div>}
    {supportEnabled && stats.support !== null && <div className="category-stat"><span>Customer Support</span><b>{stats.grade ? `${gradeFor(stats.support)} · ` : "Provisional · "}{stats.support.toFixed(1)}</b></div>}
    <p style={{ marginTop: 17, fontSize: 10 }}>An arithmetic mean of published review scores. Historical reviews keep their original category configuration.</p>
  </section>;
}
