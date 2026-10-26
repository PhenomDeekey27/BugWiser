import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { createBackgroundClient } from '@/lib/supabase/background';
import { getRepositoryAccessToken } from '@/lib/github/app/access';
import { publicReadToken } from '@/lib/analysis/repository-source';
import {
  buildClonePlan,
  loadCloneContext,
  loadCompareFiles,
} from '@/lib/analysis/clone-instructions';

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

  if (analysis.user_id !== user.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Public imports never leave BugWiser, so their reads are anonymous. An
  // installation analysis uses its token to read a private repository, and
  // falls back to anonymous reads when the installation is gone: the clone
  // commands themselves never carry credentials either way.
  let token: string | null = null;
  if (analysis.repository_source === 'public') {
    token = publicReadToken();
  } else {
    try {
      const access = await getRepositoryAccessToken(user.userId, analysis.repository_full_name);
      token = access.token.token;
    } catch (error) {
      console.warn(
        '[api/analyses/clone] Falling back to anonymous reads:',
        error instanceof Error ? error.message : String(error)
      );
    }
  }

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
    return NextResponse.json(
      { error: 'Could not resolve the repository for this analysis.', code: 'clone_lookup_failed' },
      { status: 502, headers: NO_STORE }
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
    return NextResponse.json(
      { error: plan.message, code: plan.code },
      { status: 400, headers: NO_STORE }
    );
  }

  if (new URL(request.url).searchParams.get('diff') !== '1') {
    return NextResponse.json({ plan: plan.plan }, { headers: NO_STORE });
  }

  // A fork-hosted branch cannot be compared through this repository's compare
  // endpoint, and guessing an owner:branch form is not worth the risk. The plan
  // already carries git commands and a GitHub compare URL for that case.
  if (!plan.plan.compare.serverSide) {
    return NextResponse.json(
      {
        error:
          plan.plan.fixIsFork
            ? 'The fix branch is on a fork, so the comparison must run from the git commands (or the GitHub compare link).'
            : 'A commit-to-commit comparison is not available for this analysis.',
        code: 'compare_unavailable',
        compare: plan.plan.compare,
      },
      { status: 409, headers: NO_STORE }
    );
  }

  const outcome = await loadCompareFiles({
    repositoryFullName: plan.plan.fixRepositoryFullName || analysis.repository_full_name,
    baseCommit: plan.plan.baseCommit,
    headCommit: plan.plan.fixCommit,
    token,
  });

  if (!outcome.ok) {
    return NextResponse.json(
      { error: outcome.message, code: outcome.code },
      { status: outcome.code === 'not_found' ? 404 : 502, headers: NO_STORE }
    );
  }

  return NextResponse.json({ compare: outcome.result }, { headers: NO_STORE });
}
