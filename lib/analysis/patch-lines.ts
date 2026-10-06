// Shared normalization for model-generated patch lines.
//
// A model (any provider — Local, Gemini, OpenRouter, …) is asked for a
// line-based JSON diff, but nothing forces it to emit one physical line per
// entry. Observed real output (llama.cpp, patch_generation):
//
//   { "type": "removed", "content": "  return subtotal - shipping;\n" }
//   { "type": "added",   "content": "  const a = 1;\n  return a;\n"
//
// i.e. the line terminator is part of `content`, and one entry can carry
// several physical lines. GitHub file contents are always compared as
// terminator-free lines (split on '\n'), so an exact-match applier that
// compares these strings verbatim can NEVER find the expected content — that
// is the "Expected content not found" failure.
//
// Normalization is idempotent and removes ONLY line terminators: the line's
// own text (indentation, trailing spaces before the terminator) is never
// altered, so the safety property "expected content must still match the
// repository exactly" is fully preserved.

export type PatchLineType = 'context' | 'removed' | 'added';

export interface NormalizedPatchLine {
  type: PatchLineType;
  content: string;
  [key: string]: unknown;
}

/**
 * Structural input type. Model output, the persisted artifact and
 * `PatchHunk`/`CodeLine` from `@/types` all reach the applier, and none of
 * them guarantee the extra display fields — so the applier only assumes the
 * fields it actually reads.
 */
export interface PatchHunkInput {
  oldStart?: number;
  oldLines?: number;
  newStart?: number;
  newLines?: number;
  lines?: unknown;
}

/**
 * Splits a model line `content` into physical, terminator-free lines.
 * "a\nb\n" -> ["a", "b"]; "a" -> ["a"]; "" -> [""];
 * a trailing terminator never produces a phantom empty line.
 */
export function toPhysicalLines(content: string): string[] {
  const parts = String(content).split(/\r\n|\n|\r/);
  if (parts.length > 1 && parts[parts.length - 1] === '') {
    parts.pop();
  }
  return parts;
}

/**
 * Expands every hunk line's packed content into single physical lines.
 * Entries whose `content` is not a string are passed through unchanged so
 * downstream validation can still reject them with its own message.
 * Non-array input yields an empty list (also handled by validation).
 */
export function normalizeHunkLines(lines: readonly unknown[]): NormalizedPatchLine[] {
  if (!Array.isArray(lines)) return [];

  const normalized: NormalizedPatchLine[] = [];
  for (const entry of lines) {
    if (!entry || typeof entry !== 'object') continue;
    const line = entry as NormalizedPatchLine;
    if (typeof line.content !== 'string') {
      normalized.push(line);
      continue;
    }
    for (const part of toPhysicalLines(line.content)) {
      normalized.push({ ...line, content: part });
    }
  }
  return normalized;
}

// ─────────────────────────────────────────────────────────────────────────────
// Patch application (pure; no GitHub access).
//
// The applier locates a hunk's OLD side (context + removed lines) by its
// CONTENT, never by the line numbers the model reported — models get those
// wrong often enough that trusting them would edit the wrong place. Locating
// is strict enough that a patch can never silently overwrite code that changed
// since analysis, while tolerating the three ways a generated (especially
// local) patch's context drifts from the real file:
//
//   1. whitespace noise (indentation, tabs, trailing spaces) — ignored for
//      MATCHING only; emitted bytes always come from the file;
//   2. lines the model skipped between two anchors — most often a blank line
//      left out of the context. Skipped file lines are preserved verbatim, so
//      a gap in the model's view can never delete real content.
//
// Content itself always has to match: a file edited since analysis fails
// closed instead of being patched where the model never saw it.
// ─────────────────────────────────────────────────────────────────────────────

// Strips the trailing CR so a CRLF file and a file we scanned line-by-line
// compare identically.
function stripEol(line: string): string {
  return line.replace(/\r$/, '');
}

/**
 * Normalized comparison key. Collapses runs of internal whitespace to a single
 * space and trims the ends. Used ONLY to LOCATE a hunk's old side — matching
 * never rewrites emitted bytes (context lines are copied verbatim from the
 * real file), so whitespace noise from a generated patch (trailing spaces,
 * re-indentation, tab-vs-space) can't block an otherwise-correct location.
 */
