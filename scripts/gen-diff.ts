import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";

if (!process.env.DATABASE_URL && existsSync(".env")) process.loadEnvFile();
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured.");

const out = execFileSync("node_modules\\.bin\\prisma.cmd", [
  "migrate", "diff", "--from-url", process.env.DATABASE_URL,
  "--to-schema-datamodel", "prisma/schema.prisma", "--script",
], { encoding: "utf8", shell: true });
writeFileSync("migration-diff.sql", out, "utf8");
console.log(out);
