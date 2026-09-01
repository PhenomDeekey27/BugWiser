import { Patch, PatchHunk, ApplyFixResult, ApplyFixError } from '@/types';
import {
  getDefaultBranch,
  createBranch,
  getBranchExists,
  getFileContent,
  createOrUpdateFile,
  createPullRequest,
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

function applyHunksToContent(originalContent: string, hunks: PatchHunk[]): string | null {
  const lines = originalContent.split('\n');
  const result = [...lines];

  for (const hunk of hunks) {
    const oldStartIdx = hunk.oldStart - 1;
    const removedLines: string[] = [];
    const addedLines: string[] = [];

    for (const line of hunk.lines) {
      if (line.type === 'removed') {
        removedLines.push(line.content);
      } else if (line.type === 'added') {
        addedLines.push(line.content);
      }
    }

    if (removedLines.length === 0 && addedLines.length === 0) continue;

    const normalizedRemoved = removedLines.map((l) => l.replace(/\r$/, ''));

    let matchIdx = -1;
    for (let i = oldStartIdx; i <= result.length - removedLines.length; i++) {
      const candidate = result.slice(i, i + removedLines.length).map((l) => l.replace(/\r$/, ''));
      if (candidate.every((line, idx) => line === normalizedRemoved[idx])) {
        matchIdx = i;
        break;
      }
    }

    if (matchIdx === -1) {
      return null;
    }

    result.splice(matchIdx, removedLines.length, ...addedLines);
  }

  return result.join('\n');
}

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
      if (file.additions === 0 && file.deletions === 0) {
        continue;
      }

      const current = await getFileContent(token, owner, repo, file.path, branchName);
      if (!current) {
        fileErrors.push(`${file.path}: File not found on branch`);
        continue;
      }

      const newContent = applyHunksToContent(current.content, file.hunks);
      if (newContent === null) {
        fileErrors.push(
          `${file.path}: Expected content not found. The file may have changed since analysis.`
        );
        continue;
      }

      const commitMsg = `fix: update ${file.path}`;
      await createOrUpdateFile(
        token,
        owner,
        repo,
        file.path,
        newContent,
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
    return {
      success: false,
      error: `No files could be applied. Errors: ${fileErrors.join('; ')}`,
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
