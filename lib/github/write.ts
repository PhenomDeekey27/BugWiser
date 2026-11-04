// GitHub write primitives.
//
// Every call uses the signed-in user's own token through `githubApiFetch`, so a
// failure is a typed `GitHubError` (401 auth rejected, 403 forbidden, 404 not
// visible, 429 rate limited) instead of a string that embeds GitHub's response.
// That is what lets the fix workflow report the exact failed stage and decide
// whether a retry can help.
//
// The workflow commits with the Git Data API (tree → commit → ref update) rather
// than the contents API: one meaningful commit with an explicit parent, which is
// also what makes a retry idempotent (the commit content is derived from the
// analysis, not from a sequence of per-file writes).

import { githubApiFetch } from './api.ts';
import { GitHubError } from './errors.ts';

export interface GitHubRef {
  ref: string;
  node_id: string;
  url: string;
  object: {
    type: string;
    sha: string;
    url: string;
  };
}

export interface GitHubBranch {
  name: string;
  commit: {
    sha: string;
    url: string;
  };
  protected?: boolean;
}

interface GitHubFileContent {
  name: string;
  path: string;
  sha: string;
  size: number;
  url: string;
  content: string;
  encoding: string;
}

export interface GitHubCommit {
  sha: string;
  node_id?: string;
  url?: string;
  message: string;
  html_url?: string;
  author?: {
    name: string;
    email: string;
    date: string;
  } | null;
  tree: {
    sha: string;
    url?: string;
  };
  parents?: Array<{ sha: string }>;
}

export interface GitHubTreeResponse {
  sha: string;
  url?: string;
  tree: Array<{
    path: string;
    mode: string;
    type: string;
    sha: string;
    size?: number;
    url?: string;
  }>;
}

export interface GitHubPullRequest {
  number: number;
  html_url: string;
  title: string;
  body: string | null;
  state: string;
  created_at: string;
  head?: { ref: string; label?: string };
  base?: { ref: string };
}

