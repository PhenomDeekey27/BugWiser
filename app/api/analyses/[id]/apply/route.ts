import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { createBackgroundClient } from '@/lib/supabase/background';
import { applyPatchToGitHub } from '@/lib/analysis/apply-patch';
import {
  getStagedWorkspaceFiles,
  loadAnalysisWorkspace,
  stageAnalysisWorkspace,
} from '@/lib/analysis/workspace';
import {
  assertTokenPermissions,
  getRepositoryAccessToken,
} from '@/lib/github/app/access';
import { githubErrorResponse } from '@/lib/github/app/http';
import { normalizeCommitSha } from '@/lib/github/public';
import { Patch, ApplyFixError } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface ApplyBody {
  confirm?: unknown;
  push?: unknown;
  createPullRequest?: unknown;
}

/**
 * Applies a patch in two explicit steps:
 *
 *  1. default  -> stage the diff in the isolated analysis workspace (no remote write)
 *  2. push:true -> create a branch from the pinned commit, write the files, and
 *                  optionally open a pull request. Requires GitHub App write
 *                  access and is impossible for public-only analyses.
 *
 * A bare POST is treated as step 1, never as a remote write.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let body: ApplyBody = {};
  try {
    body = (await request.json()) as ApplyBody;
  } catch {
    // Body is optional for the workspace-staging path only.
  }

  if (body.confirm !== true) {
    return NextResponse.json(
      {
        error: 'Explicit confirmation is required before applying this patch.',
        code: 'confirmation_required',
      },
      { status: 400 }
    );
  }

  const db = createBackgroundClient();
  const { data: analysis, error: fetchError } = await db
    .from('analyses')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchError || !analysis) {
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

  const patchData = patchArtifact.data as unknown as Patch;
  if (!patchData?.files || patchData.files.length === 0) {
    return NextResponse.json({ error: 'Patch contains no files to apply.' }, { status: 400 });
  }

  // ── Step 1: isolated workspace (default) ────────────────────────────────
  if (body.push !== true) {
    const outcome = await stageAnalysisWorkspace({
      analysisId: id,
      userId: user.userId,
      patch: patchData,
      baseCommitSha: analysis.repository_commit,
    });

    if (!outcome.ok) {
      return NextResponse.json(
        { error: outcome.error, code: outcome.code },
        { status: 400 }
      );
    }

    return NextResponse.json({
      mode: 'workspace',
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

  // ── Step 2: explicit push to GitHub ─────────────────────────────────────
  if (analysis.repository_source === 'public') {
    return NextResponse.json(
      {
        error:
          'This analysis was imported from a public repository without GitHub access. Staged changes cannot be pushed automatically.',
        code: 'requires_github_access',
      },
      { status: 409 }
    );
  }

  if (analysis.patch_status === 'applied') {
    return NextResponse.json(
      {
        error: 'Patch has already been applied to this analysis.',
        branch: analysis.created_branch,
        commitSha: analysis.commit_sha,
      },
      { status: 409 }
    );
  }

  const baseSha = normalizeCommitSha(analysis.repository_commit || '');
  if (!baseSha) {
    return NextResponse.json(
      {
        error: 'This analysis is not pinned to a commit, so it cannot be pushed safely.',
        code: 'invalid_base_commit',
      },
      { status: 409 }
    );
  }

  const workspace = await loadAnalysisWorkspace(id, user.userId);
  const stagedFiles = await getStagedWorkspaceFiles(id, user.userId);
  if (workspace?.status !== 'staged' || stagedFiles.length === 0) {
    return NextResponse.json(
      {
        error: 'Stage and review the patch in the workspace before pushing it to GitHub.',
        code: 'workspace_not_staged',
      },
      { status: 409 }
    );
  }

  let repositoryAccess;
  try {
    repositoryAccess = await getRepositoryAccessToken(
      user.userId,
      analysis.repository_full_name
    );
    assertTokenPermissions(repositoryAccess.token, { contents: 'write' });
  } catch (error) {
    return githubErrorResponse(error);
  }

  await db
    .from('analyses')
    .update({ patch_status: 'pending' })
    .eq('id', id)
    .eq('user_id', user.userId);

  const { owner, name: repo } = repositoryAccess.repository;

  const result = await applyPatchToGitHub({
    token: repositoryAccess.token.token,
    owner,
    repo,
    analysisId: id,
    patch: patchData,
    issueNumber: analysis.issue_number,
    baseSha,
    openPullRequest: body.createPullRequest === true,
  });

  if (!result.success) {
    await db
      .from('analyses')
      .update({ patch_status: 'failed' })
      .eq('id', id)
      .eq('user_id', user.userId);

    const errorResult = result as ApplyFixError;
    const isPermissionError =
      errorResult.error?.includes('404') || errorResult.error?.includes('403');

    return NextResponse.json(
      {
        ...errorResult,
        code: isPermissionError ? 'insufficient_permissions' : errorResult.code,
      },
      { status: 400 }
    );
  }

  await db
    .from('analyses')
    .update({
      patch_status: 'applied',
      created_branch: result.branch,
      commit_sha: result.commitSha,
      commit_message: result.commitMessage,
      changed_files: result.filesChanged,
      applied_at: new Date().toISOString(),
      pull_request_url: result.pullRequestUrl || null,
      github_installation_id: repositoryAccess.installationId,
    })
    .eq('id', id)
    .eq('user_id', user.userId);

  return NextResponse.json({ mode: 'pushed', ...result });
}
