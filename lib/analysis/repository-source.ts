// One abstraction for "where does repository data come from".
//
// An analysis either belongs to a GitHub App installation or to a public
// repository read anonymously. Everything downstream (indexing, source
// retrieval, workspace staging) resolves the snapshot once and pins to a single
// commit SHA, so a branch moving mid-analysis cannot mix versions.

import { getRepositoryAccessToken } from '@/lib/github/app/access';
import { githubFetch } from '@/lib/github/client';
import {
  PUBLIC_REPOSITORY_LIMITS,
  fetchPublicFileAtCommit,
  fetchPublicIssue,
  fetchPublicIssueComments,
  fetchPublicTreeAtCommit,
  normalizeCommitSha,
  resolvePublicRef,
  type PublicIssue,
  type PublicIssueComment,
  type PublicTreeEntry,
} from '@/lib/github/public';

export interface AnalysisSourceRow {
  repository_full_name: string;
  repository_source?: string | null;
  repository_branch?: string | null;
  repository_default_branch?: string | null;
  repository_commit?: string | null;
  github_installation_id?: number | null;
}

export interface RepositorySnapshot {
  source: 'installation' | 'public';
  owner: string;
  repo: string;
  fullName: string;
  branch: string;
  defaultBranch: string;
  commitSha: string;
  installationId: number | null;
  /** Installation token for private snapshots; null for public reads. */
  token: string | null;
  htmlUrl: string;
}

export interface SnapshotFile {
  path: string;
  content: string;
  bytes: number;
  sha: string;
}

function splitFullName(fullName: string): { owner: string; repo: string } {
  const parts = (fullName || '').split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error('Analysis has an invalid repository name.');
  }
  return { owner: parts[0], repo: parts[1] };
}

/** Deployment read token for public requests. Optional; anonymous works too. */
export function publicReadToken(): string | null {
  return process.env.GITHUB_PUBLIC_READ_TOKEN || null;
}

async function resolveInstallationCommitSha(
  token: string,
  owner: string,
  repo: string,
  ref: string
): Promise<{ commitSha: string; defaultBranch: string; branch: string }> {
  let defaultBranch = ref;
  try {
    const info = await githubFetch<{ default_branch: string }>(
      `/repos/${owner}/${repo}`,
      { token }
    );
    if (info.default_branch) defaultBranch = info.default_branch;
  } catch {
    // Non-fatal: the requested ref can still be resolved.
  }

  try {
    const commit = await githubFetch<{ sha: string }>(
      `/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`,
      { token }
    );
    const sha = normalizeCommitSha(commit.sha);
    if (sha) return { commitSha: sha, defaultBranch, branch: ref };
  } catch {
    // Fall through to the default branch.
  }

  if (ref !== defaultBranch) {
    const fallback = await githubFetch<{ sha: string }>(
      `/repos/${owner}/${repo}/commits/${encodeURIComponent(defaultBranch)}`,
      { token }
    );
    const sha = normalizeCommitSha(fallback.sha);
    if (sha) return { commitSha: sha, defaultBranch, branch: defaultBranch };
  }

  throw new Error('Could not resolve a commit for this repository.');
}

/**
 * Resolves the exact commit and credentials for an analysis. A stored
 * `repository_commit` always wins; it is what makes workspace staging safe.
 */
export async function resolveRepositorySnapshot(
  analysis: AnalysisSourceRow,
  actorUserId: string
): Promise<RepositorySnapshot> {
  const { owner, repo } = splitFullName(analysis.repository_full_name);
  const source = analysis.repository_source === 'public' ? 'public' : 'installation';

  if (source === 'public') {
    const pinned = normalizeCommitSha(analysis.repository_commit || '');
    if (!pinned) {
      throw new Error(
        'This public analysis is not pinned to a commit. Re-import the repository to create a pinned snapshot.'
      );
    }

    let defaultBranch = analysis.repository_default_branch || analysis.repository_branch || 'main';
    if (!analysis.repository_default_branch) {
      try {
        const resolved = await resolvePublicRef(owner, repo, defaultBranch, {
          token: publicReadToken(),
        });
        defaultBranch = resolved.ref;
      } catch {
        // The pinned commit is still sufficient for reads.
      }
    }

    return {
      source,
      owner,
      repo,
      fullName: `${owner}/${repo}`,
      branch: analysis.repository_branch || defaultBranch,
      defaultBranch,
      commitSha: pinned,
      installationId: null,
      token: null,
      htmlUrl: `https://github.com/${owner}/${repo}/tree/${pinned}`,
    };
  }

  const access = await getRepositoryAccessToken(actorUserId, analysis.repository_full_name);
  const token = access.token.token;
  const requestedRef =
    analysis.repository_branch || access.repository.defaultBranch || 'main';

  let commitSha = normalizeCommitSha(analysis.repository_commit || '');
  let branch = requestedRef;
  let defaultBranch = access.repository.defaultBranch || requestedRef;

  if (!commitSha) {
    const resolved = await resolveInstallationCommitSha(token, owner, repo, requestedRef);
    commitSha = resolved.commitSha;
    branch = resolved.branch;
    defaultBranch = resolved.defaultBranch;
  }

  return {
    source,
    owner,
    repo,
    fullName: `${owner}/${repo}`,
    branch,
    defaultBranch,
    commitSha,
    installationId: access.installationId,
    token,
    htmlUrl: `https://github.com/${owner}/${repo}/tree/${commitSha}`,
  };
}