// GitHub returns file contents base64-encoded. Analysis-side source files are
// fetched as UTF-8 text (`response.text()`), so apply MUST decode the same
// bytes as UTF-8 — `atob` alone yields Latin-1 code units and any non-ASCII
// character would make the expected content mismatch (and `btoa` on commit
// would throw for anything outside Latin-1).
export function decodeGitHubContent(base64: string): string {
  const binary = atob(base64.replace(/\n/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

export function encodeGitHubContent(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function isGitHubNotFound(error: unknown): boolean {
  return error instanceof GitHubError && error.code === 'not_found';
}

function repoPath(owner: string, repo: string): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

export async function getRepositoryInfo(
  token: string,
  owner: string,
  repo: string
): Promise<{
  id: number;
  fullName: string;
  owner: string;
  name: string;
  defaultBranch: string;
  fork: boolean;
  parentFullName: string | null;
  permissions: { push?: boolean; admin?: boolean; maintain?: boolean };
}> {
  const data = await githubApiFetch<{
    id: number;
    full_name: string;
    name: string;
    owner?: { login?: string };
    default_branch?: string;
    fork?: boolean;
    parent?: { full_name?: string } | null;
    permissions?: { push?: boolean; admin?: boolean; maintain?: boolean };
  }>(repoPath(owner, repo), { token });

  return {
    id: data.id,
    fullName: typeof data.full_name === 'string' ? data.full_name : `${owner}/${repo}`,
    owner: data.owner?.login || owner,
    name: typeof data.name === 'string' ? data.name : repo,
    defaultBranch:
      typeof data.default_branch === 'string' && data.default_branch
        ? data.default_branch
        : 'main',
    fork: data.fork === true,
    parentFullName:
      typeof data.parent?.full_name === 'string' ? data.parent.full_name : null,
    permissions: data.permissions || {},
  };
}

export async function getDefaultBranch(
  token: string,
  owner: string,
  repo: string
): Promise<{ name: string; commitSha: string }> {
  const info = await getRepositoryInfo(token, owner, repo);
  const branch = await getBranch(token, owner, repo, info.defaultBranch);
  if (!branch) {
    throw new GitHubError(
      `The base branch "${info.defaultBranch}" could not be read.`,
      'not_found',
      { status: 404 }
    );
  }
  return { name: info.defaultBranch, commitSha: branch.sha };
}

/** The branch head, or null when GitHub says the branch does not exist. */
export async function getBranch(
  token: string,
  owner: string,
  repo: string,
  branchName: string
): Promise<{ name: string; sha: string; protected: boolean } | null> {
  try {
    const data = await githubApiFetch<GitHubBranch>(
      `${repoPath(owner, repo)}/branches/${encodePath(branchName)}`,
      { token }
    );
    return {
      name: data.name,
      sha: data.commit?.sha || '',
      protected: data.protected === true,
    };
  } catch (error) {
    if (isGitHubNotFound(error)) return null;
    throw error;
  }
}

export async function getBranchExists(
  token: string,
  owner: string,
  repo: string,
  branchName: string
): Promise<boolean> {
  return (await getBranch(token, owner, repo, branchName)) !== null;
}

export async function createBranch(
  token: string,
  owner: string,
  repo: string,
  branchName: string,
  fromSha: string
): Promise<GitHubRef> {
  return githubApiFetch<GitHubRef>(`${repoPath(owner, repo)}/git/refs`, {
    token,
    method: 'POST',
    body: {
      ref: `refs/heads/${branchName}`,
      sha: fromSha,
    },
  });
}

/**
 * Best-effort removal of a fix branch we created. Used to clean up when a patch
 * turns out to be unapplicable, so a failed attempt does not leave an empty
 * orphan branch behind. A successful ref delete answers 204 with no body.
 */
export async function deleteBranch(
  token: string,
  owner: string,
  repo: string,
  branchName: string
): Promise<boolean> {
  try {
    await githubApiFetch<void>(
      `${repoPath(owner, repo)}/git/refs/heads/${encodePath(branchName)}`,
      { token, method: 'DELETE' }
    );
    return true;
  } catch {
    return false;
  }
}

export async function getCommit(
  token: string,
  owner: string,
  repo: string,
  sha: string
): Promise<GitHubCommit | null> {
  try {
    return await githubApiFetch<GitHubCommit>(
      `${repoPath(owner, repo)}/git/commits/${encodeURIComponent(sha)}`,
      { token }
    );
  } catch (error) {
    if (isGitHubNotFound(error)) return null;
    throw error;
  }
}

/** True when this repository contains the exact commit. */
export async function commitExists(
  token: string,
  owner: string,
  repo: string,
  sha: string
): Promise<boolean> {
  return (await getCommit(token, owner, repo, sha)) !== null;
}

export async function getFileContent(
  token: string,
  owner: string,
  repo: string,
  path: string,
  ref: string
): Promise<{ content: string; sha: string } | null> {
  try {
    const data = await githubApiFetch<GitHubFileContent>(
      `${repoPath(owner, repo)}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`,
      { token }
    );
    if (!data || typeof data.content !== 'string') return null;
    return { content: decodeGitHubContent(data.content), sha: data.sha };
  } catch (error) {
    if (isGitHubNotFound(error)) return null;
    throw error;
  }
}

export async function createOrUpdateFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  content: string,
  message: string,
  branch: string,
  sha?: string
): Promise<GitHubCommit> {
  const body: Record<string, unknown> = {
    message,
    content: encodeGitHubContent(content),
    branch,
  };

  if (sha) {
    body.sha = sha;
  }

  return githubApiFetch<GitHubCommit>(
    `${repoPath(owner, repo)}/contents/${encodePath(path)}`,
    { token, method: 'PUT', body }
  );
}

export async function deleteFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  message: string,
  branch: string,
  sha: string
): Promise<GitHubCommit> {
  return githubApiFetch<GitHubCommit>(
    `${repoPath(owner, repo)}/contents/${encodePath(path)}`,
    {
      token,
      method: 'DELETE',
      body: { message, sha, branch },
    }
  );
}

export async function createTree(
  token: string,
  owner: string,
  repo: string,
  baseTree: string,
  files: Array<{ path: string; content: string; mode?: string }>
): Promise<GitHubTreeResponse> {
  const tree = files.map((file) => ({
    path: file.path,
    mode: file.mode || '100644',
    type: 'blob' as const,
    content: file.content,
  }));

  return githubApiFetch<GitHubTreeResponse>(`${repoPath(owner, repo)}/git/trees`, {
    token,
    method: 'POST',
    body: {
      base_tree: baseTree,
      tree,
    },
  });
}

export async function createCommit(
  token: string,
  owner: string,
  repo: string,
  message: string,
  tree: string,
  parents: string[]
): Promise<GitHubCommit> {
  return githubApiFetch<GitHubCommit>(`${repoPath(owner, repo)}/git/commits`, {
    token,
    method: 'POST',
    body: { message, tree, parents },
  });
}

/**
 * Moves `refs/heads/<ref>` to `sha`.
 *
 * `ref` is passed without the `refs/heads/` prefix. `force` is deliberately off
 * for fix branches: a non-fast-forward answer means someone else pushed to this
 * branch, and overwriting their work would be wrong.
 */
export async function updateRef(
  token: string,
  owner: string,
  repo: string,
  ref: string,
  sha: string,
  force = false
): Promise<GitHubRef> {
  return githubApiFetch<GitHubRef>(
    `${repoPath(owner, repo)}/git/refs/${encodePath(ref)}`,
    {
      token,
      method: 'PATCH',
      body: { sha, force },
    }
  );
}

export async function createPullRequest(
  token: string,
  owner: string,
  repo: string,
  title: string,
  body: string,
  head: string,
  base: string
): Promise<GitHubPullRequest> {
  return githubApiFetch<GitHubPullRequest>(`${repoPath(owner, repo)}/pulls`, {
    token,
    method: 'POST',
    body: { title, body, head, base },
  });
}

/**
 * Open pull requests for one head/base pair.
 *
 * `head` may be a bare branch (same repository) or `owner:branch` (fork). GitHub
 * matches both, which is what makes duplicate detection work across retries.
 */
export async function listOpenPullRequests(
  token: string,
  owner: string,
  repo: string,
  head: string,
  base: string
): Promise<GitHubPullRequest[]> {
  const query = new URLSearchParams({
    state: 'open',
    head,
    base,
    per_page: '10',
  });
  const data = await githubApiFetch<GitHubPullRequest[]>(
    `${repoPath(owner, repo)}/pulls?${query.toString()}`,
    { token }
  );
  return Array.isArray(data) ? data : [];
}

/** Creates a fork and waits (briefly) for GitHub to finish provisioning it. */
export async function createFork(
  token: string,
  owner: string,
  repo: string,
  options: { organization?: string | null; attempts?: number } = {}
): Promise<{ fullName: string; owner: string; name: string }> {
  const body: Record<string, unknown> = {};
  if (options.organization) body.organization = options.organization;

  const created = await githubApiFetch<{ full_name?: string; owner?: { login?: string }; name?: string }>(
    `${repoPath(owner, repo)}/forks`,
    { token, method: 'POST', body }
  );

  const attempts = options.attempts ?? 8;
  let fullName =
    typeof created.full_name === 'string' && created.full_name.includes('/')
      ? created.full_name
      : '';
  let forkOwner = created.owner?.login || '';
  let forkName = created.name || repo;

  // GitHub answers 202-ish: the repository object can exist before git data is
  // available. Poll until a branch can actually be read from it.
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (fullName) {
      const parsed = fullName.split('/');
      forkOwner = forkOwner || parsed[0];
      forkName = parsed[1] || forkName;
    }
    if (!forkOwner) break;

    try {
      const info = await getRepositoryInfo(token, forkOwner, forkName);
      const branches = await getBranch(token, forkOwner, forkName, info.defaultBranch);
      if (branches) {
        return { fullName: info.fullName, owner: info.owner, name: info.name };
      }
    } catch (error) {
      if (!isGitHubNotFound(error)) throw error;
    }

    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(500 * (attempt + 1), 2_000)));
    }
  }

  throw new GitHubError(
    'GitHub accepted the fork request but the fork is not ready yet. Retry in a moment.',
    'api_error',
    { status: 202 }
  );
}

/** Asks GitHub to fast-forward a fork to its upstream branch. */
export async function mergeUpstream(
  token: string,
  owner: string,
  repo: string,
  branch: string
): Promise<{ ok: boolean; message: string }> {
  try {
    const data = await githubApiFetch<{ message?: string }>(
      `${repoPath(owner, repo)}/merge-upstream`,
      { token, method: 'POST', body: { branch } }
    );
    return { ok: true, message: data?.message || 'merged' };
  } catch (error) {
    if (error instanceof GitHubError) {
      return { ok: false, message: error.message };
    }
    return { ok: false, message: 'Could not merge the upstream branch into the fork.' };
  }
}
