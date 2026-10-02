export interface StageAttemptEntry {
  provider: string;
  model: string;
}

export interface StageAttemptRecord {
  provider: string | null;
  model: string | null;
  fallbackCount?: number;
  attempted?: StageAttemptEntry[];
}

export type StageAttemptState = 'unknown' | 'initial' | 'fallback' | 'exhausted';

export interface StageAttemptView {
  state: StageAttemptState;
  selected: string | null;
  actual: string | null;
  attempts: number;
  fallbackCount: number;
}

function fmt(entry: StageAttemptEntry): string {
  return `${entry.provider} · ${entry.model}`;
}

export function deriveStageAttemptView(
  stage: StageAttemptRecord | null | undefined
): StageAttemptView {
  const empty: StageAttemptView = {
    state: 'unknown',
    selected: null,
    actual: null,
    attempts: 0,
    fallbackCount: 0,
  };
  if (!stage) return empty;

  const attempted = stage.attempted ?? [];
  const actual = stage.provider && stage.model ? `${stage.provider} · ${stage.model}` : null;
  const fallbackCount = stage.fallbackCount ?? 0;

  if (!actual) {
    if (attempted.length === 0) return empty;
    return {
      state: 'exhausted',
      selected: fmt(attempted[0]),
      actual: null,
      attempts: attempted.length,
      fallbackCount: fallbackCount > 0 ? fallbackCount : attempted.length - 1,
    };
  }

  if (attempted.length > 1) {
    return {
      state: 'fallback',
      selected: fmt(attempted[0]),
      actual,
      attempts: attempted.length,
      fallbackCount: fallbackCount > 0 ? fallbackCount : attempted.length - 1,
    };
  }

  if (attempted.length === 1) {
    return {
      state: 'initial',
      selected: fmt(attempted[0]),
      actual,
      attempts: 1,
      fallbackCount: 0,
    };
  }

  if (fallbackCount > 0) {
    return {
      state: 'fallback',
      selected: null,
      actual,
      attempts: fallbackCount + 1,
      fallbackCount,
    };
  }

  return {
    state: 'initial',
    selected: null,
    actual,
    attempts: 1,
    fallbackCount: 0,
  };
}
