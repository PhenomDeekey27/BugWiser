import { NextResponse } from 'next/server';
import {
  applyCredentialRefresh,
  resolveGitHubCredential,
  type GitHubCredentialResult,
} from '@/lib/auth/github-token';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { createBackgroundClient } from '@/lib/supabase/background';
import { publicReadToken } from '@/lib/analysis/repository-source';
import {
  buildClonePlan,
  loadCloneContext,
  loadCompareFiles,
} from '@/lib/analysis/clone-instructions';
import { isAnalysisVisibleTo } from '@/lib/analysis/ownership';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * Read-only clone and compare information for one analysis.
 *
 * `GET ?`        -> clone commands for the pinned original and the fix branch
 * `GET ?diff=1`  -> the authoritative base..fix diff (same repository only)
 *
 * Nothing here writes to GitHub, and no token is ever returned to the client.
 */
export async function GET(
  request: Request,
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

  if (!isAnalysisVisibleTo(analysis.user_id, user.userId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Public imports are read anonymously. An authenticated analysis uses the
  // session's token for private repositories and falls back to anonymous reads
  // when there is none: the clone commands never carry credentials either way.
  let token: string | null = analysis.repository_source === 'public' ? publicReadToken() : null;
  let credential: GitHubCredentialResult | null = null;

  if (analysis.repository_source !== 'public') {
    const resolved = await resolveGitHubCredential();
    if (resolved.ok) {
      credential = resolved;
      token = resolved.credential.accessToken;
    } else {
      console.warn(
        '[api/analyses/clone] No GitHub credential (%s); falling back to anonymous reads.',
        resolved.reason
      );
      token = publicReadToken();
    }
  }

  // Every response below may carry a rotated GitHub credential, so one helper
  // re-seals the session whenever a refresh happened.
  const respond = (body: unknown, status = 200): NextResponse => {
    const response = NextResponse.json(body, { status, headers: NO_STORE });
    return credential ? applyCredentialRefresh(response, credential) : response;
  };

  let context;
  try {
    context = await loadCloneContext({
      repositoryFullName: analysis.repository_full_name,
      baseBranch: analysis.repository_branch,
      fixBranch: analysis.created_branch,
      pullRequestUrl: analysis.pull_request_url,
      knownPublic: analysis.repository_source === 'public',
      token,
    });
  } catch (error) {
    console.error(
      '[api/analyses/clone] Could not resolve the repository:',
      error instanceof Error ? error.message : String(error)
    );
    return respond(
      { error: 'Could not resolve the repository for this analysis.', code: 'clone_lookup_failed' },
      502
    );
  }

  const plan = buildClonePlan({
    repositoryFullName: analysis.repository_full_name,
    repositoryUrl: analysis.repository_url,
    baseBranch: analysis.repository_branch,
    baseCommit: analysis.repository_commit,
    baseBranchExists: context.baseBranchExists,
    fix: context.fix,
    isPrivate: context.repository.isPrivate,
  });

  if (!plan.ok) {
    return respond({ error: plan.message, code: plan.code }, 400);
  }

  if (new URL(request.url).searchParams.get('diff') !== '1') {
    return respond({ plan: plan.plan });
  }

  // A fork-hosted branch cannot be compared through this repository's compare
  // endpoint, and guessing an owner:branch form is not worth the risk. The plan
  // already carries git commands and a GitHub compare URL for that case.
  if (!plan.plan.compare.serverSide) {
    return respond(
      {
        error:
          plan.plan.fixIsFork
            ? 'The fix branch is on a fork, so the comparison must run from the git commands (or the GitHub compare link).'
            : 'A commit-to-commit comparison is not available for this analysis.',
        code: 'compare_unavailable',
        compare: plan.plan.compare,
      },
      409
    );
  }

  const outcome = await loadCompareFiles({
    repositoryFullName: plan.plan.fixRepositoryFullName || analysis.repository_full_name,
    baseCommit: plan.plan.baseCommit,
    headCommit: plan.plan.fixCommit,
    token,
  });

  if (!outcome.ok) {
    return respond(
      { error: outcome.message, code: outcome.code },
      outcome.code === 'not_found' ? 404 : 502
    );
  }

  return respond({ compare: outcome.result });
}
