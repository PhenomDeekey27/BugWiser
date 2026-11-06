// Persisted state of the branch → commit → pull request workflow.
//
// The workflow is resumable, so progress has to survive a refresh, a navigation
// away, an authentication redirect, and a failed request. `analyses.fix_status`
// plus the fix/pull-request columns added by migration 024 are the record; the
// legacy patch columns (`patch_status`, `created_branch`, `commit_sha`, …) are
// written too, so older screens and the existing patch tab keep working.
//
// A deployment that has not run migration 024 yet must still be able to push a
// fix: every write here degrades to the legacy subset instead of failing the
// operation.

import { createBackgroundClient } from '@/lib/supabase/background';
import type { FixMode, FixStatus } from '@/types';

export interface FixState {
  status: FixStatus;
  mode: FixMode | null;
  targetRepository: string | null;
  targetOwner: string | null;
  headRepository: string | null;
  baseBranch: string | null;
  baseCommit: string | null;
  usedFork: boolean;
  error: string | null;
  updatedAt: string | null;
  attempts: number;
  branch: string | null;
  commitSha: string | null;
  commitMessage: string | null;
  filesChanged: string[] | null;
  pullRequest: {
    number: number | null;
    url: string | null;
    state: string | null;
    createdAt: string | null;
  } | null;
  /** False when migration 024 has not been applied: only legacy fields persist. */
  schemaReady: boolean;
}

export interface FixStatePatch {
  status?: FixStatus;
  mode?: FixMode | null;
  targetRepository?: string | null;
  targetOwner?: string | null;
  headRepository?: string | null;
  baseBranch?: string | null;
  baseCommit?: string | null;
  usedFork?: boolean;
  error?: string | null;
  attempts?: number;
  branch?: string | null;
  commitSha?: string | null;
  commitMessage?: string | null;
  filesChanged?: string[] | null;
  patchStatus?: 'none' | 'pending' | 'applied' | 'failed';
  appliedAt?: string | null;
  pullRequest?: {
    number?: number | null;
    url?: string | null;
    state?: string | null;
    createdAt?: string | null;
  } | null;
}

export interface AnalysisFixRow {
  id: string;
  user_id: string | null;
  repository_full_name: string;
  repository_source?: string | null;
  repository_branch?: string | null;
  repository_default_branch?: string | null;
  repository_commit?: string | null;
  issue_number: number;
  issue_url?: string | null;
  created_branch?: string | null;
  commit_sha?: string | null;
  commit_message?: string | null;
  changed_files?: string[] | null;
  patch_status?: string | null;
  pull_request_url?: string | null;
  fix_status?: string | null;
  fix_mode?: string | null;
  fix_target_repository?: string | null;
  fix_target_owner?: string | null;
  fix_head_repository?: string | null;
  fix_base_branch?: string | null;
  fix_base_commit?: string | null;
  fix_used_fork?: boolean | null;
  fix_error?: string | null;
  fix_updated_at?: string | null;
  fix_attempts?: number | null;
  pull_request_number?: number | null;
  pull_request_state?: string | null;
  pull_request_created_at?: string | null;
}

const FIX_STATUSES: readonly FixStatus[] = [
  'none',
  'awaiting_authorization',
  'branch_creating',
  'branch_created',
  'committing',
  'committed',
  'pushing',
  'pushed',
  'creating_pr',
  'pr_created',
  'pr_failed',
  'failed',
];

function asFixStatus(value: unknown): FixStatus {
  return FIX_STATUSES.includes(value as FixStatus) ? (value as FixStatus) : 'none';
}

function asFixMode(value: unknown): FixMode | null {
  return value === 'branch' || value === 'pull_request' ? value : null;
}

export function fixStateFromRow(row: AnalysisFixRow): FixState {
  return {
    status: asFixStatus(row.fix_status),
    mode: asFixMode(row.fix_mode),
    targetRepository: row.fix_target_repository ?? null,
    targetOwner: row.fix_target_owner ?? null,
    headRepository: row.fix_head_repository ?? null,
    baseBranch: row.fix_base_branch ?? row.repository_branch ?? null,
    baseCommit: row.fix_base_commit ?? row.repository_commit ?? null,
    usedFork: row.fix_used_fork === true,
    error: row.fix_error ?? null,
    updatedAt: row.fix_updated_at ?? null,
    attempts: typeof row.fix_attempts === 'number' ? row.fix_attempts : 0,
    branch: row.created_branch ?? null,
    commitSha: row.commit_sha ?? null,
    commitMessage: row.commit_message ?? null,
    filesChanged: Array.isArray(row.changed_files) ? row.changed_files : null,
    pullRequest: row.pull_request_url
      ? {
          number: typeof row.pull_request_number === 'number' ? row.pull_request_number : null,
          url: row.pull_request_url,
          state: row.pull_request_state ?? null,
          createdAt: row.pull_request_created_at ?? null,
        }
      : null,
    schemaReady: row.fix_status !== undefined && row.fix_status !== null,
  };
}

