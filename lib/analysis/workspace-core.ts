// Pure workspace staging: applies a generated patch to the exact source
// contents captured at a pinned commit and renders the resulting diff.
//
// The workspace is authoritative for "what the patch does"; a remote branch is
// only created later and only with explicit user approval.

import { applyHunksDetailed } from './patch-lines.ts';
import { isSecretFilePath } from './filter.ts';

export interface PatchLineLike {
  type: 'added' | 'removed' | 'context';
  content: string;
}

export interface PatchHunkLike {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: readonly PatchLineLike[];
}

export interface PatchFileLike {
  path: string;
  additions?: number;
  deletions?: number;
  hunks: readonly PatchHunkLike[];
}

export interface PatchLike {
  summary: string;
  files: readonly PatchFileLike[];
}

export interface SourceFileLike {
  path: string;
  content: string;
}

export interface StagedWorkspaceFile {
  path: string;
  baseContent: string;
  content: string;
  additions: number;
  deletions: number;
  diff: string;
  status: 'modified';
}

export type StagePatchFailureCode =
  | 'invalid_base_commit'
  | 'commit_mismatch'
  | 'no_files'
  | 'too_many_files'
  | 'unsafe_path'
  | 'secret_file'
  | 'file_not_in_snapshot'
  | 'hunk_failed'
  | 'no_changes';

export type StagePatchResult =
  | { ok: true; files: StagedWorkspaceFile[]; summary: string }
  | { ok: false; code: StagePatchFailureCode; error: string };

const MAX_WORKSPACE_FILES = 20;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;

function isSafeRepositoryPath(path: string): boolean {
  if (typeof path !== 'string' || path.length === 0 || path.length > 500) return false;
  if (path.startsWith('/') || path.includes('\\') || path.includes('\u0000')) return false;
  return path.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

function hasChanges(file: PatchFileLike): boolean {
  return file.hunks.some((hunk) =>
    hunk.lines.some((line) => line.type === 'added' || line.type === 'removed')
  );
}

function countLines(lines: readonly PatchLineLike[], type: 'added' | 'removed'): number {
  return lines.reduce(
    (total, line) => total + (line.type === type ? line.content.split('\n').length : 0),
    0
  );
}

export function renderUnifiedDiff(path: string, file: PatchFileLike): string {
  const output: string[] = [`--- a/${path}`, `+++ b/${path}`];
  for (const hunk of file.hunks) {
    output.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
    for (const line of hunk.lines) {
      const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
      for (const part of line.content.split('\n')) {
        output.push(`${prefix}${part}`);
      }
    }
  }
  return output.join('\n');
}

/**
 * Applies the patch strictly against the snapshot that generated it. Any file
 * the analysis did not retrieve is refused instead of being guessed.
 */
export function stagePatchInWorkspace(input: {
  patch: PatchLike;
  sources: readonly SourceFileLike[];
  analysisCommitSha: string | null | undefined;
  baseCommitSha: string | null | undefined;
  maxFiles?: number;
}): StagePatchResult {
  const analysisCommit =
    typeof input.analysisCommitSha === 'string' ? input.analysisCommitSha.toLowerCase() : '';
  const baseCommit =
    typeof input.baseCommitSha === 'string' ? input.baseCommitSha.toLowerCase() : '';

  if (!COMMIT_PATTERN.test(analysisCommit)) {
    return {
      ok: false,
      code: 'invalid_base_commit',
      error: 'This analysis is not pinned to a commit, so a workspace cannot be staged.',
    };
  }
  if (baseCommit !== analysisCommit) {
    return {
      ok: false,
      code: 'commit_mismatch',
      error: 'Workspace base commit does not match the commit this analysis was generated from.',
    };
  }

  const patchFiles = (input.patch?.files || []).filter(hasChanges);
  if (patchFiles.length === 0) {
    return { ok: false, code: 'no_files', error: 'The patch contains no applicable changes.' };
  }

  const maxFiles = input.maxFiles ?? MAX_WORKSPACE_FILES;
  if (patchFiles.length > maxFiles) {
    return {
      ok: false,
      code: 'too_many_files',
      error: `The patch touches ${patchFiles.length} files, above the ${maxFiles} file workspace limit.`,
    };
  }

  const sourceMap = new Map(input.sources.map((source) => [source.path, source.content]));
  const staged: StagedWorkspaceFile[] = [];

  for (const file of patchFiles) {
    if (!isSafeRepositoryPath(file.path)) {
      return {
        ok: false,
        code: 'unsafe_path',
        error: `Refusing to stage outside the workspace: ${file.path}`,
      };
    }
    if (isSecretFilePath(file.path)) {
      return {
        ok: false,
        code: 'secret_file',
        error: `Refusing to stage a secret-bearing file: ${file.path}`,
      };
    }

    const baseContent = sourceMap.get(file.path);
    if (baseContent === undefined) {
      return {
        ok: false,
        code: 'file_not_in_snapshot',
        error: `${file.path} was not retrieved for this analysis, so it cannot be staged safely.`,
      };
    }

    const outcome = applyHunksDetailed(baseContent, file.hunks);
    if (!outcome.ok) {
      return {
        ok: false,
        code: 'hunk_failed',
        error: `${file.path}: hunk ${outcome.hunkIndex + 1} could not be applied (${outcome.reason}).`,
      };
    }
    if (outcome.content === baseContent) {
      continue;
    }

    staged.push({
      path: file.path,
      baseContent,
      content: outcome.content,
      additions: file.additions ?? countLines(file.hunks.flatMap((hunk) => hunk.lines), 'added'),
      deletions: file.deletions ?? countLines(file.hunks.flatMap((hunk) => hunk.lines), 'removed'),
      diff: renderUnifiedDiff(file.path, file),
      status: 'modified',
    });
  }

  if (staged.length === 0) {
    return { ok: false, code: 'no_changes', error: 'The patch produced no file changes.' };
  }

  return { ok: true, files: staged, summary: input.patch.summary || '' };
}
