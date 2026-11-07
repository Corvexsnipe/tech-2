import { existsSync } from "node:fs";
if (!process.env.DATABASE_URL && existsSync(".env")) process.loadEnvFile();
async function main() {
  const { db } = await import("../src/lib/db");
  const { runSecurityCheck } = await import("../src/lib/security/review-security");
  const r = await db().review.findFirstOrThrow({ orderBy: { createdAt: "desc" }, where: { securityAssessment: { isNot: null } } });
  const out = await runSecurityCheck(r.id, { force: true });
  console.log(`${r.headline} → ${out.state} · ${out.published ? "published" : "not published"} · ${out.decision?.reasonCode}`);
  await db().$disconnect();
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
