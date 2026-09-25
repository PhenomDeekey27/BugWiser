// Canonical cost calculation for BugWiser — SINGLE SOURCE OF TRUTH.
//
// Pricing representation: USD per 1,000,000 tokens (the normalized catalog
// format — see lib/ai/catalog/live.ts `toPerMillion`, which is the ONLY place
// provider-specific conversion happens; this module never converts units).
//
// Formula:
//   estimatedCostUsd =
//     (inputPricePerMillion * inputTokens + outputPricePerMillion * outputTokens)
//     / 1_000_000
//
// Pricing semantics (must never be silently collapsed):
//   - isFree (explicit zero price confirmed by the catalog) → cost is exactly 0
//   - known paid prices → calculated normally
//   - unknown/null/invalid price → `unknown` result; NEVER treated as 0 or
//     free. UI must render this as "Pricing unavailable", not "$0"/"Free".
//
// Stage workload estimates live in stageTokenProfiles.ts; consumers are the
// model setup UI, stage configuration table, and total-cost card in
// app/models/page.tsx.

/** USD per 1M tokens — the normalized pricing unit across the catalog. */
export const TOKENS_PER_MILLION = 1_000_000;

/** Token counts for one estimated request (a stage workload). */
export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
}

/** Already-normalized model pricing as consumed by the cost helper. */
export interface NormalizedPricing {
  /** USD per 1M input tokens; null when pricing is unknown. */
  inputPricePerMillion: number | null;
  /** USD per 1M output tokens; null when pricing is unknown. */
  outputPricePerMillion: number | null;
  /** True when the catalog has CONFIRMED zero cost (explicit zero pricing). */
  isFree: boolean;
}

/**
 * Result of a cost estimate. The `unknown` variant is explicit by design: the
 * caller must render "Pricing unavailable" — never $0, never "Free".
 */
export type CostEstimate =
  | { status: 'free'; usd: 0 }
  | { status: 'priced'; usd: number }
  | { status: 'unknown'; usd: null };

/** A known, valid price: finite and non-negative. NaN/Infinity/negative/null → unknown. */
function isKnownPrice(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * The one and only estimated-cost arithmetic in the codebase.
 * Consumes already-normalized pricing (USD per 1M) plus a token profile.
 */
export function estimateCostUsd(pricing: NormalizedPricing, tokens: TokenCounts): CostEstimate {
  // Explicit zero pricing wins first: a confirmed free model is $0 even when
  // the numeric price fields are null.
  if (pricing.isFree) return { status: 'free', usd: 0 };
  if (!isKnownPrice(pricing.inputPricePerMillion) || !isKnownPrice(pricing.outputPricePerMillion)) {
    return { status: 'unknown', usd: null };
  }
  const usd =
    (pricing.inputPricePerMillion * tokens.inputTokens +
      pricing.outputPricePerMillion * tokens.outputTokens) /
    TOKENS_PER_MILLION;
  return { status: 'priced', usd };
}

/**
 * Shared cost formatting. Mirrors the historical formatter exactly:
 *   free → "Free", unknown → "Pricing unavailable",
 *   micro-costs keep 4 decimals so they never round to "$0.00" (which would
 *   read as free), small costs 3 decimals, larger 2.
 */
export function formatCostUsd(estimate: CostEstimate): string {
  if (estimate.status === 'unknown') return 'Pricing unavailable';
  if (estimate.status === 'free' || estimate.usd === 0) return 'Free';
  const usd = estimate.usd;
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}
