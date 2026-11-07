import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
import { existsSync } from "node:fs";

if (!process.env.DATABASE_URL && existsSync(".env")) process.loadEnvFile();

async function main() {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!process.env.DATABASE_URL || !email) throw new Error("Set DATABASE_URL and BOOTSTRAP_ADMIN_EMAIL through your secure environment.");
  const prisma = new PrismaClient({ log: [] });
  try {
    await prisma.$transaction(async tx => {
      if (await tx.user.count({ where: { role: { in: ["ADMIN", "SUPER_ADMIN"] } } })) throw new Error("A privileged administrator already exists. Bootstrap is disabled.");
      const existing = await tx.user.findUnique({ where: { email } });
      if (existing) {
        if (!existing.verifiedAt || existing.disabledAt) throw new Error("Register and verify an active account before bootstrapping.");
        await tx.user.update({ where: { id: existing.id }, data: { role: "SUPER_ADMIN" } });
      } else {
        if (!password || password.length < 8 || Buffer.byteLength(password, "utf8") > 72) throw new Error("New administrators require BOOTSTRAP_ADMIN_PASSWORD (8–72 bytes) supplied through the environment.");
        await tx.user.create({ data: {
          email, displayName: "Platform Administrator", passwordHash: await hash(password, 12),
          role: "SUPER_ADMIN", verifiedAt: new Date(),
        } });
      }
      const target = (await tx.user.findUniqueOrThrow({ where: { email } })).id;
      await tx.auditLog.create({ data: { actorId: target, action: "admin-bootstrap", targetId: target, detail: "Initial super administrator created by operator CLI." } });
    }, { isolationLevel: "Serializable" });
    console.log("Initial super administrator ready. No credentials were printed.");
  } finally { await prisma.$disconnect(); }
}
main().catch(error => { console.error(error instanceof Error && !error.name.startsWith("Prisma") ? error.message : "Administrator bootstrap failed. Check database configuration privately."); process.exitCode = 1; });