export async function loadAnalysisForFix(
  analysisId: string
): Promise<AnalysisFixRow | null> {
  const db = createBackgroundClient();
  const { data, error } = await db.from('analyses').select('*').eq('id', analysisId).single();
  if (error || !data) return null;
  return data as unknown as AnalysisFixRow;
}

/**
 * True when the write failed only because migration 024 is absent. Any other
 * error is a real storage failure the caller should surface.
 */
export function isMissingFixSchema(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const message = (error.message || '').toLowerCase();
  if (error.code === '42703' || error.code === 'PGRST204') return true;
  return (
    (message.includes('column') && message.includes('does not exist')) ||
    message.includes('could not find the')
  );
}

/** Legacy fields every deployment has; used when migration 024 is missing. */
function legacyColumns(patch: FixStatePatch): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (patch.patchStatus !== undefined) row.patch_status = patch.patchStatus;
  if (patch.branch !== undefined) row.created_branch = patch.branch;
  if (patch.commitSha !== undefined) row.commit_sha = patch.commitSha;
  if (patch.commitMessage !== undefined) row.commit_message = patch.commitMessage;
  // `changed_files` is JSONB. node-postgres turns a JS array into a Postgres
  // array literal (`{"src/a.js"}`), which jsonb rejects with "invalid input
  // syntax for type json", so the array is sent as JSON text instead. `null`
  // stays SQL NULL rather than becoming the JSON literal `null`.
  if (patch.filesChanged !== undefined) {
    row.changed_files =
      patch.filesChanged === null ? null : JSON.stringify(patch.filesChanged);
  }
  if (patch.appliedAt !== undefined) row.applied_at = patch.appliedAt;
  if (patch.pullRequest?.url !== undefined) row.pull_request_url = patch.pullRequest.url;
  return row;
}

function fullColumns(patch: FixStatePatch): Record<string, unknown> {
  const row = legacyColumns(patch);
  if (patch.status !== undefined) row.fix_status = patch.status;
  if (patch.mode !== undefined) row.fix_mode = patch.mode;
  if (patch.targetRepository !== undefined) row.fix_target_repository = patch.targetRepository;
  if (patch.targetOwner !== undefined) row.fix_target_owner = patch.targetOwner;
  if (patch.headRepository !== undefined) row.fix_head_repository = patch.headRepository;
  if (patch.baseBranch !== undefined) row.fix_base_branch = patch.baseBranch;
  if (patch.baseCommit !== undefined) row.fix_base_commit = patch.baseCommit;
  if (patch.usedFork !== undefined) row.fix_used_fork = patch.usedFork;
  if (patch.error !== undefined) row.fix_error = patch.error;
  if (patch.attempts !== undefined) row.fix_attempts = patch.attempts;
  if (patch.pullRequest?.number !== undefined) row.pull_request_number = patch.pullRequest.number;
  if (patch.pullRequest?.state !== undefined) row.pull_request_state = patch.pullRequest.state;
  if (patch.pullRequest?.createdAt !== undefined) {
    row.pull_request_created_at = patch.pullRequest.createdAt;
  }
  row.fix_updated_at = new Date().toISOString();
  return row;
}

export async function writeFixState(
  analysisId: string,
  userId: string,
  patch: FixStatePatch
): Promise<{ ok: boolean; schemaReady: boolean; error?: string }> {
  const db = createBackgroundClient();

  const full = await db
    .from('analyses')
    .update(fullColumns(patch))
    .eq('id', analysisId)
    .eq('user_id', userId);

  if (!full.error) return { ok: true, schemaReady: true };

  if (!isMissingFixSchema(full.error)) {
    console.error('[fix] Could not persist fix state:', full.error.message);
    return { ok: false, schemaReady: false, error: full.error.message };
  }

  // Migration 024 has not been applied. Persist what exists so the workflow is
  // still resumable through the legacy columns.
  const legacy = await db
    .from('analyses')
    .update(legacyColumns(patch))
    .eq('id', analysisId)
    .eq('user_id', userId);

  if (legacy.error) {
    console.error('[fix] Could not persist legacy patch state:', legacy.error.message);
    return { ok: false, schemaReady: false, error: legacy.error.message };
  }

  return { ok: true, schemaReady: false };
}
