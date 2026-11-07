"use client";
import Link from "next/link";

export default function PanelError({ error, reset }: { error: Error; reset: () => void }) {
  return <div className="panel" style={{ margin: "40px 0" }} role="alert">
    <h2 style={{ fontSize: 26 }}>This section is unavailable.</h2>
    <p style={{ margin: "12px 0 20px" }}>{error.message || "The requested view could not be loaded."}</p>
    <div className="button-row">
      <button className="button primary" onClick={reset}>Try again</button>
      <Link href="/review-matter-panel" className="button secondary">Back to overview</Link>
    </div>
  </div>;
}
