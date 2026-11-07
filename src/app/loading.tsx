export default function Loading() {
  return <div className="container page-main" role="status" aria-label="Loading page"><div className="loading-skeleton" style={{ height: 70, maxWidth: 430 }} /><div className="loading-skeleton" /><div className="loading-skeleton" /><span className="sr-only">Loading…</span></div>;
}
