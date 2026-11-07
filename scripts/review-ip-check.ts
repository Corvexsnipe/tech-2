import { existsSync } from "node:fs";
if (!process.env.DATABASE_URL && existsSync(".env")) process.loadEnvFile();
async function main() {
  const { db } = await import("../src/lib/db");
  const { decryptIp } = await import("../src/lib/security/ip-resolver");
  const rows = await db().review.findMany({ orderBy: { createdAt: "desc" }, take: 6, include: { securityAssessment: true, user: { select: { email: true } }, business: { select: { name: true } } } });
  for (const r of rows) {
    const a = r.securityAssessment;
    const ip = decryptIp(a?.encryptedIp);
    console.log(`${r.createdAt.toISOString()} ${r.business.name} | ${r.user.email} | ${r.status}/${r.securityState}`);
    console.log(`   ip=${ip ? ip.replace(/\d+$/, "x") : "none"} hashVer=${r.ipHashVersion} score=${a?.riskScore} class=${a?.classification} dataset=${a?.datasetVersion}`);
    console.log(`   providers=${JSON.stringify(a?.providerStatus)}`);
    console.log(`   signals=${JSON.stringify(a?.signals)}`);
  }
  const audit = await db().reviewSecurityAuditLog.findMany({ where: { reviewId: rows[0]?.id }, orderBy: { createdAt: "asc" } });
  console.log("audit:", audit.map(a => `${a.action}:${a.reasonCode}:${a.previousState}->${a.newState}`).join(" | "));
  await db().$disconnect();
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