export async function fetchSnapshotTree(
  snapshot: RepositorySnapshot
): Promise<{ tree: PublicTreeEntry[]; truncated: boolean }> {
  if (snapshot.source === 'public') {
    const result = await fetchPublicTreeAtCommit(
      snapshot.owner,
      snapshot.repo,
      snapshot.commitSha,
      { token: publicReadToken() }
    );
    return { tree: result.tree, truncated: result.truncated };
  }

  if (!snapshot.token) throw new Error('Missing installation token for repository tree.');

  const response = await githubFetch<{
    tree: PublicTreeEntry[];
    truncated: boolean;
  }>(`/repos/${snapshot.owner}/${snapshot.repo}/git/trees/${snapshot.commitSha}`, {
    token: snapshot.token,
    params: { recursive: '1' },
  });

  if (response.truncated) {
    throw new Error(
      'Repository tree is too large to index safely (GitHub truncated the response).'
    );
  }

  return { tree: response.tree || [], truncated: false };
}

function safePath(path: string): string {
  if (
    !path ||
    path.length > 500 ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.split('/').some((part) => part === '' || part === '.' || part === '..') ||
    /[\u0000-\u001f\u007f]/.test(path)
  ) {
    throw new Error('Refusing to read an unsafe repository path.');
  }
  return path;
}

export async function fetchSnapshotFile(
  snapshot: RepositorySnapshot,
  path: string
): Promise<SnapshotFile | null> {
  const relative = safePath(path);

  if (snapshot.source === 'public') {
    try {
      const file = await fetchPublicFileAtCommit(
        snapshot.owner,
        snapshot.repo,
        relative,
        snapshot.commitSha,
        { token: publicReadToken() }
      );
      return { path: file.path, content: file.content, bytes: file.bytes, sha: file.sha };
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'not_found' || code === 'too_large') return null;
      throw error;
    }
  }

  if (!snapshot.token) throw new Error('Missing installation token for source retrieval.');

  const encodedPath = relative
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');

  const response = await fetch(
    `https://api.github.com/repos/${snapshot.owner}/${snapshot.repo}/contents/${encodedPath}?ref=${snapshot.commitSha}`,
    {
      headers: {
        Accept: 'application/vnd.github.v3.raw',
        Authorization: `Bearer ${snapshot.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'BugWiser',
      },
      cache: 'no-store',
    }
  );

  if (!response.ok) return null;

  const content = await response.text();
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > PUBLIC_REPOSITORY_LIMITS.maxFileBytes) return null;

  return {
    path: relative,
    content,
    bytes,
    sha: response.headers.get('etag')?.replace(/"/g, '') || '',
  };
}

export async function fetchSnapshotIssue(
  snapshot: RepositorySnapshot,
  issueNumber: number
): Promise<PublicIssue | null> {
  if (snapshot.source === 'public') {
    try {
      return await fetchPublicIssue(snapshot.owner, snapshot.repo, issueNumber, {
        token: publicReadToken(),
      });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'not_found') return null;
      throw error;
    }
  }

  if (!snapshot.token) throw new Error('Missing installation token for issue retrieval.');

  const response = await fetch(
    `https://api.github.com/repos/${snapshot.owner}/${snapshot.repo}/issues/${issueNumber}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${snapshot.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'BugWiser',
      },
      cache: 'no-store',
    }
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Failed to fetch issue: GitHub returned ${response.status}.`);
  }

  const data = (await response.json()) as {
    number: number;
    title: string;
    body: string | null;
    state: string;
    labels: Array<{ name: string }>;
    user: { login: string } | null;
    created_at: string;
    updated_at: string;
    comments: number;
    html_url: string;
  };

  return {
    number: data.number,
    title: data.title,
    body: data.body || '',
    state: data.state,
    labels: (data.labels || []).map((label) => label.name),
    author: data.user?.login || '',
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    commentsCount: data.comments ?? 0,
    htmlUrl: data.html_url,
  };
}

export async function fetchSnapshotIssueComments(
  snapshot: RepositorySnapshot,
  issueNumber: number
): Promise<PublicIssueComment[]> {
  if (snapshot.source === 'public') {
    try {
      return await fetchPublicIssueComments(snapshot.owner, snapshot.repo, issueNumber, {
        token: publicReadToken(),
      });
    } catch {
      return [];
    }
  }

  if (!snapshot.token) return [];

  try {
    const response = await fetch(
      `https://api.github.com/repos/${snapshot.owner}/${snapshot.repo}/issues/${issueNumber}/comments?per_page=50`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${snapshot.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'BugWiser',
        },
        cache: 'no-store',
      }
    );
    if (!response.ok) return [];
    const data = (await response.json()) as Array<{
      id: number;
      user: { login: string } | null;
      body: string | null;
      created_at: string;
      updated_at: string;
      html_url: string;
    }>;
    return (data || []).map((comment) => ({
      id: comment.id,
      author: comment.user?.login || '',
      body: comment.body || '',
      createdAt: comment.created_at,
      updatedAt: comment.updated_at,
      htmlUrl: comment.html_url,
    }));
  } catch {
    return [];
  }
}
