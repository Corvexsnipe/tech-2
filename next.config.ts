import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["sharp"],
  // Business profiles moved to /review/<domain>. Real 308s fire before
  // rendering so search engines and printed QR codes keep working.
  async redirects() {
    return [
      { source: "/business/:slug", destination: "/review/:slug", permanent: true },
      { source: "/business/:slug/review", destination: "/review/:slug/write", permanent: true },
    ];
  },
  async headers() {
    const scriptSources = `'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`;
    const connectSources = `'self'${process.env.NODE_ENV === "development" ? " ws: wss:" : ""}`;
    return [{
      source: "/(.*)",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "Content-Security-Policy", value: `default-src 'self'; script-src ${scriptSources}; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src ${connectSources}; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` },
        ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
      ],
    }];
  },
};
export default config;
