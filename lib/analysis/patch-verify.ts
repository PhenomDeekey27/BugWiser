import {
  applyHunksDetailed,
  type ApplyOutcome,
  type PatchHunkInput,
} from './patch-lines';

export interface PatchFileLike {
  path: string;
  hunks: readonly PatchHunkInput[];
}

export interface SourceFileLike {
  path: string;
  content: string;
}

export type ApplyFailure = Extract<ApplyOutcome, { ok: false }>;

export type PatchVerifyResult =
  | { ok: true }
  | { ok: false; path: string; hunkIndex: number; message: string };

/**
 * True when the file actually carries a change. Pure-addition hunks count as
 * changes too — they just cannot be applied (see `applyHunksDetailed`).
 */
export function fileHasChanges(file: PatchFileLike): boolean {
  return Array.isArray(file?.hunks) && file.hunks.some((hunk) =>
    Array.isArray(hunk?.lines) &&
    (hunk.lines as unknown[]).some((line) => {
      const type = (line as { type?: unknown } | null)?.type;
      return type === 'added' || type === 'removed';
    })
  );
}

/**
 * Turns an applier failure into the sentence a user (and the retry prompt)
 * sees. Kept in one place so the apply endpoint, the pre-flight dry run and
 * the generation feedback all say the same thing.
 */
export function describeApplyFailure(path: string, failure: ApplyFailure): string {
  const hunk = `hunk ${failure.hunkIndex + 1}`;
  switch (failure.reason) {
    case 'unanchored':
      return `${path}: ${hunk} has no context or removed lines to locate it in the file (${failure.detail}).`;
    case 'not_found':
      return `${path}: Expected content not found. The file may have changed since analysis. (${hunk}: ${failure.detail})`;
    case 'overlap':
      return `${path}: ${hunk} overlaps another hunk in the same file.`;
    case 'malformed':
      return `${path}: ${hunk} is malformed — ${failure.detail}.`;
    default:
      return `${path}: patch could not be applied.`;
  }
}

/**
 * Best-effort parse of JavaScript as a plain function body, falling back to an
 * async body so top-level `await` is accepted. Returns `false` only when the
 * code is genuinely not parsable as JavaScript — module syntax (`import`/
 * `export`), JSX and type annotations all land there, which is exactly why
 * callers must only enforce this when the ORIGINAL file parsed.
 */
export function parsesAsJavaScript(code: string): boolean {
  try {
    new Function(code);
    return true;
  } catch {
    // Not a plain script (module syntax, top-level await, …) — try async.
  }
  try {
    new Function(`return (async () => {\n${code}\n});`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Guards against committing code that no longer parses.
 *
 * Only fires when the file parsed BEFORE the patch and does not parse AFTER
 * it — so a valid edit to an already-broken file, an ESM/JSX/TS file, or any
 * file we cannot evaluate is left alone. Returns a message when the patch
 * itself broke the file, else `null`.
 */
export function findSyntaxRegression(before: string, after: string): string | null {
  if (before === after) return null;
  if (!parsesAsJavaScript(before)) return null;
  if (parsesAsJavaScript(after)) return null;
  return 'the patched file no longer parses as JavaScript';
}

/**
 * Dry-runs a patch against the exact file contents it was generated from.
 *
 * This is the pre-flight gate: generation only stores a patch once it applies
 * cleanly, so the user never reaches the apply button with something that is
 * guaranteed to fail. Files the analysis never captured are skipped — there is
 * nothing to verify against, and the apply step still reports them honestly.
 */
export function verifyPatchAgainstSources(
  files: readonly PatchFileLike[],
  sources: readonly SourceFileLike[]
): PatchVerifyResult {
  for (const file of files) {
    if (!fileHasChanges(file)) continue;

    const source = sources.find((candidate) => candidate.path === file.path);
    if (!source) continue;

    const outcome = applyHunksDetailed(source.content, file.hunks);
    if (!outcome.ok) {
      return {
        ok: false,
        path: file.path,
        hunkIndex: outcome.hunkIndex,
        message: describeApplyFailure(file.path, outcome),
      };
    }

    const syntaxProblem = findSyntaxRegression(source.content, outcome.content);
    if (syntaxProblem) {
      return {
        ok: false,
        path: file.path,
        hunkIndex: 0,
        message: `${file.path}: ${syntaxProblem}.`,
      };
    }
  }

  return { ok: true };
}
