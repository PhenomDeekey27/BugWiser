import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { createBackgroundClient } from '@/lib/supabase/background';
import {
  discardAnalysisWorkspace,
  loadAnalysisWorkspace,
  stageAnalysisWorkspace,
} from '@/lib/analysis/workspace';
import type { Patch } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

interface WorkspaceBody {
  confirm?: unknown;
  baseCommit?: unknown;
}

/**
 * The isolated workspace is the only place a patch is applied by default.
 * Nothing here touches GitHub: staging writes per-analysis rows so the diff can
 * be reviewed before any explicit push.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const workspace = await loadAnalysisWorkspace(id, user.userId);
  if (!workspace) {
    return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
  }

  return NextResponse.json({ workspace });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let body: WorkspaceBody = {};
  try {
    body = (await request.json()) as WorkspaceBody;
  } catch {
    // An empty body is accepted only because confirmation is checked below.
  }

  // Staging rewrites the stored workspace, so it must be an explicit action.
  if (body.confirm !== true) {
    return NextResponse.json(
      { error: 'Confirm that you want to stage this patch in the workspace.', code: 'confirmation_required' },
      { status: 400 }
    );
  }

  const db = createBackgroundClient();
  const { data: analysis, error: analysisError } = await db
    .from('analyses')
    .select('id, user_id, repository_commit')
    .eq('id', id)
    .single();

  if (analysisError || !analysis) {
    return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
  }
  if (analysis.user_id !== user.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: patchArtifact, error: patchError } = await db
    .from('analysis_artifacts')
    .select('data')
    .eq('analysis_id', id)
    .eq('artifact_type', 'patch')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (patchError || !patchArtifact) {
    return NextResponse.json({ error: 'No patch found for this analysis.' }, { status: 404 });
  }

  const patch = patchArtifact.data as unknown as Patch;
  if (!patch?.files?.length) {
    return NextResponse.json({ error: 'Patch contains no files to stage.' }, { status: 400 });
  }

  if (!analysis.repository_commit) {
    return NextResponse.json(
      {
        error: 'This analysis is not pinned to a commit, so a workspace cannot be staged.',
        code: 'invalid_base_commit',
      },
      { status: 409 }
    );
  }

  const baseCommit =
    typeof body.baseCommit === 'string' ? body.baseCommit : analysis.repository_commit;

  const outcome = await stageAnalysisWorkspace({
    analysisId: id,
    userId: user.userId,
    patch,
    baseCommitSha: baseCommit,
  });

  if (!outcome.ok) {
    return NextResponse.json(
      { error: outcome.error, code: outcome.code },
      { status: outcome.code === 'file_not_in_snapshot' ? 409 : 400 }
    );
  }

  return NextResponse.json({
    ok: true,
    baseCommit: analysis.repository_commit,
    files: outcome.files.map((file) => ({
      path: file.path,
      additions: file.additions,
      deletions: file.deletions,
      diff: file.diff,
    })),
    workspace: outcome.workspace,
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const discarded = await discardAnalysisWorkspace(id, user.userId);
  if (!discarded) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