export function matchKey(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

interface HunkEdit {
  start: number;
  oldCount: number;
  replacement: string[];
}

/** A located old side: every anchor line, its file index, and the span it covers. */
interface Alignment {
  start: number;
  end: number;
  positions: number[];
}

/**
 * Locates the hunk's old side in the file.
 *
 * The old side is matched as an ORDERED sequence rather than one contiguous
 * window: models routinely drop a blank (or comment) line out of the context
 * they emit, which makes the block non-contiguous and would otherwise be
 * unfindable. Every skipped file line is returned inside the span so the
 * caller can preserve it verbatim — matching never discards file content.
 *
 * Every anchor must equal its file line after `matchKey` normalization, which
 * ignores whitespace ONLY. Content itself always has to match: that is what
 * makes a file edited since analysis fail closed instead of being patched in
 * a place the model never saw. Anchors may be separated by at most
 * `gapBudget` lines (scaled with hunk size), and ties are broken by proximity
 * to the model's `oldStart` hint. Returns `null` when no admissible alignment
 * exists.
 */
function alignOldSide(
  fileLines: string[],
  oldSide: string[],
  hint: number
): Alignment | null {
  const n = oldSide.length;
  const m = fileLines.length;
  if (n === 0 || n > m) return null;

  const gapBudget = Math.min(16, Math.max(4, Math.floor(n * 0.5)));
  const UNREACHED = -1;

  const fileKeys = new Array<string>(m);
  for (let i = 0; i < m; i++) fileKeys[i] = matchKey(fileLines[i]);
  const oldKeys = oldSide.map(matchKey);

  const cell = (j: number, i: number) => j * m + i;
  // bestGap[j][i] = fewest skipped file lines when anchors 0..j end at line i
  // (UNREACHED when that state is impossible). prevPos reconstructs the path.
  const bestGap = new Int32Array(n * m).fill(UNREACHED);
  const prevPos = new Int32Array(n * m).fill(-1);

  for (let i = 0; i < m; i++) {
    if (fileKeys[i] === oldKeys[0]) bestGap[cell(0, i)] = 0;
  }

  for (let j = 1; j < n; j++) {
    for (let i = 0; i < m; i++) {
      if (fileKeys[i] !== oldKeys[j]) continue;
      const kMin = Math.max(0, i - 1 - gapBudget);
      for (let k = kMin; k <= i - 1; k++) {
        const previous = bestGap[cell(j - 1, k)];
        if (previous === UNREACHED) continue;
        const gap = previous + (i - k - 1);
        if (gap > gapBudget) continue;
        const at = cell(j, i);
        if (bestGap[at] === UNREACHED || gap < bestGap[at]) {
          bestGap[at] = gap;
          prevPos[at] = k;
        }
      }
    }
  }

  let endIdx = -1;
  let chosen: { gap: number; distance: number } | null = null;
  for (let i = 0; i < m; i++) {
    const at = cell(n - 1, i);
    if (bestGap[at] === UNREACHED) continue;

    let anchor = i;
    let complete = true;
    for (let j = n - 1; j > 0; j--) {
      const previous = prevPos[cell(j, anchor)];
      if (previous < 0) {
        complete = false;
        break;
      }
      anchor = previous;
    }
    if (!complete) continue;

    const candidate = {
      gap: bestGap[at],
      distance: hint >= 0 ? Math.abs(anchor - hint) : 0,
    };
    if (
      !chosen ||
      candidate.gap < chosen.gap ||
      (candidate.gap === chosen.gap && candidate.distance < chosen.distance)
    ) {
      chosen = candidate;
      endIdx = i;
    }
  }
  if (!chosen || endIdx < 0) return null;

  const positions = new Array<number>(n);
  let anchor = endIdx;
  for (let j = n - 1; j >= 0; j--) {
    positions[j] = anchor;
    if (j > 0) anchor = prevPos[cell(j, anchor)];
  }

  return { start: positions[0], end: positions[n - 1], positions };
}

/**
 * Why a patch could not be applied to a file. `apply-patch.ts` turns these
 * into the message the user sees, so they must stay honest: none of them
 * means the file changed unless the content genuinely is not there.
 */
export type ApplyFailureReason =
  /** The hunk changes content but carries no context/removed line to locate it by. */
  | 'unanchored'
  /** At least one anchor line is not present in the file (stale or wrong patch). */
  | 'not_found'
  /** Two hunks resolved to overlapping spans — malformed patch. */
  | 'overlap'
  /** A hunk contains a line entry that is not usable (bad type/content). */
  | 'malformed';

export type ApplyOutcome =
  | { ok: true; content: string }
  | { ok: false; reason: ApplyFailureReason; hunkIndex: number; detail: string };

/**
 * Applies line-based hunks to a file's content and reports WHY it failed.
 *
 * Exported for regression tests (pure; no GitHub access).
 */
export function applyHunksDetailed(originalContent: string, hunks: readonly PatchHunkInput[]): ApplyOutcome {
  const originalLines = originalContent.split('\n');
  const fileLines = originalLines.map(stripEol);
  const usesCrlf = originalContent.includes('\r\n');
  const edits: HunkEdit[] = [];

  for (let hunkIndex = 0; hunkIndex < hunks.length; hunkIndex++) {
    const hunk = hunks[hunkIndex];
    const lines = normalizeHunkLines(Array.isArray(hunk?.lines) ? hunk.lines : []);

    if (lines.length === 0) continue;

    // The OLD side of a unified hunk is context + removed lines (in order);
    // the NEW side is context + added lines. Matching the old side line by
    // line — instead of flattening removed lines into one block — is what makes
    // hunks with interleaved context/multiple change groups applicable.
    const oldSide: string[] = [];
    for (const line of lines) {
      const rawType: unknown = line.type;
      if (rawType === 'added') continue;
      if (rawType !== 'context' && rawType !== 'removed') {
        return {
          ok: false,
          reason: 'malformed',
          hunkIndex,
          detail: `line has an unrecognized type ${JSON.stringify(rawType)}`,
        };
      }
      if (typeof line.content !== 'string') {
        return {
          ok: false,
          reason: 'malformed',
          hunkIndex,
          detail: 'line content is not a string',
        };
      }
      oldSide.push(line.content);
    }

    const hasChange = lines.some(
      (line) => line.type === 'added' || line.type === 'removed'
    );
    // A hunk that only ADDS lines carries nothing to match against the file.
    // Its only anchor would be the reported line number, which models get
    // wrong often enough that trusting it would silently insert code in the
    // wrong place. Fail closed and let the caller ask for a regenerated hunk.
    if (oldSide.length === 0) {
      if (!hasChange) continue;
      return {
        ok: false,
        reason: 'unanchored',
        hunkIndex,
        detail: 'hunk has no context or removed lines to locate it in the file',
      };
    }

    const hint = Number.isFinite(hunk?.oldStart) ? (hunk.oldStart as number) - 1 : 0;
    const alignment = alignOldSide(fileLines, oldSide, hint);
    if (!alignment) {
      return {
        ok: false,
        reason: 'not_found',
        hunkIndex,
        detail: `expected ${oldSide.length} line(s) starting at line ${hint + 1} were not found`,
      };
    }

    // Build the replacement: context lines keep the file's own bytes (line
    // endings included); added lines come from the patch and adopt the file's
    // CRLF convention so a CRLF file does not end up with mixed endings.
    // File lines the model skipped between two anchors are emitted unchanged,
    // so a gap in the model's context can never delete real content.
    const replacement: string[] = [];
    let anchor = 0;
    for (const line of lines) {
      if (line.type === 'added') {
        replacement.push(
          usesCrlf && !line.content.endsWith('\r') ? `${line.content}\r` : line.content
        );
        continue;
      }

      const position = alignment.positions[anchor];
      if (line.type === 'context') replacement.push(originalLines[position]);
      anchor++;

      if (anchor < alignment.positions.length) {
        const next = alignment.positions[anchor];
        for (let i = position + 1; i < next; i++) replacement.push(originalLines[i]);
      }
    }

    edits.push({
      start: alignment.start,
      oldCount: alignment.end - alignment.start + 1,
      replacement,
    });
  }

  // Hunks are expressed against the ORIGINAL file: locate them all first,
  // then apply bottom-up so earlier edits cannot shift later positions.
  edits.sort((a, b) => a.start - b.start);
  for (let i = 1; i < edits.length; i++) {
    if (edits[i].start < edits[i - 1].start + edits[i - 1].oldCount) {
      return {
        ok: false,
        reason: 'overlap',
        hunkIndex: i,
        detail: 'hunk overlaps a previous hunk in the same file',
      };
    }
  }

  const result = [...originalLines];
  for (let i = edits.length - 1; i >= 0; i--) {
    const edit = edits[i];
    result.splice(edit.start, edit.oldCount, ...edit.replacement);
  }
  return { ok: true, content: result.join('\n') };
}

/**
 * Convenience wrapper returning the new content, or `null` when the patch
 * cannot be applied WITHOUT guessing. Prefer `applyHunksDetailed` when the
 * failure reason matters.
 */
export function applyHunksToContent(originalContent: string, hunks: readonly PatchHunkInput[]): string | null {
  const outcome = applyHunksDetailed(originalContent, hunks);
  return outcome.ok ? outcome.content : null;
}
