// Catalog revalidation loop for the /models page (Task R). Pure: no React, no
// fetch, no timers — `fetchPending` and `sleep` are injected so the loop's
// bound and its "never block the render" contract are directly testable.
//
// Why this exists: GET /api/models now serves the persisted catalog immediately
// and schedules a generation-aware rebuild in the background (see
// `getCatalogForDisplay`). The response carries `catalogPending` so the page
// knows whether what it rendered still predates the current provider set. This
// loop re-reads until the flag clears, so newly connected providers' models
// appear on their own — no page reload, no blocking wait.
//
// The loop is BOUNDED on purpose: if discovery keeps failing the flag never
// clears, and an unbounded poll would hammer /api/models (and, through it, the
// single-flight rebuild) forever. After the budget the page keeps showing the
// last good snapshot and the next navigation/refresh tries again.

/** Bounded so a permanently failing discovery cannot cause an endless poll. */
export const MAX_CATALOG_REVALIDATION_ATTEMPTS = 4;

/** Gap between re-reads — long enough for a background rebuild to land. */
export const CATALOG_REVALIDATION_DELAY_MS = 1500;

export interface RevalidateOptions {
  /** Performs one read and returns whether the catalog is still catching up.
   *  Must never throw. */
  fetchPending: () => Promise<boolean>;
  sleep: (ms: number) => Promise<void>;
  /** Called after each read (successful or not) — e.g. to surface a failure. */
  onAttempt?: (attempt: number, pending: boolean) => void;
  /** Called once when the loop gives up (budget exhausted / last read failed). */
  onExhausted?: (attempts: number) => void;
  maxAttempts?: number;
  delayMs?: number;
}

/**
 * Re-reads the catalog until it is no longer pending or the attempt budget is
 * exhausted. Resolves when done; it never rejects. The first read is expected
 * to have already happened (the caller rendered it) — this loop only performs
 * the FOLLOW-UP reads.
 */
export async function revalidateUntilSettled(options: RevalidateOptions): Promise<void> {
  const maxAttempts = options.maxAttempts ?? MAX_CATALOG_REVALIDATION_ATTEMPTS;
  const delayMs = options.delayMs ?? CATALOG_REVALIDATION_DELAY_MS;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await options.sleep(delayMs);
    let pending: boolean;
    try {
      pending = await options.fetchPending();
    } catch {
      pending = false;
    }
    options.onAttempt?.(attempt, pending);
    if (!pending) return;
  }
  options.onExhausted?.(maxAttempts);
}
