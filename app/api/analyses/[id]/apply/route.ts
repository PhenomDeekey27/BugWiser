import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { createBackgroundClient } from '@/lib/supabase/background';
import { applyPatchToGitHub, type ApplyStage } from '@/lib/analysis/apply-patch';
import {
  getStagedWorkspaceFiles,
  loadAnalysisWorkspace,
  stageAnalysisWorkspace,
} from '@/lib/analysis/workspace';
import {
  applyCredentialRefresh,
  githubAuthErrorResponse,
  resolveGitHubCredential,
} from '@/lib/auth/github-token';
import { resolveAppBaseUrl } from '@/lib/auth/app-url';
import { normalizeCommitSha } from '@/lib/github/public';
import { GitHubError, sanitizeGitHubMessage } from '@/lib/github/errors';
import { resolveFixTarget, type FixTargetMode } from '@/lib/github/fix-target';
import {
  fixStateFromRow,
  writeFixState,
  type AnalysisFixRow,
} from '@/lib/analysis/fix-session';
import { fixBranchName } from '@/lib/analysis/fix-branch';
import type { ApplyFixError, ApplyFixErrorCode, ApplyFixResult, FixMode, Patch } from '@/types';
import { isAnalysisVisibleTo } from '@/lib/analysis/ownership';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface ApplyBody {
  confirm?: unknown;
  push?: unknown;
  createPullRequest?: unknown;
  target?: unknown;
  commitMessage?: unknown;
}

/** A run that has not reported progress for this long is retryable. */
const IN_PROGRESS_STALE_MS = 3 * 60_000;

const IN_PROGRESS: ReadonlySet<string> = new Set([
  'branch_creating',
  'branch_created',
  'committing',
  'committed',
  'pushing',
  'creating_pr',
]);

function loginUrlFor(request: Request, analysisId: string): string {
  const base = resolveAppBaseUrl(process.env, request.url);
  const returnTo = `/analysis/${analysisId}`;
  return `${base}/api/auth/github/start?returnTo=${encodeURIComponent(returnTo)}&force=1`;
}

function httpStatusFor(code: ApplyFixErrorCode | undefined): number {
  switch (code) {
    case 'auth_failure':
    case 'token_expired':
    case 'requires_github_login':
      return 401;
    case 'permission_denied':
    case 'insufficient_permissions':
    case 'fork_unavailable':
      return 403;
    case 'repository_not_found':
      return 404;
    case 'branch_exists':
    case 'missing_base_branch':
    case 'stale_base_commit':
    case 'workspace_not_staged':
    case 'fix_in_progress':
      return 409;
    case 'rate_limited':
      return 429;
    default:
      return 400;
  }
}

function readTarget(value: unknown): FixTargetMode {
  return value === 'upstream' || value === 'fork' ? value : 'auto';
}

function readMode(openPullRequest: boolean): FixMode {
  return openPullRequest ? 'pull_request' : 'branch';
}

/** A completed workflow is returned as-is, so a retry never forks or pushes twice. */
function completedResult(row: AnalysisFixRow, fix: ReturnType<typeof fixStateFromRow>): ApplyFixResult {
  return {
    success: true,
    branch: fix.branch || '',
    commitSha: fix.commitSha || '',
    commitMessage: fix.commitMessage || '',
    filesChanged: fix.filesChanged || [],
    repositoryFullName: fix.targetRepository || row.repository_full_name,
    upstreamFullName: row.repository_full_name,
    defaultBranch: fix.baseBranch || row.repository_default_branch || row.repository_branch || 'main',
    pullRequestUrl: fix.pullRequest?.url || undefined,
    pullRequestNumber: fix.pullRequest?.number ?? undefined,
    usedFork: fix.usedFork,
    headOwner: fix.targetOwner || undefined,
    fixStatus: 'pr_created',
  };
}

