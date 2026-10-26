import { Patch, ApplyFixResult, ApplyFixError } from '@/types';
import { applyHunksDetailed } from './patch-lines';
import { describeApplyFailure, fileHasChanges, findSyntaxRegression } from './patch-verify';
import { normalizeCommitSha } from '@/lib/github/public';
import {
  getDefaultBranch,
  createBranch,
  getBranchExists,
  getFileContent,
  createOrUpdateFile,
  createPullRequest,
  deleteBranch,
} from '@/lib/github/write';

interface ApplyPatchContext {
  token: string;
  owner: string;
  repo: string;
  analysisId: string;
  patch: Patch;
  /** GitHub issue number, or null/0 for a description-only analysis. */
  issueNumber?: number | null;
  /**
   * Exact commit the patch was generated from. Pinning it keeps the fix branch
   * on the analysed snapshot instead of drifting to whatever the branch head is
   * now. Falls back to the default branch head only for legacy rows.
   */
  baseSha?: string | null;
  /** Creating a pull request is always explicit opt-in. */
  openPullRequest?: boolean;
  commitMessage?: string | null;
}

function analysisLabel(ctx: Pick<ApplyPatchContext, 'issueNumber' | 'analysisId'>): string {
  if (ctx.issueNumber && ctx.issueNumber > 0) return `issue-${ctx.issueNumber}`;
  return `analysis-${ctx.analysisId.slice(0, 8)}`;
}

function generateBranchName(label: string): string {
  const shortId = Math.random().toString(36).substring(2, 8);
  return `BugWiser/fix/${label}-${shortId}`;
}

export function generateCommitMessage(patch: Patch, ctx: ApplyPatchContext): string {
  if (ctx.commitMessage && ctx.commitMessage.trim()) return ctx.commitMessage.trim();
  const reference =
    ctx.issueNumber && ctx.issueNumber > 0
      ? `issue #${ctx.issueNumber}`
      : `analysis ${ctx.analysisId.slice(0, 8)}`;
  return `fix: resolve ${reference}\n\n${patch.summary}\n\nFiles changed: ${patch.files.length}`;
}

export { applyHunksToContent, applyHunksDetailed } from './patch-lines';

/**
 * Applies a validated patch to a new branch. Callers must have already staged
 * and reviewed the patch in the analysis workspace; this function performs the
 * remote write only after explicit approval.
 */
export async function applyPatchToGitHub(
  ctx: ApplyPatchContext
): Promise<ApplyFixResult | ApplyFixError> {
  const { token, owner, repo, patch } = ctx;

  if (!patch.files || patch.files.length === 0) {
    return {
      success: false,
      error: 'No files to apply in the patch.',
      code: 'patch_validation_failed',
    };
  }

  let defaultBranch;
  try {
    defaultBranch = await getDefaultBranch(token, owner, repo);
  } catch {
    return {
      success: false,
      error: 'Could not determine the repository default branch.',
      code: 'repository_not_found',
    };
  }

  const pinnedBase = ctx.baseSha ? normalizeCommitSha(ctx.baseSha) : null;
  if (ctx.baseSha && !pinnedBase) {
    return {
      success: false,
      error: 'The analysis base commit is not a valid full commit SHA.',
      code: 'patch_validation_failed',
    };
  }
  const baseSha = pinnedBase || defaultBranch.commitSha;

  const label = analysisLabel(ctx);
  let branchName = generateBranchName(label);
  let attempts = 0;
  while (attempts < 5) {
    const exists = await getBranchExists(token, owner, repo, branchName);
    if (!exists) break;
    branchName = generateBranchName(label);
    attempts++;
  }

  if (attempts >= 5) {
    return {
      success: false,
      error: 'Could not generate a unique branch name.',
      code: 'branch_exists',
    };
  }

  try {
    await createBranch(token, owner, repo, branchName, baseSha);
  } catch (err) {
    const error = err as Error;
    return {
      success: false,
      error: `Could not create the fix branch: ${error.message}`,
      code: 'branch_creation_failed',
    };
  }

  const appliedFiles: string[] = [];
  const fileErrors: string[] = [];
  let headCommitSha = baseSha;

  for (const file of patch.files) {
    try {
      if (!fileHasChanges(file)) {
        continue;
      }

      const current = await getFileContent(token, owner, repo, file.path, branchName);
      if (!current) {
        fileErrors.push(`${file.path}: File not found on branch`);
        continue;
      }

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

      const commitMsg = `fix: update ${file.path}`;
      const commit = await createOrUpdateFile(
        token,
        owner,
        repo,
        file.path,
        outcome.content,
        commitMsg,
        branchName,
        current.sha
      );
      if (commit?.sha) headCommitSha = commit.sha;
      appliedFiles.push(file.path);
    } catch (err) {
      const error = err as Error;
      fileErrors.push(`${file.path}: ${error.message}`);
    }
  }

  if (appliedFiles.length === 0) {
    // Nothing landed on the branch we just created — remove it rather than
    // leave an orphan `BugWiser/fix/...` ref behind on every failed attempt.
    await deleteBranch(token, owner, repo, branchName);

    return {
      success: false,
      error:
        fileErrors.length > 0
          ? `No files could be applied. Errors: ${fileErrors.join('; ')}`
          : 'No files could be applied: the patch contains no changes.',
      code: 'patch_validation_failed',
    };
  }

  const commitMessage = generateCommitMessage(patch, ctx);
  const branchUrl = `https://github.com/${owner}/${repo}/tree/${branchName}`;

  let pullRequestUrl: string | undefined;
  if (ctx.openPullRequest === true) {
    try {
      const reference =
        ctx.issueNumber && ctx.issueNumber > 0 ? `issue #${ctx.issueNumber}` : 'the reported issue';
      const prTitle =
        ctx.issueNumber && ctx.issueNumber > 0
          ? `fix: resolve issue #${ctx.issueNumber}`
          : `fix: ${patch.summary.split('\n')[0].slice(0, 120)}`;
      const prBody = `## Summary\n\n${patch.summary}\n\n## Changes\n\n${appliedFiles.map((f) => `- \`${f}\``).join('\n')}\n\n## Related\n\nFixes ${reference}.`;
      const pr = await createPullRequest(
        token,
        owner,
        repo,
        prTitle,
        prBody,
        branchName,
        defaultBranch.name
      );
      pullRequestUrl = pr.html_url;
    } catch {
      // The branch is still valid; the caller reports the missing PR.
    }
  }

  return {
    success: true,
    branch: branchName,
    commitSha: headCommitSha,
    commitMessage,
    filesChanged: appliedFiles,
    repositoryFullName: `${owner}/${repo}`,
    defaultBranch: defaultBranch.name,
    htmlUrl: branchUrl,
    pullRequestUrl,
  };
}
