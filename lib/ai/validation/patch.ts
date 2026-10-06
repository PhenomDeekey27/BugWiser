import { extractJsonObject } from './json';
import { normalizeHunkLines } from '@/lib/analysis/patch-lines';

export interface PatchResult {
  summary: string;
  files: Array<{
    path: string;
    additions?: number;
    deletions?: number;
    hunks: Array<{
      oldStart: number;
      oldLines: number;
      newStart: number;
      newLines: number;
      lines: Array<{
        type: 'context' | 'removed' | 'added';
        content: string;
      }>;
    }>;
  }>;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

// Expands packed model line content into single physical lines (shared
// normalization, see lib/analysis/patch-lines.ts) and derives the line counts
// the PatchFile UI/apply code expects, so the persisted artifact is a valid
// patch regardless of how sloppy the model's JSON was. Malformed fields are
// deliberately NOT coerced here — validatePatch still rejects them.
function normalizeParsedFile(raw: unknown): PatchResult['files'][number] {
  const file = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rawHunks = Array.isArray(file.hunks) ? file.hunks : [];

  let additions = 0;
  let deletions = 0;
  const hunks = rawHunks.map((rawHunk) => {
    const hunk = (rawHunk && typeof rawHunk === 'object' ? rawHunk : {}) as Record<string, unknown>;
    const lines = normalizeHunkLines(Array.isArray(hunk.lines) ? hunk.lines : []);
    for (const line of lines) {
      if (line.type === 'added') additions++;
      else if (line.type === 'removed') deletions++;
    }
    return {
      ...hunk,
      lines,
    } as unknown as PatchResult['files'][number]['hunks'][number];
  });

  return {
    path: file.path,
    additions,
    deletions,
    hunks,
  } as unknown as PatchResult['files'][number];
}

export function parsePatchResponse(content: string): PatchResult {
  try {
    const extracted = extractJsonObject(content);
    if (!extracted || typeof extracted !== 'object') {
      throw new Error('Not a JSON object');
    }
    const parsed = extracted as Record<string, unknown>;

    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary : 'No summary',
      files: Array.isArray(parsed.files)
        ? parsed.files.map(normalizeParsedFile)
        : [],
    };
  } catch {
    return {
      summary: 'Failed to parse AI response',
      files: [],
    };
  }
}

export function validatePatch(result: PatchResult): ValidationResult {
  if (!result.summary || result.summary.length < 10) {
    return { valid: false, error: 'Summary too short' };
  }

  if (!Array.isArray(result.files)) {
    return { valid: false, error: 'Invalid files array' };
  }

  if (result.files.length === 0) {
    const noChangeIndicators = [
      /no (code )?change/i,
      /not (applicable|required|needed)/i,
      /no patch/i,
      /no modification/i,
      /insufficient/i,
      /unable to generate/i,
      /cannot (safely )?generate/i,
    ];

    const summaryIndicatesNoChange = noChangeIndicators.some((p) => p.test(result.summary));

    if (summaryIndicatesNoChange) {
      return { valid: true };
    }

    return { valid: false, error: 'No files in patch' };
  }

  for (const file of result.files) {
    if (!file.path || typeof file.path !== 'string') {
      return { valid: false, error: 'Invalid file path' };
    }

    if (!Array.isArray(file.hunks) || file.hunks.length === 0) {
      return { valid: false, error: `No hunks in file ${file.path}` };
    }

    for (const hunk of file.hunks) {
      if (typeof hunk.oldStart !== 'number' || typeof hunk.oldLines !== 'number') {
        return { valid: false, error: `Invalid old line numbers in ${file.path}` };
      }
      if (typeof hunk.newStart !== 'number' || typeof hunk.newLines !== 'number') {
        return { valid: false, error: `Invalid new line numbers in ${file.path}` };
      }
      if (!Array.isArray(hunk.lines) || hunk.lines.length === 0) {
        return { valid: false, error: `No lines in hunk of ${file.path}` };
      }

      for (const line of hunk.lines) {
        if (line.type !== 'context' && line.type !== 'removed' && line.type !== 'added') {
          return { valid: false, error: `Invalid line type in ${file.path}` };
        }
        if (typeof line.content !== 'string') {
          return { valid: false, error: `Invalid line content in ${file.path}` };
        }
      }
    }
  }

  return { valid: true };
}
