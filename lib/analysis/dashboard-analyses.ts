// Dashboard analysis aggregation.
//
// The dashboard reads `analyses` with a flat query (no join), so a card can
// only repeat when the SAME analysis id arrives more than once. Deduplicating
// on the stable analysis id protects the rendered list AND the counters from
// any repeated-row source while deliberately NEVER collapsing two legitimate
// analyses of the same repository/issue (those have different ids and are
// intentionally allowed).

export interface AnalysisAggregateRow {
  id: string;
  status: string;
  patch_status?: string | null;
}

export interface AnalysisAggregate<T extends AnalysisAggregateRow> {
  /** Unique rows in their original (query) order. */
  rows: T[];
  issuesAnalyzed: number;
  patchesGenerated: number;
  recent: T[];
}

/**
 * One row per stable analysis id, preserving the first occurrence (the query
 * is already ordered newest-first). Rows without an id are dropped rather than
 * rendered as anonymous cards.
 */
export function dedupeAnalysisRows<T extends AnalysisAggregateRow>(
  rows: readonly T[]
): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const row of rows) {
    if (!row || typeof row.id !== 'string' || row.id.length === 0) continue;
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    unique.push(row);
  }
  return unique;
}

/**
 * Single source of truth for the dashboard: counters and the recent list are
 * derived from the SAME deduplicated row set, so a card can never be counted
 * twice or shown without being counted.
 */
export function summarizeAnalyses<T extends AnalysisAggregateRow>(
  rows: readonly T[],
  limit = 5
): AnalysisAggregate<T> {
  const unique = dedupeAnalysisRows(rows);
  return {
    rows: unique,
    issuesAnalyzed: unique.filter((row) => row.status === 'completed').length,
    patchesGenerated: unique.filter(
      (row) => !!row.patch_status && row.patch_status !== 'none'
    ).length,
    recent: unique.slice(0, Math.max(0, limit)),
  };
}
