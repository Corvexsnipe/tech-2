import Link from "next/link";
export default function NotFound() {
  return <div className="container page-main"><div className="empty-state"><span className="eyebrow purple">404 · PAGE NOT FOUND</span><h2 style={{ marginTop: 15 }}>This page has moved on.</h2><p>The page or business may be unavailable. Let’s help you find a new starting point.</p><Link href="/explore" className="button primary">Explore businesses</Link></div></div>;
}
