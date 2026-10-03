import { extractJsonObject } from './json';

export interface PatchResult {
  summary: string;
  files: Array<{
    path: string;
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

export function parsePatchResponse(content: string): PatchResult {
  try {
    const extracted = extractJsonObject(content);
    if (!extracted || typeof extracted !== 'object') {
      throw new Error('Not a JSON object');
    }
    const parsed = extracted as Record<string, unknown>;

    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary : 'No summary',
      files: Array.isArray(parsed.files) ? parsed.files : [],
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
