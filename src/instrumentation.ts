// Runs once per server process at startup (Next.js instrumentation hook).
// Validates the anti-VPN configuration — an invalid value fails loudly here
// instead of degrading detection silently — and starts the in-process job
// scheduler unless the deployment runs the cron worker instead.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.DATABASE_URL) return;
  const { securityConfig } = await import("./lib/security/config");
  const { securityLog } = await import("./lib/security/audit");
  const config = securityConfig();
  for (const warning of config.warnings) securityLog("config_warning", { warning });
  securityLog("config_loaded", { enabled: config.enabled, mode: config.mode, failClosed: config.failClosed, externalProvider: config.externalProvider, hmacVersion: config.hmacVersion });
  if (config.enabled && config.inProcessScheduler) {
    const { startInProcessScheduler } = await import("./lib/security/jobs");
    startInProcessScheduler();
  }
}
