// Pure, dependency-free description of HOW a catalog's model scores were
// produced — powers the compact scoring-status indicator on /models. No React
// and no I/O, so every branch is testable without rendering (this repo has no
// test framework; focused probes exercise these branches directly).
//
// Honesty rules encoded here:
//   - absent/nullable API fields → say nothing (hidden), never guess;
//   - classifiedByAi=true means "at least one classifier batch was accepted"
//     (model-intelligence aiClassify) — per-row origins decide the actual
//     coverage, so a partial catalog is reported as partial (n/total), never
//     as fully AI-scored;
//   - rows without a score origin are counted as unknown and force the
//     non-claiming "AI-assisted" wording.

export type ScoringStatusKind = 'hidden' | 'metadata' | 'ai' | 'partial' | 'ai-assisted';

export interface ScoringStatus {
  kind: ScoringStatusKind;
  /** Compact badge text; null → render nothing. */
  label: string | null;
  /** Longer explanation (badge tooltip); null → nothing extra to say. */
  detail: string | null;
}

interface ScoringStatusRow {
  scoreOrigin?: 'ai' | 'deterministic' | null;
}

interface ScoringStatusInput {
  classifiedByAi?: boolean | null;
  classificationModel?: string | null;
  rows?: readonly ScoringStatusRow[] | null;
}

const HIDDEN: ScoringStatus = { kind: 'hidden', label: null, detail: null };

function attribution(model: string | null): string {
  return model ? ` (${model})` : '';
}

export function describeScoringStatus({ classifiedByAi, classificationModel, rows }: ScoringStatusInput): ScoringStatus {
  // Absent/null fields (older payload, error state): render nothing rather
  // than claiming an origin we cannot verify.
  if (typeof classifiedByAi !== 'boolean') return HIDDEN;
  const list = rows ?? [];
  if (list.length === 0) return HIDDEN;

  const ai = list.filter((r) => r.scoreOrigin === 'ai').length;
  const deterministic = list.filter((r) => r.scoreOrigin === 'deterministic').length;
  const total = list.length;
  const model = classificationModel || null;

  if (!classifiedByAi) {
    return {
      kind: 'metadata',
      label: 'Metadata-scored',
      detail: 'Scores are derived from provider and catalog metadata; no AI classifier output was applied.',
    };
  }

  // classifiedByAi=true: at least one classifier batch was accepted.
  const unknown = total - ai - deterministic;
  if (unknown > 0) {
    return {
      kind: 'ai-assisted',
      label: 'AI-assisted scoring',
      detail: `The AI classifier${attribution(model)} scored part of this catalog, but per-row origins are missing for ${unknown} row${unknown === 1 ? '' : 's'} — treat scores as a mix of AI and metadata output.`,
    };
  }
  if (deterministic === 0) {
    return {
      kind: 'ai',
      label: 'AI-scored',
      detail: `All ${total} model rows were scored by the AI classifier${attribution(model)}.`,
    };
  }
  if (ai === 0) {
    // Defensive: the catalog-level flag claims AI classification but no row
    // carries an AI origin — never claim coverage from the flag alone.
    return {
      kind: 'ai-assisted',
      label: 'AI-assisted scoring',
      detail: `The AI classifier${attribution(model)} was applied to this catalog, but no persisted row reports an AI score origin — treat scores as metadata-derived.`,
    };
  }
  return {
    kind: 'partial',
    label: `${ai}/${total} AI-scored`,
    detail: `${ai} of ${total} rows were scored by the AI classifier${attribution(model)}; the remaining ${deterministic} use deterministic metadata scores (failed or unusable classifier batches).`,
  };
}
