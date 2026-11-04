// Apply an approved patch to a real GitHub branch.
//
// Requirements this file encodes:
//
//   * the patch is only ever applied after the workspace has staged it and the
//     user approved (the route and workflow enforce that; this function refuses
//     to invent content for files it did not receive);
//   * the fix branch starts from the exact commit the analysis was generated
//     from, never from whatever the default branch happens to be now;
//   * one branch, one commit: the Git Data API builds a tree from the current
//     head, creates a single commit with that head as parent, then moves the ref.
//     The commit message is the generated one, not `fix: update <file>`;
//   * a retry resumes: a file whose content already equals the approved result
//     is not committed twice, and a file whose content equals neither the
//     approved base nor the approved result is a conflict that aborts the whole
//     commit instead of overwriting someone else's work;
//   * no branch is left behind when nothing could be applied, and the default
//     branch is never written to;
//   * a PR failure is reported as a PR failure — never as success and never as a
//     lost branch.

import type { ApplyFixError, ApplyFixErrorCode, ApplyFixResult, FixStatus, Patch } from '../../types/index.ts';
import { applyHunksDetailed } from './patch-lines.ts';
import { isSafeRepositoryPath } from './workspace-core.ts';
import { describeApplyFailure, fileHasChanges, findSyntaxRegression } from './patch-verify.ts';
import { normalizeCommitSha } from '../github/public.ts';
import { GitHubError, sanitizeGitHubMessage } from '../github/errors.ts';
import {
  commitExists,
  createBranch,
  createCommit,
  createPullRequest,
  createTree,
  deleteBranch,
  getBranch,
  getCommit,
  getDefaultBranch,
  getFileContent,
  listOpenPullRequests,
  updateRef,
} from '../github/write.ts';
import { fixBranchName, fixCommitMessage, fixPullRequestBody, fixPullRequestTitle } from './fix-branch.ts';

/** The approved result of staging one file in the analysis workspace. */
export interface StagedPatchFile {
  path: string;
  baseContent: string;
  content: string;
  additions?: number;
  deletions?: number;
}

export type ApplyStage =
  | 'branch_creating'
  | 'branch_created'
  | 'committing'
  | 'committed'
  | 'pushing'
  | 'pushed'
  | 'creating_pr';

export interface ApplyPatchContext {
  token: string;
  /** Repository the branch is pushed to (a fork when one is used). */
  owner: string;
  repo: string;
  analysisId: string;
  patch: Patch;
  /** Approved file contents from the workspace. Preferred over re-applying hunks. */
  stagedFiles?: readonly StagedPatchFile[] | null;
  /** GitHub issue number, or null/0 for a description-only analysis. */
  issueNumber?: number | null;
  /** Issue URL, used to link the pull request back to the issue. */
  issueUrl?: string | null;
  /** Exact commit the patch was generated from. */
  baseSha?: string | null;
  /** Creating a pull request is always explicit opt-in. */
  openPullRequest?: boolean;
  commitMessage?: string | null;
  /** Deterministic branch name; required for a resumable workflow. */
  branchName?: string;
  /** Base branch the PR targets and the fix branch was cut from. */
  baseBranch?: string;
  /** Fork owner when `owner` is a fork; drives the `owner:branch` PR head. */
  headOwner?: string | null;
  /** Original repository, used for PR text. Defaults to `owner/repo`. */
  upstreamFullName?: string;
  /** Repository the pull request is opened against. Defaults to `owner/repo`. */
  pullRequestOwner?: string;
  pullRequestRepo?: string;
  /** Allow resuming a branch this workflow previously created. */
  reuseBranch?: boolean;
  appBaseUrl?: string | null;
  /** Called as each stage starts/finishes, so the caller can persist progress. */
  onStage?: (stage: ApplyStage) => void | Promise<void>;
}

interface FailureContext {
  stage: FixStatus;
}

async function stage(ctx: ApplyPatchContext, next: ApplyStage): Promise<void> {
  if (!ctx.onStage) return;
  try {
    await ctx.onStage(next);
  } catch {
    // Progress reporting must never break the write itself.
  }
}

function failureFrom(
  error: unknown,
  fallbackCode: ApplyFixErrorCode,
  context: FailureContext
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
              : fallbackCode;
    return {
      success: false,
      error: sanitizeGitHubMessage(error.message),
      code,
      stage: context.stage,
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    success: false,
    error: sanitizeGitHubMessage(message) || 'The GitHub write failed.',
    code: fallbackCode,
    stage: context.stage,
  };
}

