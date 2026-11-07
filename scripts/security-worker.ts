import { existsSync } from "node:fs";
if (!process.env.DATABASE_URL && existsSync(".env")) process.loadEnvFile();

// Cron entry point for the anti-VPN maintenance jobs: feed refresh, retries,
// re-evaluation and cleanup. Safe to run alongside the in-process scheduler
// (a database lease prevents concurrent runs).
//   npx tsx scripts/security-worker.ts            # run once
//   npx tsx scripts/security-worker.ts --feeds    # force every feed to refresh
//   npx tsx scripts/security-worker.ts --loop     # run every 15 minutes
async function main() {
  const { runSecurityJobs } = await import("../src/lib/security/jobs");
  const { securityConfig } = await import("../src/lib/security/config");
  const config = securityConfig();
  for (const warning of config.warnings) console.warn("warning:", warning);
  const once = async () => {
    const summary = await runSecurityJobs({ forceFeeds: process.argv.includes("--feeds") });
    console.log(JSON.stringify(summary));
  };
  if (process.argv.includes("--loop")) {
    while (true) { await once().catch(error => console.error("run failed:", error instanceof Error ? error.name : "Error")); await new Promise(r => setTimeout(r, 15 * 60_000)); }
  } else await once();
  const { db } = await import("../src/lib/db");
  await db().$disconnect();
}
main().catch(error => { console.error("security worker failed:", error instanceof Error ? error.message : "unknown"); process.exitCode = 1; });