/**
 * Applies a patch in two explicit steps:
 *
 *  1. default  -> stage the diff in the isolated analysis workspace (no remote write)
 *  2. push:true -> create a branch from the pinned commit, write the staged files,
 *                  push, and optionally open a pull request.
 *
 * Both public-import analyses and authenticated analyses use the same path. The
 * difference is authorization only: a guest is asked to sign in (the staged
 * workspace and the analysis are preserved), and a signed-in user without write
 * access to the original repository pushes to their fork and opens the PR
 * against the upstream repository.
 *
 * A bare POST is treated as step 1, never as a remote write.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  if (!isAnalysisVisibleTo(analysis.user_id, user.userId)) {
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
      return NextResponse.json({ error: outcome.error, code: outcome.code }, { status: 400 });
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
  const row = analysis as unknown as AnalysisFixRow;
  const fix = fixStateFromRow(row);
  const openPullRequest = body.createPullRequest === true;
  const mode = readMode(openPullRequest);
  const targetMode = readTarget(body.target);

  // A completed workflow is idempotent: return what GitHub already has instead
  // of creating a second branch or pull request.
  if (fix.status === 'pr_created' && fix.pullRequest?.url) {
    return NextResponse.json({ mode: 'pushed', alreadyComplete: true, ...completedResult(row, fix) });
  }

  const updatedAt = fix.updatedAt ? Date.parse(fix.updatedAt) : NaN;
  const inProgress =
    IN_PROGRESS.has(fix.status) &&
    Number.isFinite(updatedAt) &&
    Date.now() - updatedAt < IN_PROGRESS_STALE_MS;
  if (inProgress) {
    return NextResponse.json(
      {
        success: false,
        error: 'A fix is already being pushed for this analysis. Wait for it to finish, then retry.',
        code: 'fix_in_progress',
        stage: fix.status,
      } satisfies ApplyFixError,
      { status: 409 }
    );
  }

  const workspace = await loadAnalysisWorkspace(id, user.userId);
  const stagedFiles = await getStagedWorkspaceFiles(id, user.userId);
  if (workspace?.status !== 'staged' || stagedFiles.length === 0) {
    return NextResponse.json(
      {
        success: false,
        error: 'Stage and review the patch in the workspace before pushing it to GitHub.',
        code: 'workspace_not_staged',
      } satisfies ApplyFixError,
      { status: 409 }
    );
  }

  const baseSha = normalizeCommitSha(analysis.repository_commit || '');
  if (!baseSha) {
    return NextResponse.json(
      {
        success: false,
        error: 'This analysis is not pinned to a commit, so it cannot be pushed safely.',
        code: 'patch_validation_failed',
        stage: 'branch_creating',
      } satisfies ApplyFixError,
      { status: 409 }
    );
  }

  // BugWiser authentication is not repository authorization: resolving the
  // credential is a separate step, and its absence is what sends a public-import
  // session through GitHub without losing the investigation.
  const credential = await resolveGitHubCredential();
  if (!credential.ok) {
    await writeFixState(id, user.userId, {
      status: 'awaiting_authorization',
      mode,
      baseBranch: analysis.repository_branch || analysis.repository_default_branch || null,
      baseCommit: baseSha,
      error: 'GitHub authorization is required before a branch can be created.',
    });

    return applyCredentialRefresh(
      NextResponse.json(
        {
          success: false,
          error:
            'Sign in with GitHub to create the fix branch and pull request. Your analysis and staged patch are saved.',
          code: 'requires_github_login',
          stage: 'awaiting_authorization',
          loginUrl: loginUrlFor(request, id),
          preserved: true,
        },
        { status: 401 }
      ),
      credential
    );
  }

  // Where the branch may go: upstream if this token can push, otherwise the
  // user's fork. Never guessed — GitHub's own permission data decides.
  let target: Awaited<ReturnType<typeof resolveFixTarget>>;
  try {
    target = await resolveFixTarget({
      token: credential.credential.accessToken,
      login: user.login,
      upstreamFullName: analysis.repository_full_name,
      preferredBranch: analysis.repository_branch || analysis.repository_default_branch || null,
      pinnedCommitSha: baseSha,
      mode: targetMode,
    });
  } catch (error) {
    const failure = applyFailure(
      error,
      'insufficient_permissions',
      'branch_creating',
      'Could not resolve a repository to push to.'
    );
    await writeFixState(id, user.userId, {
      status: 'failed',
      mode,
      error: failure.error,
      attempts: fix.attempts + 1,
    });
    const unauthorized = failure.code === 'token_expired' || failure.code === 'insufficient_permissions';
    return applyCredentialRefresh(
      NextResponse.json(
        {
          ...failure,
          ...(unauthorized ? { loginUrl: loginUrlFor(request, id), preserved: true } : {}),
        },
        { status: httpStatusFor(failure.code) }
      ),
      credential
    );
  }

  const branchName = fix.branch || fixBranchName({ analysisId: id, issueNumber: analysis.issue_number });
  const attempts = fix.attempts + 1;
  const appBaseUrl = resolveAppBaseUrl(process.env, request.url);

  // Persist enough to resume before the first GitHub write happens.
  await writeFixState(id, user.userId, {
    status: 'branch_creating',
    mode,
    attempts,
    error: null,
    targetRepository: target.pushRepoFullName,
    targetOwner: target.owner,
    headRepository: target.fullName,
    baseBranch: target.baseBranch,
    baseCommit: target.baseCommitSha,
    usedFork: target.kind === 'fork',
    branch: branchName,
  });

  const result = await applyPatchToGitHub({
    token: credential.credential.accessToken,
    owner: target.owner,
    repo: target.repo,
    analysisId: id,
    patch: patchData,
    stagedFiles: stagedFiles.map((file) => ({
      path: file.path,
      baseContent: file.base_content,
      content: file.content,
      additions: file.additions,
      deletions: file.deletions,
    })),
    issueNumber: analysis.issue_number,
    issueUrl: analysis.issue_url || null,
    baseSha: target.baseCommitSha,
    baseBranch: target.baseBranch,
    branchName,
    headOwner: target.kind === 'fork' ? target.login : null,
    upstreamFullName: target.upstreamFullName,
    pullRequestOwner: target.upstreamOwner,
    pullRequestRepo: target.upstreamRepo,
    openPullRequest,
    reuseBranch: true,
    commitMessage: typeof body.commitMessage === 'string' ? body.commitMessage : null,
    appBaseUrl,
    onStage: async (next: ApplyStage) => {
      await writeFixState(id, user.userId, {
        status: next,
        mode,
        attempts,
        error: null,
        targetRepository: target.pushRepoFullName,
        targetOwner: target.owner,
        headRepository: target.fullName,
        baseBranch: target.baseBranch,
        baseCommit: target.baseCommitSha,
        usedFork: target.kind === 'fork',
        branch: branchName,
      });
    },
  });

  if (!result.success) {
    const failure = result as ApplyFixError;
    await writeFixState(id, user.userId, {
      status: failure.code === 'token_expired' ? 'awaiting_authorization' : 'failed',
      mode,
      attempts,
      error: failure.error,
      patchStatus: 'failed',
    });

    const unauthorized =
      failure.code === 'token_expired' ||
      failure.code === 'auth_failure' ||
      failure.code === 'insufficient_permissions' ||
      failure.code === 'permission_denied';
    const status = httpStatusFor(failure.code);

    return applyCredentialRefresh(
      NextResponse.json(
        {
          ...failure,
          ...(unauthorized
            ? { loginUrl: loginUrlFor(request, id), preserved: true }
            : {}),
        },
        { status }
      ),
      credential
    );
  }

  const pullRequestFailed = result.fixStatus === 'pr_failed';
  await writeFixState(id, user.userId, {
    status: result.fixStatus || 'pushed',
    mode,
    attempts,
    error: result.pullRequestError || null,
    patchStatus: 'applied',
    appliedAt: new Date().toISOString(),
    branch: result.branch,
    commitSha: result.commitSha,
    commitMessage: result.commitMessage,
    filesChanged: result.filesChanged,
    targetRepository: result.repositoryFullName,
    targetOwner: target.owner,
    headRepository: target.fullName,
    baseBranch: result.defaultBranch,
    baseCommit: target.baseCommitSha,
    usedFork: result.usedFork === true,
    ...(result.pullRequestUrl
      ? {
          pullRequest: {
            number: result.pullRequestNumber ?? null,
            url: result.pullRequestUrl,
            state: 'open',
            createdAt: new Date().toISOString(),
          },
        }
      : {}),
  });

  return applyCredentialRefresh(
    NextResponse.json(
      {
        mode: 'pushed',
        ...result,
        // The branch and commit are real even when the PR failed; the UI shows
        // the exact failed stage instead of a green success state.
        ...(pullRequestFailed
          ? {
              loginUrl: loginUrlFor(request, id),
              message: result.pullRequestError,
            }
          : {}),
      },
      { status: pullRequestFailed ? 502 : 200 }
    ),
    credential
  );
}

/** Current persisted workflow state, used when the tab reloads or is resumed. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const db = createBackgroundClient();
  const { data, error } = await db.from('analyses').select('*').eq('id', id).single();
  if (error || !data) {
    return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
  }
  if (!isAnalysisVisibleTo(data.user_id, user.userId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json(
    { fix: fixStateFromRow(data as unknown as AnalysisFixRow) },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

/** Maps a thrown GitHub/unknown error to the same shape the service returns. */
function applyFailure(
  error: unknown,
  fallback: ApplyFixErrorCode,
  stage: ApplyFixError['stage'],
  fallbackMessage: string
): ApplyFixError {
  if (error instanceof GitHubError) {
    const code: ApplyFixErrorCode =
      error.code === 'auth_rejected'
        ? 'token_expired'
        : error.code === 'forbidden'
          ? 'insufficient_permissions'
          : error.code === 'not_found'
            ? 'repository_not_found'
            : error.code === 'rate_limited'
              ? 'rate_limited'
              : fallback;
    return { success: false, error: sanitizeGitHubMessage(error.message), code, stage };
  }
  if (error instanceof Error && error.message) {
    return { success: false, error: sanitizeGitHubMessage(error.message), code: fallback, stage };
  }
  return { success: false, error: fallbackMessage, code: fallback, stage };
}
