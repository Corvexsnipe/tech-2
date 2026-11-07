"use client";
export default function GlobalError() {
  return <html lang="en"><body style={{ fontFamily: "Arial", padding: 50 }}><h1>Review Matters is temporarily unavailable.</h1><p>Please try again shortly.</p><button onClick={() => window.location.reload()}>Reload this page</button></body></html>;
}