export function generateCommitMessage(patch: Patch, ctx: ApplyPatchContext): string {
  return fixCommitMessage({
    analysisId: ctx.analysisId,
    issueNumber: ctx.issueNumber,
    patchSummary: patch.summary,
    filesChanged: patch.files.map((file) => file.path),
    commitMessage: ctx.commitMessage,
  });
}

export { applyHunksToContent, applyHunksDetailed } from './patch-lines.ts';

/**
 * Applies a validated patch to a dedicated fix branch. Callers must have staged
 * and reviewed the patch in the analysis workspace; this function performs the
 * remote write only after explicit approval.
 */
export async function applyPatchToGitHub(
  ctx: ApplyPatchContext
): Promise<ApplyFixResult | ApplyFixError> {
  const { token, owner, repo, patch } = ctx;

  const allFiles = patch?.files || [];
  if (allFiles.length === 0) {
    return {
      success: false,
      error: 'No files to apply in the patch.',
      code: 'patch_validation_failed',
      stage: 'committing',
    };
  }

  // Never write outside the repository, whatever a generated artifact claims.
  const unsafe = allFiles.filter((file) => !isSafeRepositoryPath(file.path));
  if (unsafe.length > 0) {
    return {
      success: false,
      error: `Refusing to write outside the repository: ${unsafe
        .map((file) => JSON.stringify(file.path))
        .join(', ')}.`,
      code: 'patch_validation_failed',
      stage: 'committing',
    };
  }

  // The approved workspace content is authoritative. A staged file is part of
  // the fix even when the artifact carries no hunks (or hunks the generator
  // could not phrase), so it must not be filtered out by the hunk check.
  const staged = new Map((ctx.stagedFiles || []).map((file) => [file.path, file]));
  const patchFiles = allFiles.filter((file) => {
    const approved = staged.get(file.path);
    if (approved) return approved.content !== approved.baseContent || fileHasChanges(file);
    return fileHasChanges(file);
  });

  if (ctx.baseSha && !normalizeCommitSha(ctx.baseSha)) {
    return {
      success: false,
      error: 'The analysis base commit is not a valid full commit SHA.',
      code: 'patch_validation_failed',
      stage: 'branch_creating',
    };
  }

  // ── Base branch and pinned commit ──────────────────────────────────────────
  let baseBranch = ctx.baseBranch || '';
  let baseSha = ctx.baseSha ? normalizeCommitSha(ctx.baseSha) : null;

  try {
    if (!baseBranch || !baseSha) {
      const resolved = await getDefaultBranch(token, owner, repo);
      baseBranch = baseBranch || resolved.name;
      if (!baseSha) {
        const branch = await getBranch(token, owner, repo, baseBranch);
        if (!branch) {
          return {
            success: false,
            error: `The base branch "${baseBranch}" does not exist on ${owner}/${repo}.`,
            code: 'missing_base_branch',
            stage: 'branch_creating',
          };
        }
        baseSha = branch.sha;
      }
    }

    if (!baseSha || !(await commitExists(token, owner, repo, baseSha))) {
      return {
        success: false,
        error:
          'The commit this analysis was generated from no longer exists on the target repository. ' +
          'Re-run the analysis against a current commit before pushing.',
        code: 'stale_base_commit',
        stage: 'branch_creating',
      };
    }
  } catch (error) {
    return failureFrom(error, 'repository_not_found', { stage: 'branch_creating' });
  }

  // ── Branch: create once, resume safely afterwards ───────────────────────────
  const branchName =
    ctx.branchName ||
    fixBranchName({ analysisId: ctx.analysisId, issueNumber: ctx.issueNumber });

  let headSha = baseSha;
  let createdHere = false;

  try {
    const existing = await getBranch(token, owner, repo, branchName);
    if (existing) {
      if (!ctx.reuseBranch && existing.sha !== baseSha) {
        return {
          success: false,
          error:
            `The branch ${branchName} already exists with different changes. ` +
            'Refusing to overwrite it; delete it or push this fix manually.',
          code: 'branch_exists',
          stage: 'branch_creating',
        };
      }
      if (existing.protected) {
        return {
          success: false,
          error: `The branch ${branchName} is protected and cannot be written to.`,
          code: 'permission_denied',
          stage: 'branch_creating',
        };
      }
      headSha = existing.sha || baseSha;
    } else {
      await stage(ctx, 'branch_creating');
      await createBranch(token, owner, repo, branchName, baseSha);
      createdHere = true;
    }
  } catch (error) {
    return failureFrom(error, 'branch_creation_failed', { stage: 'branch_creating' });
  }

  // ── Verify every file before writing anything ──────────────────────────────
  const toWrite: Array<{ path: string; content: string }> = [];
  const filesChanged: string[] = [];
  const fileErrors: string[] = [];

  for (const file of patchFiles) {
    const approved = staged.get(file.path);
    let current: { content: string } | null = null;

    try {
      current = await getFileContent(token, owner, repo, file.path, branchName);
    } catch (error) {
      fileErrors.push(
        `${file.path}: ${error instanceof Error ? syncMessage(error) : 'could not be read'}`
      );
      continue;
    }

    if (!current) {
      fileErrors.push(`${file.path}: File not found on branch`);
      continue;
    }

    if (approved) {
      // Already applied by an earlier attempt: nothing to write, but the file
      // still counts as part of the fix.
      if (current.content === approved.content) {
        filesChanged.push(file.path);
        continue;
      }
      if (current.content !== approved.baseContent) {
        fileErrors.push(
          `${file.path}: The file changed since analysis, so the approved change no longer applies cleanly. ` +
            'Re-run the analysis for a current patch.'
        );
        continue;
      }
      toWrite.push({ path: file.path, content: approved.content });
      filesChanged.push(file.path);
      continue;
    }

    // Standalone callers may not have a staged workspace; apply the hunks
    // against the branch content and keep the same validation rules.
    const outcome = applyHunksDetailed(current.content, file.hunks);
    if (!outcome.ok) {
      fileErrors.push(describeApplyFailure(file.path, outcome));
      continue;
    }
    const syntaxProblem = findSyntaxRegression(current.content, outcome.content);
    if (syntaxProblem) {
      fileErrors.push(`${file.path}: ${syntaxProblem}.`);
      continue;
    }
    if (outcome.content === current.content) {
      filesChanged.push(file.path);
      continue;
    }
    toWrite.push({ path: file.path, content: outcome.content });
    filesChanged.push(file.path);
  }

  if (fileErrors.length > 0) {
    // All-or-nothing: commit the complete approved change or nothing at all, so
    // a partially applied fix can never be reported as a success.
    if (createdHere) await deleteBranch(token, owner, repo, branchName);
    return {
      success: false,
      error: `No files could be applied. ${fileErrors.join('; ')}`,
      code: 'patch_validation_failed',
      stage: 'committing',
    };
  }

  if (filesChanged.length === 0) {
    if (createdHere) await deleteBranch(token, owner, repo, branchName);
    return {
      success: false,
      error: 'No files could be applied: the patch contains no changes.',
      code: 'patch_validation_failed',
      stage: 'committing',
    };
  }

  // ── One commit with the correct parent ─────────────────────────────────────
  const commitMessage = fixCommitMessage({
    analysisId: ctx.analysisId,
    issueNumber: ctx.issueNumber,
    patchSummary: patch.summary,
    filesChanged,
    commitMessage: ctx.commitMessage,
  });

  if (toWrite.length > 0) {
    try {
      await stage(ctx, 'committing');

      const headCommit = await getCommit(token, owner, repo, headSha);
      if (!headCommit?.tree?.sha) {
        if (createdHere) await deleteBranch(token, owner, repo, branchName);
        return {
          success: false,
          error: `The branch ${branchName} is not based on a readable commit.`,
          code: 'stale_base_commit',
          stage: 'committing',
        };
      }

      const tree = await createTree(token, owner, repo, headCommit.tree.sha, toWrite);
      const commit = await createCommit(token, owner, repo, commitMessage, tree.sha, [headSha]);
      if (!commit?.sha) {
        if (createdHere) await deleteBranch(token, owner, repo, branchName);
        return {
          success: false,
          error: 'GitHub did not return a commit for the applied changes.',
          code: 'commit_failed',
          stage: 'committing',
        };
      }

      await stage(ctx, 'committed');
      await stage(ctx, 'pushing');

      // A non-fast-forward answer here means someone else advanced the branch;
      // never force it.
      await updateRef(token, owner, repo, `heads/${branchName}`, commit.sha);

      const verified = await getBranch(token, owner, repo, branchName);
      if (!verified || verified.sha !== commit.sha) {
        return {
          success: false,
          error: 'The fix branch was updated but GitHub did not confirm the new commit.',
          code: 'push_failed',
          stage: 'pushing',
        };
      }

      headSha = commit.sha;
      await stage(ctx, 'pushed');
    } catch (error) {
      if (createdHere) await deleteBranch(token, owner, repo, branchName);
      return failureFrom(error, 'commit_failed', { stage: 'committing' });
    }
  }

  // ── Pull request (explicit opt-in, duplicate-safe, honest failures) ────────
  const pushFullName = `${owner}/${repo}`;
  const upstreamFullName = ctx.upstreamFullName || pushFullName;
  const prOwner = ctx.pullRequestOwner || owner;
  const prRepo = ctx.pullRequestRepo || repo;
  const usedFork = ctx.headOwner ? ctx.headOwner.toLowerCase() !== prOwner.toLowerCase() : false;
  const head = usedFork ? `${ctx.headOwner}:${branchName}` : branchName;

  const result: ApplyFixResult = {
    success: true,
    branch: branchName,
    commitSha: headSha,
    commitMessage,
    filesChanged,
    repositoryFullName: pushFullName,
    upstreamFullName,
    defaultBranch: baseBranch,
    htmlUrl: `https://github.com/${pushFullName}/tree/${branchName}`,
    usedFork,
    headOwner: ctx.headOwner || owner,
    fixStatus: 'pushed',
  };

  if (ctx.openPullRequest !== true) {
    return result;
  }

  try {
    await stage(ctx, 'creating_pr');

    const existing = await findOpenPullRequest(token, prOwner, prRepo, head, baseBranch);
    if (existing) {
      return {
        ...result,
        pullRequestUrl: existing.html_url,
        pullRequestNumber: existing.number,
        fixStatus: 'pr_created',
      };
    }

    const title = fixPullRequestTitle({
      analysisId: ctx.analysisId,
      issueNumber: ctx.issueNumber,
      patchSummary: patch.summary,
      filesChanged,
      targetRepository: upstreamFullName,
      baseBranch,
    });
    const body = fixPullRequestBody({
      analysisId: ctx.analysisId,
      issueNumber: ctx.issueNumber,
      issueUrl: ctx.issueUrl,
      patchSummary: patch.summary,
      filesChanged,
      targetRepository: upstreamFullName,
      baseBranch,
      appBaseUrl: ctx.appBaseUrl,
      usedFork,
    });

    const pr = await createPullRequest(token, prOwner, prRepo, title, body, head, baseBranch);

    return {
      ...result,
      pullRequestUrl: pr.html_url,
      pullRequestNumber: pr.number,
      fixStatus: 'pr_created',
    };
  } catch (error) {
    const message = sanitizeGitHubMessage(
      error instanceof Error ? error.message : 'GitHub did not create the pull request.'
    );

    // A 422 "already exists" means an earlier attempt succeeded: recover the PR
    // instead of reporting a failure for work that is already there.
    const recovered = /already exists/i.test(message)
      ? await findOpenPullRequest(token, prOwner, prRepo, head, baseBranch)
      : null;

    if (recovered) {
      return {
        ...result,
        pullRequestUrl: recovered.html_url,
        pullRequestNumber: recovered.number,
        fixStatus: 'pr_created',
      };
    }

    // The branch and commit are real and must not be reported as lost.
    return {
      ...result,
      pullRequestError: message,
      fixStatus: 'pr_failed',
    };
  }
}

async function findOpenPullRequest(
  token: string,
  owner: string,
  repo: string,
  head: string,
  base: string
): Promise<{ number: number; html_url: string } | null> {
  try {
    const open = await listOpenPullRequests(token, owner, repo, head, base);
    const match = open.find((pr) => pr.state === 'open');
    return match ? { number: match.number, html_url: match.html_url } : null;
  } catch {
    // Duplicate detection is best effort; creating the PR is still attempted.
    return null;
  }
}

function syncMessage(error: Error): string {
  return sanitizeGitHubMessage(error.message);
}
