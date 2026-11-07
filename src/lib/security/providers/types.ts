export type SignalCategory = "VPN" | "PROXY" | "TOR" | "HOSTING" | "MALICIOUS" | "VELOCITY";

// One piece of evidence. `group` identifies the underlying dataset family so
// correlated signals (e.g. two lists derived from the same upstream) are
// collapsed instead of summed. `weight` is the maximum contribution at 100%
// confidence; the scoring engine scales it by confidence.
export interface Signal {
  code: string;
  category: SignalCategory;
  source: string;
  confidence: number;
  weight: number;
  group: string;
  detail: string;
  observedAt: string;
}

export type ProviderStatus = "ok" | "error" | "timeout" | "stale" | "disabled" | "unconfigured";

export interface ProviderResult {
  provider: string;
  kind: "local" | "asn" | "external" | "behavior";
  status: ProviderStatus;
  // Only "authoritative" providers can clear a review on their own.
  authoritative: boolean;
  signals: Signal[];
  latencyMs: number;
  datasetVersion?: string;
  error?: string;
}

export interface CheckInput {
  ip: string;
  ipHashes: string[];
  reviewId: string;
  businessId: string;
  userId: string;
}

export interface IntelligenceProvider {
  readonly name: string;
  readonly kind: ProviderResult["kind"];
  check(input: CheckInput): Promise<ProviderResult>;
}

export const SIGNAL_WEIGHTS: Record<SignalCategory, number> = {
  TOR: 80, VPN: 70, PROXY: 70, HOSTING: 25, MALICIOUS: 20, VELOCITY: 30,
};

export function failedResult(provider: string, kind: ProviderResult["kind"], status: ProviderStatus, error: string, latencyMs: number, authoritative: boolean): ProviderResult {
  return { provider, kind, status, authoritative, signals: [], latencyMs, error };
}
