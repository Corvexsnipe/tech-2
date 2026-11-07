import type { ProviderResult, Signal, SignalCategory } from "./providers/types";

export const CLASSIFICATIONS = ["CLEAN", "VPN_DETECTED", "PROXY_DETECTED", "TOR_DETECTED", "SUSPICIOUS_NETWORK", "INSUFFICIENT_EVIDENCE", "DETECTION_ERROR", "DATA_STALE", "MANUAL_REVIEW_REQUIRED"] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

export interface Contribution { group: string; category: SignalCategory; source: string; code: string; confidence: number; contribution: number; detail: string }
export interface Scored { score: number; contributions: Contribution[]; endpointCategory: "VPN" | "PROXY" | "TOR" | null; endpointEvidence: boolean }

const ENDPOINT: SignalCategory[] = ["VPN", "PROXY", "TOR"];
// Hosting, abuse lists and velocity are supporting signals: without any
// endpoint evidence the score cannot leave the medium band.
export const SUPPORTING_ONLY_CAP = 45;
export const STALE_FACTOR = 0.7;

// Deterministic, explainable score:
//  1. scale each signal by confidence (and by STALE_FACTOR if its provider's
//     data is stale);
//  2. keep only the strongest signal per correlation group;
//  3. combine groups with noisy-OR so independent evidence compounds but
//     never exceeds 100 and is never a blind sum;
//  4. cap at SUPPORTING_ONLY_CAP when no VPN/PROXY/TOR signal exists.
export function scoreSignals(results: ProviderResult[]): Scored {
  const staleProviders = new Set(results.filter(r => r.status === "stale").map(r => r.provider));
  const byGroup = new Map<string, { signal: Signal; value: number; stale: boolean }>();
  for (const r of results) {
    for (const s of r.signals) {
      const stale = staleProviders.has(r.provider);
      const value = Math.max(0, Math.min(100, s.weight * Math.max(0, Math.min(100, s.confidence)) / 100 * (stale ? STALE_FACTOR : 1)));
      const current = byGroup.get(s.group);
      if (!current || value > current.value) byGroup.set(s.group, { signal: s, value, stale });
    }
  }
  const contributions: Contribution[] = [];
  let survive = 1;
  for (const [group, { signal, value }] of byGroup) {
    contributions.push({ group, category: signal.category, source: signal.source, code: signal.code, confidence: signal.confidence, contribution: Math.round(value), detail: signal.detail });
    survive *= 1 - value / 100;
  }
  let score = Math.round((1 - survive) * 100);
  const endpointSignals = contributions.filter(c => ENDPOINT.includes(c.category));
  const endpointEvidence = endpointSignals.length > 0;
  if (!endpointEvidence) score = Math.min(score, SUPPORTING_ONLY_CAP);
  const top = endpointSignals.sort((a, b) => b.contribution - a.contribution)[0];
  return { score: Math.max(0, Math.min(100, score)), contributions: contributions.sort((a, b) => b.contribution - a.contribution), endpointCategory: (top?.category as Scored["endpointCategory"]) ?? null, endpointEvidence };
}

export interface Bands { lowRiskMax: number; mediumRiskMax: number; highRiskMin: number }
export type Band = "low" | "medium" | "high";
export function bandFor(score: number, bands: Bands): Band {
  return score >= bands.highRiskMin ? "high" : score > bands.lowRiskMax ? "medium" : "low";
}

export interface Decision {
  classification: Classification;
  state: "SECURITY_CLEARED" | "FLAGGED_VPN" | "FLAGGED_PROXY" | "FLAGGED_TOR" | "FLAGGED_HIGH_RISK" | "SECURITY_CHECK_FAILED" | "MANUAL_REVIEW_REQUIRED";
  reasonCode: string;
  band: Band;
}

// Turns provider results into a classification and a target state.
// Rules the engine must never break:
//  - no authoritative provider succeeded  → never CLEARED (fail closed);
//  - stale local data without an external result → DATA_STALE, not CLEAN;
//  - hosting/abuse/velocity alone can never produce a FLAGGED_* state.
export function decide(results: ProviderResult[], scored: Scored, bands: Bands, failClosed: boolean): Decision {
  const authoritativeOk = results.filter(r => r.authoritative && r.status === "ok");
  const anyStale = results.some(r => r.authoritative && r.status === "stale");
  const band = bandFor(scored.score, bands);
  if (band === "high") {
    if (scored.endpointCategory === "TOR") return { classification: "TOR_DETECTED", state: "FLAGGED_TOR", reasonCode: "TOR_EXIT_MATCH", band };
    if (scored.endpointCategory === "VPN") return { classification: "VPN_DETECTED", state: "FLAGGED_VPN", reasonCode: "VPN_ENDPOINT_MATCH", band };
    if (scored.endpointCategory === "PROXY") return { classification: "PROXY_DETECTED", state: "FLAGGED_PROXY", reasonCode: "PROXY_ENDPOINT_MATCH", band };
    return { classification: "SUSPICIOUS_NETWORK", state: "FLAGGED_HIGH_RISK", reasonCode: "HIGH_RISK_COMBINED", band };
  }
  if (band === "medium") {
    // Evidence exists but is single-source or low-confidence: a human decides.
    return { classification: scored.endpointEvidence ? (scored.endpointCategory === "TOR" ? "TOR_DETECTED" : scored.endpointCategory === "VPN" ? "VPN_DETECTED" : "PROXY_DETECTED") : "SUSPICIOUS_NETWORK", state: "MANUAL_REVIEW_REQUIRED", reasonCode: scored.endpointEvidence ? "WEAK_ENDPOINT_EVIDENCE" : "SUPPORTING_SIGNALS_ONLY", band };
  }
  if (authoritativeOk.length === 0) {
    const classification: Classification = anyStale ? "DATA_STALE" : "DETECTION_ERROR";
    return failClosed
      ? { classification, state: "SECURITY_CHECK_FAILED", reasonCode: anyStale ? "INTELLIGENCE_STALE" : "NO_AUTHORITATIVE_RESULT", band }
      : { classification, state: "MANUAL_REVIEW_REQUIRED", reasonCode: anyStale ? "INTELLIGENCE_STALE_MANUAL" : "DETECTION_UNAVAILABLE_MANUAL", band };
  }
  return { classification: "CLEAN", state: "SECURITY_CLEARED", reasonCode: scored.contributions.length ? "LOW_RISK_SIGNALS" : "NO_SIGNALS", band };
}
