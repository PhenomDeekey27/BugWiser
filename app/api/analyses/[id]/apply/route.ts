import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { createBackgroundClient } from '@/lib/supabase/background';
import { applyPatchToGitHub } from '@/lib/analysis/apply-patch';
import {
  assertTokenPermissions,
  getRepositoryAccessToken,
} from '@/lib/github/app/access';
import { githubErrorResponse } from '@/lib/github/app/http';
import { Patch, ApplyFixError } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
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

  const { data: patchArtifact, error: patchError } = await db
    .from('analysis_artifacts')
    .select('data')
    .eq('analysis_id', id)
    .eq('artifact_type', 'patch')
    .single();

  if (patchError || !patchArtifact) {
    return NextResponse.json({ error: 'No patch found for this analysis.' }, { status: 404 });
  }

  const patchData = patchArtifact.data as unknown as Patch;
  if (!patchData?.files || patchData.files.length === 0) {
    return NextResponse.json({ error: 'Patch contains no files to apply.' }, { status: 400 });
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

  return NextResponse.json(result);
}
