// Pure mapping from GitHub repository payloads to the shape the app uses.
//
// With OAuth App authentication there is no installation and no selected
// repository list: the token's own visibility is the grant. Everything here is
// therefore a projection of one `GET /user/repos` or `GET /repos/{owner}/{repo}`
// response, and the tests can run against plain objects.

import type { GitHubApiRepository } from './types';

export interface AccessibleRepository {
  repoId: number;
  fullName: string;
  owner: string;
  name: string;
  description: string;
  language: string;
  stars: number;
  forks: number;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
  pushedAt: string | null;
  updatedAt: string;
  /** False when GitHub explicitly withheld push permission for this token. */
  canWrite: boolean;
  /**
   * GitHub only returns `permissions` for an authenticated request. When it is
   * absent we cannot claim either way, so write access is attempted and GitHub
   * remains the authority.
   */
  permissionsKnown: boolean;
}

function isUsableId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/**
 * Returns null for a payload missing the fields the app relies on, so one odd
 * entry cannot poison a whole repository list.
 */
export function mapApiRepository(row: GitHubApiRepository): AccessibleRepository | null {
  if (!row || !isUsableId(row.id)) return null;
  if (typeof row.full_name !== 'string' || !row.full_name.includes('/')) return null;

  const [ownerFromName, nameFromName] = row.full_name.split('/');
  const owner = typeof row.owner?.login === 'string' && row.owner.login
    ? row.owner.login
    : ownerFromName;
  const name = typeof row.name === 'string' && row.name ? row.name : nameFromName;

  const permissions = row.permissions;
  const permissionsKnown = Boolean(permissions && typeof permissions === 'object');

  return {
    repoId: row.id,
    fullName: `${owner}/${name}`,
    owner,
    name,
    description: typeof row.description === 'string' ? row.description : '',
    language: typeof row.language === 'string' ? row.language : '',
    stars: Number.isFinite(row.stargazers_count) ? row.stargazers_count : 0,
    forks: Number.isFinite(row.forks_count) ? row.forks_count : 0,
    private: row.private === true,
    defaultBranch: typeof row.default_branch === 'string' && row.default_branch
      ? row.default_branch
      : 'main',
    htmlUrl: typeof row.html_url === 'string' && row.html_url
      ? row.html_url
      : `https://github.com/${owner}/${name}`,
    pushedAt: typeof row.pushed_at === 'string' ? row.pushed_at : null,
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : '',
    canWrite: permissions?.push === true,
    permissionsKnown,
  };
}

/** Drops unusable rows and sorts by most recently pushed. */
export function mapApiRepositories(rows: GitHubApiRepository[]): AccessibleRepository[] {
  const mapped = (rows || [])
    .map(mapApiRepository)
    .filter((repository): repository is AccessibleRepository => repository !== null);

  return mapped.sort((a, b) => (b.pushedAt || '').localeCompare(a.pushedAt || ''));
}

export interface RepositoryAccessState {
  /** No GitHub identity in this session: only public imports are possible. */
  requiresGitHub: boolean;
  /** Connected, but the account can read no repository at all. */
  empty: boolean;
}

export function describeRepositoryAccessState(input: {
  connected: boolean;
  repositoryCount: number;
}): RepositoryAccessState {
  return {
    requiresGitHub: !input.connected,
    empty: input.connected && input.repositoryCount === 0,
  };
}
