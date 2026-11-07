"use client";
import Link from "next/link";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <div className="container page-main"><div className="empty-state"><h2>We couldn’t load this page.</h2><p>Something went wrong while loading the information. Please try again in a moment.</p><div className="button-row" style={{ justifyContent: "center" }}><button className="button primary" onClick={reset}>Try again</button><Link href="/" className="button secondary">Back to home</Link></div></div></div>;
}
