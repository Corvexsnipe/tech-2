import type { Prisma, SecurityState } from "@prisma/client";
import { db } from "../db";

type Tx = Prisma.TransactionClient;

// Removes anything that looks like an IP address or a secret from values
// that reach logs. Structured security logs never include request bodies.
const IP_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b|\b(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}\b/gi;
const SECRET_KEYS = /(apikey|api_key|secret|token|password|authorization|cookie|^ip$|clientip|client_ip|remoteip|remote_ip|ipaddress|ip_address|^address$)/i;
export function redact<T>(value: T): T {
  if (typeof value === "string") return value.replace(IP_RE, "[ip]") as T;
  if (Array.isArray(value)) return value.map(redact) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = SECRET_KEYS.test(k) ? "[redacted]" : redact(v);
    return out as T;
  }
  return value;
}

export function securityLog(event: string, fields: Record<string, unknown> = {}) {
  console.info(JSON.stringify({ event: `security.${event}`, at: new Date().toISOString(), ...redact(fields) }));
}

export interface AuditEntry {
  reviewId: string; actorId?: string | null; action: string;
  previousState?: SecurityState | null; newState?: SecurityState | null;
  reasonCode: string; metadata?: Prisma.InputJsonValue;
}
export function securityAudit(tx: Tx | ReturnType<typeof db>, entry: AuditEntry) {
  return tx.reviewSecurityAuditLog.create({ data: {
    reviewId: entry.reviewId, actorId: entry.actorId ?? null, action: entry.action,
    previousState: entry.previousState ?? null, newState: entry.newState ?? null,
    reasonCode: entry.reasonCode, metadata: entry.metadata ? redact(entry.metadata) : undefined,
  } });
}
