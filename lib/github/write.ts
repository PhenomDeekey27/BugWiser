import { githubFetch } from './client';

interface GitHubRef {
  ref: string;
  node_id: string;
  url: string;
  object: {
    type: string;
    sha: string;
    url: string;
  };
}

interface GitHubBranch {
  name: string;
  commit: {
    sha: string;
    url: string;
  };
  protected: boolean;
}

interface GitHubFileContent {
  name: string;
  path: string;
  sha: string;
  size: number;
  url: string;
  content: string;
  encoding: string;
  _links: {
    self: string;
    git: string;
    html: string;
  };
}

interface GitHubCommit {
  sha: string;
  node_id: string;
  url: string;
  message: string;
  html_url: string;
  author: {
    name: string;
    email: string;
    date: string;
  };
  tree: {
    sha: string;
    url: string;
  };
}

interface GitHubTreeResponse {
  sha: string;
  url: string;
  tree: Array<{
    path: string;
    mode: string;
    type: string;
    sha: string;
    size?: number;
    url: string;
  }>;
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

export async function getDefaultBranch(
  token: string,
  owner: string,
  repo: string
): Promise<{ name: string; commitSha: string }> {
  const repoData = await githubFetch<{ default_branch: string }>(
    `/repos/${owner}/${repo}`,
    { token }
  );

  const branchData = await githubFetch<GitHubBranch>(
    `/repos/${owner}/${repo}/branches/${repoData.default_branch}`,
    { token }
  );

  return {
    name: repoData.default_branch,
    commitSha: branchData.commit.sha,
  };
}

export async function createBranch(
  token: string,
  owner: string,
  repo: string,
  branchName: string,
  fromSha: string
): Promise<GitHubRef> {
  return githubFetch<GitHubRef>(`/repos/${owner}/${repo}/git/refs`, {
    token,
    method: 'POST',
    body: {
      ref: `refs/heads/${branchName}`,
      sha: fromSha,
    },
  });
}

export async function getBranchExists(
  token: string,
  owner: string,
  repo: string,
  branchName: string
): Promise<boolean> {
  try {
    await githubFetch<GitHubBranch>(
      `/repos/${owner}/${repo}/branches/${branchName}`,
      { token }
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Best-effort removal of a fix branch we created. Used to clean up when a
 * patch turns out to be unapplicable, so a failed attempt does not leave an
 * empty orphan branch behind. `githubFetch` cannot be used here because a
 * successful ref delete answers 204 with no body.
 */
export async function deleteBranch(
  token: string,
  owner: string,
  repo: string,
  branchName: string
): Promise<boolean> {
  try {
    // Branch names may contain slashes (`BugWiser/fix/issue-1-x`); encode each
    // path segment so the ref stays resolvable.
    const ref = branchName.split('/').map(encodeURIComponent).join('/');
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${ref}`,
      {
        method: 'DELETE',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    );
    return response.ok;
  } catch {
    return false;
  }
}

export async function getFileContent(
  token: string,
  owner: string,
  repo: string,
  path: string,
  ref: string
): Promise<{ content: string; sha: string } | null> {
  try {
    const data = await githubFetch<GitHubFileContent>(
      `/repos/${owner}/${repo}/contents/${path}?ref=${ref}`,
      { token }
    );

    const content = decodeGitHubContent(data.content);
    return { content, sha: data.sha };
  } catch {
    return null;
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

  return githubFetch<GitHubCommit>(
    `/repos/${owner}/${repo}/contents/${path}`,
    {
      token,
      method: 'PUT',
      body,
    }
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
  const body = {
    message,
    sha,
    branch,
  };

  return githubFetch<GitHubCommit>(
    `/repos/${owner}/${repo}/contents/${path}`,
    {
      token,
      method: 'DELETE',
      body,
    }
  );
}

export async function createCommit(
  token: string,
  owner: string,
  repo: string,
  message: string,
  tree: string,
  parents: string[]
): Promise<GitHubCommit> {
  return githubFetch<GitHubCommit>(`/repos/${owner}/${repo}/git/commits`, {
    token,
    method: 'POST',
    body: {
      message,
      tree,
      parents,
    },
  });
}

export async function createTree(
  token: string,
  owner: string,
  repo: string,
  baseTree: string,
  files: Array<{
    path: string;
    content: string;
    mode?: string;
  }>
): Promise<GitHubTreeResponse> {
  const tree = files.map((f) => ({
    path: f.path,
    mode: (f.mode || '100644') as string,
    type: 'blob' as const,
    content: f.content,
  }));

  return githubFetch<GitHubTreeResponse>(`/repos/${owner}/${repo}/git/trees`, {
    token,
    method: 'POST',
    body: {
      base_tree: baseTree,
      tree,
    },
  });
}

export async function updateRef(
  token: string,
  owner: string,
  repo: string,
  ref: string,
  sha: string,
  force?: boolean
): Promise<GitHubRef> {
  return githubFetch<GitHubRef>(`/repos/${owner}/${repo}/git/refs/${ref}`, {
    token,
    method: 'PATCH',
    body: {
      sha,
      force: force || false,
    },
  });
}

interface GitHubPullRequest {
  number: number;
  html_url: string;
  title: string;
  body: string;
  state: string;
  created_at: string;
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
  return githubFetch<GitHubPullRequest>(`/repos/${owner}/${repo}/pulls`, {
    token,
    method: 'POST',
    body: {
      title,
      body,
      head,
      base,
    },
  });
}
