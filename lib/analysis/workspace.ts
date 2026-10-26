// Server-side workspace persistence.
//
// A workspace is the patch applied to the exact snapshot the analysis was
// generated from. It is stored per analysis and never written back to GitHub
// from this module.

import { createBackgroundClient } from '@/lib/supabase/background';
import { stagePatchInWorkspace, type StagePatchResult } from './workspace-core';
import type { Patch, WorkspaceFileRecord, WorkspaceSummary, VerificationPlanRecord } from '@/types';

interface SourceFileArtifact {
  files?: Array<{ path: string; content: string }>;
  commitSha?: string;
}

async function getAnalysis(analysisId: string, userId: string) {
  const db = createBackgroundClient();
  const { data, error } = await db
    .from('analyses')
    .select('*')
    .eq('id', analysisId)
    .single();

  if (error || !data) return null;
  if (data.user_id !== userId) return null;
  return data;
}

async function getArtifact<T>(analysisId: string, type: string): Promise<T | null> {
  const db = createBackgroundClient();
  const { data, error } = await db
    .from('analysis_artifacts')
    .select('data')
    .eq('analysis_id', analysisId)
    .eq('artifact_type', type)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data.data as T;
}

export type WorkspaceStageOutcome = StagePatchResult & {
  workspace?: WorkspaceSummary;
};

export async function stageAnalysisWorkspace(input: {
  analysisId: string;
  userId: string;
  patch: Patch;
  baseCommitSha?: string | null;
}): Promise<WorkspaceStageOutcome> {
  const analysis = await getAnalysis(input.analysisId, input.userId);
  if (!analysis) {
    return { ok: false, code: 'file_not_in_snapshot', error: 'Analysis not found or not accessible.' };
  }

  const sourceArtifact = await getArtifact<SourceFileArtifact>(input.analysisId, 'source_files');
  const sources = (sourceArtifact?.files || [])
    .filter((file) => typeof file.path === 'string' && typeof file.content === 'string')
    .map((file) => ({ path: file.path, content: file.content }));

  const analysisCommit = analysis.repository_commit || null;
  const baseCommit = input.baseCommitSha || analysisCommit;

  const staged = stagePatchInWorkspace({
    patch: input.patch,
    sources,
    analysisCommitSha: analysisCommit,
    baseCommitSha: baseCommit,
  });

  if (!staged.ok) return staged;

  const db = createBackgroundClient();
  const { error: deleteError } = await db
    .from('analysis_workspace_files')
    .delete()
    .eq('analysis_id', input.analysisId);

  if (deleteError) {
    return {
      ok: false,
      code: 'hunk_failed',
      error: `Could not clear the previous workspace: ${deleteError.message}`,
    };
  }

  const rows = staged.files.map((file) => ({
    analysis_id: input.analysisId,
    path: file.path,
    base_commit: analysisCommit,
    base_content: file.baseContent,
    content: file.content,
    diff: file.diff,
    additions: file.additions,
    deletions: file.deletions,
  }));

  const { error: insertError } = await db.from('analysis_workspace_files').insert(rows);
  if (insertError) {
    return {
      ok: false,
      code: 'hunk_failed',
      error: `Could not store the workspace: ${insertError.message}`,
    };
  }

  await db
    .from('analyses')
    .update({
      workspace_status: 'staged',
      workspace_staged_at: new Date().toISOString(),
    })
    .eq('id', input.analysisId)
    .eq('user_id', input.userId);

  return {
    ok: true,
    files: staged.files,
    summary: staged.summary,
    workspace: await loadAnalysisWorkspace(input.analysisId, input.userId) ?? undefined,
  };
}

export async function loadAnalysisWorkspace(
  analysisId: string,
  userId: string
): Promise<WorkspaceSummary | null> {
  const analysis = await getAnalysis(analysisId, userId);
  if (!analysis) return null;

  const db = createBackgroundClient();
  const { data, error } = await db
    .from('analysis_workspace_files')
    .select('*')
    .eq('analysis_id', analysisId)
    .order('path', { ascending: true });

  if (error) {
    console.error('[workspace] Failed to read workspace:', error.message);
    return null;
  }

  const verification = await getArtifact<VerificationPlanRecord>(analysisId, 'verification');
  const files = (data as WorkspaceFileRecord[]) || [];

  return {
    status: (analysis.workspace_status as WorkspaceSummary['status']) || (files.length > 0 ? 'staged' : 'none'),
    stagedAt: analysis.workspace_staged_at || null,
    baseCommit: analysis.repository_commit || null,
    files,
    verification: verification || null,
  };
}

export async function discardAnalysisWorkspace(
  analysisId: string,
  userId: string
): Promise<boolean> {
  const analysis = await getAnalysis(analysisId, userId);
  if (!analysis) return false;

  const db = createBackgroundClient();
  const { error } = await db
    .from('analysis_workspace_files')
    .delete()
    .eq('analysis_id', analysisId);

  if (error) {
    console.error('[workspace] Failed to discard workspace:', error.message);
    return false;
  }

  await db
    .from('analyses')
    .update({ workspace_status: 'discarded', workspace_staged_at: null })
    .eq('id', analysisId)
    .eq('user_id', userId);

  return true;
}

/** Workspace contents used when the user explicitly approves a push. */
export async function getStagedWorkspaceFiles(
  analysisId: string,
  userId: string
): Promise<WorkspaceFileRecord[]> {
  const workspace = await loadAnalysisWorkspace(analysisId, userId);
  return workspace?.files || [];
}
