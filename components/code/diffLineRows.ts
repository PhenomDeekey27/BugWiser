import { PatchHunk } from '@/types';
import { toPhysicalLines } from '@/lib/analysis/patch-lines';

export type DiffLineType = 'context' | 'removed' | 'added';

export interface DiffLineRow {
  /** Stable, semantically derived key: never an array index. */
  key: string;
  number: number;
  type: DiffLineType;
  content: string;
}

/**
 * Turns a hunk into renderable rows with gutter numbers.
 *
 * Patch artifacts from the model carry no per-line numbers, so numbers are
 * derived from the hunk header: removed/context lines keep the OLD numbering
 * (`old:<n>`), added lines the NEW numbering (`new:<n>`). Keys are therefore
 * unique among siblings and stable across re-renders — this is what fixes the
 * "Each child in a list should have a unique 'key' prop" warning that
 * `key={line.number}` produced (every line's `number` was `undefined`).
 *
 * Packed model content (`"a\nb\n"`) is expanded into one row per physical
 * line, so old artifacts render with correct numbers too.
 */
export function buildDiffLineRows(hunk: PatchHunk): DiffLineRow[] {
  let oldLine = Number.isFinite(hunk?.oldStart) ? Math.max(1, hunk.oldStart) : 1;
  let newLine = Number.isFinite(hunk?.newStart) ? Math.max(1, hunk.newStart) : 1;

  const rows: DiffLineRow[] = [];
  const lines = Array.isArray(hunk?.lines) ? hunk.lines : [];

  for (const line of lines) {
    const type: DiffLineType =
      line.type === 'added' || line.type === 'removed' ? line.type : 'context';
    const parts =
      typeof line.content === 'string' ? toPhysicalLines(line.content) : [''];

    for (const content of parts) {
      const added = type === 'added';
      const removed = type === 'removed';
      rows.push({
        key: added ? `new:${newLine}` : `old:${oldLine}`,
        number: added ? newLine : oldLine,
        type,
        content,
      });
      if (!removed) newLine++;
      if (!added) oldLine++;
    }
  }

  return rows;
}
