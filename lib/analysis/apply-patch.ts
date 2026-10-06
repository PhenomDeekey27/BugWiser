import { Patch, ApplyFixResult, ApplyFixError } from '@/types';
import { applyHunksDetailed } from './patch-lines';
import { describeApplyFailure, fileHasChanges, findSyntaxRegression } from './patch-verify';
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
  issueNumber: number;
}

function generateBranchName(issueNumber: number): string {
  const shortId = Math.random().toString(36).substring(2, 8);
  return `BugWiser/fix/issue-${issueNumber}-${shortId}`;
}

function generateCommitMessage(patch: Patch, issueNumber: number): string {
  const fileCount = patch.files.length;
  return `fix: resolve issue #${issueNumber}\n\n${patch.summary}\n\nFiles changed: ${fileCount}`;
}

export { applyHunksToContent, applyHunksDetailed } from './patch-lines';

export async function applyPatchToGitHub(
  ctx: ApplyPatchContext
): Promise<ApplyFixResult | ApplyFixError> {
  const { token, owner, repo, patch, issueNumber } = ctx;

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

  let branchName = generateBranchName(issueNumber);
  let attempts = 0;
  while (attempts < 5) {
    const exists = await getBranchExists(token, owner, repo, branchName);
    if (!exists) break;
    branchName = generateBranchName(issueNumber);
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
    await createBranch(token, owner, repo, branchName, defaultBranch.commitSha);
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
      await createOrUpdateFile(
        token,
        owner,
        repo,
        file.path,
        outcome.content,
        commitMsg,
        branchName,
        current.sha
      );
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

  const commitMessage = generateCommitMessage(patch, issueNumber);
  const branchUrl = `https://github.com/${owner}/${repo}/tree/${branchName}`;

  let pullRequestUrl: string | undefined;
  try {
    const prTitle = `fix: resolve issue #${issueNumber}`;
    const prBody = `## Summary\n\n${patch.summary}\n\n## Changes\n\n${appliedFiles.map((f) => `- \`${f}\``).join('\n')}\n\n## Related Issue\n\nCloses #${issueNumber}`;
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
    // PR creation is optional; branch is still valid
  }

  return {
    success: true,
    branch: branchName,
    commitSha: defaultBranch.commitSha,
    commitMessage,
    filesChanged: appliedFiles,
    repositoryFullName: `${owner}/${repo}`,
    defaultBranch: defaultBranch.name,
    htmlUrl: branchUrl,
    pullRequestUrl,
  };
}
