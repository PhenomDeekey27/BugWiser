import {
  GitHubError,
  isRateLimited,
  retryAfterSeconds,
  sanitizeGitHubMessage,
} from './errors.ts';
import type { GitHubApiRepository, GitHubApiUser } from './types.ts';

const GITHUB_API_BASE = 'https://api.github.com';

export interface GitHubApiRequestOptions {
  token: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  accept?: string;
  timeoutMs?: number;
}

export class GitHubApiError extends GitHubError {
  constructor(
    message: string,
    code: GitHubError['code'],
    options: { status?: number; retryAfterSeconds?: number } = {}
  ) {
    super(message, code, options);
    this.name = 'GitHubApiError';
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  if (!text) return `GitHub API responded ${response.status}`;
  try {
    const parsed = JSON.parse(text) as {
      message?: unknown;
      error?: unknown;
      error_description?: unknown;
    };
    if (typeof parsed.message === 'string') return sanitizeGitHubMessage(parsed.message);
    if (typeof parsed.error_description === 'string') {
      return sanitizeGitHubMessage(parsed.error_description);
    }
    if (typeof parsed.error === 'string') return sanitizeGitHubMessage(parsed.error);
  } catch {
    // Plain text response.
  }
  return sanitizeGitHubMessage(text);
}

/**
 * One authenticated GitHub REST call.
 *
 * Status mapping is centralized so every caller sees the same categories:
 * 401 means the credential itself is no longer usable (revoked/expired), 403 a
 * permission or rate limit, 404 an invisible resource — GitHub returns 404 for
 * a private repository the token cannot see, which is exactly how repository
 * authorization is decided in `access.ts`.
 */
export async function githubApiFetch<T>(
  path: string,
  options: GitHubApiRequestOptions
): Promise<T> {
  if (!options.token) {
    throw new GitHubApiError('GitHub credential is missing', 'auth_rejected');
  }

  const url = path.startsWith('http') ? path : `${GITHUB_API_BASE}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);

  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: {
        Accept: options.accept || 'application/vnd.github+json',
        Authorization: `Bearer ${options.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'BugWiser',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
      cache: 'no-store',
    });

    if (!response.ok) {
      const message = await readErrorMessage(response);
      if (isRateLimited(response.status, response.headers)) {
        throw new GitHubApiError('GitHub API rate limit exceeded', 'rate_limited', {
          status: response.status,
          retryAfterSeconds: retryAfterSeconds(response.status, response.headers),
        });
      }
      if (response.status === 401) {
        throw new GitHubApiError(
          'Your GitHub authorization is no longer valid. Please sign in again.',
          'auth_rejected',
          { status: 401 }
        );
      }
      if (response.status === 403) {
        throw new GitHubApiError(message || 'GitHub permission denied', 'forbidden', {
          status: 403,
        });
      }
      if (response.status === 404) {
        throw new GitHubApiError(message || 'GitHub resource not found', 'not_found', {
          status: 404,
        });
      }
      throw new GitHubApiError(message || 'GitHub API request failed', 'api_error', {
        status: response.status,
      });
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof GitHubError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new GitHubApiError('GitHub API request timed out', 'network_error');
    }
    throw new GitHubApiError('Could not reach the GitHub API', 'network_error');
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchGitHubUser(userToken: string): Promise<GitHubApiUser> {
  return githubApiFetch<GitHubApiUser>('/user', { token: userToken });
}

const REPOSITORIES_PER_PAGE = 100;
/** 10 pages = 1000 repositories; the selector never needs an unbounded crawl. */
const MAX_REPOSITORY_PAGES = 10;

export interface UserRepositoriesPage {
  repositories: GitHubApiRepository[];
  /** True when GitHub has more pages than this limit. */
  truncated: boolean;
}

/**
 * Lists every repository the token can reach: owned, collaborator, and
 * organization-member repositories. Ordering by recent push matches what a
 * developer expects at the top of the picker.
 */
export async function fetchUserRepositories(
  userToken: string,
  page = 1
): Promise<UserRepositoriesPage> {
  const repositories = await githubApiFetch<GitHubApiRepository[]>(
    `/user/repos?per_page=${REPOSITORIES_PER_PAGE}&page=${page}` +
      '&affiliation=owner,collaborator,organization_member&sort=pushed&direction=desc',
    { token: userToken }
  );

  return {
    repositories: Array.isArray(repositories) ? repositories : [],
    truncated: (repositories || []).length === REPOSITORIES_PER_PAGE,
  };
}

/** All pages up to the page cap, deduplicated by repository id. */
export async function listAllUserRepositories(
  userToken: string
): Promise<{ repositories: GitHubApiRepository[]; truncated: boolean }> {
  const byId = new Map<number, GitHubApiRepository>();
  let truncated = false;

  for (let page = 1; page <= MAX_REPOSITORY_PAGES; page += 1) {
    const result = await fetchUserRepositories(userToken, page);
    for (const repository of result.repositories) {
      if (Number.isSafeInteger(repository.id)) byId.set(repository.id, repository);
    }
    if (!result.truncated) return { repositories: [...byId.values()], truncated: false };
    truncated = page === MAX_REPOSITORY_PAGES;
  }

  return { repositories: [...byId.values()], truncated };
}

export async function fetchRepository(
  userToken: string,
  owner: string,
  repo: string
): Promise<GitHubApiRepository> {
  return githubApiFetch<GitHubApiRepository>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    { token: userToken }
  );
}
