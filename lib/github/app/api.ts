import { GitHubAppError, isRateLimited, retryAfterSeconds, sanitizeGitHubMessage } from './errors';
import type {
  GitHubAppInstallation,
  GitHubInstallationRepositoriesResponse,
  GitHubInstallationRepository,
  GitHubInstallationToken,
  GitHubApiUser,
  GitHubUserInstallationsResponse,
} from './types';

const GITHUB_API_BASE = 'https://api.github.com';

export interface GitHubApiRequestOptions {
  token: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  accept?: string;
  timeoutMs?: number;
}

export class GitHubApiError extends GitHubAppError {
  constructor(
    message: string,
    code: GitHubAppError['code'],
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
    const parsed = JSON.parse(text) as { message?: unknown; error?: unknown; error_description?: unknown };
    if (typeof parsed.message === 'string') return sanitizeGitHubMessage(parsed.message);
    if (typeof parsed.error_description === 'string') return sanitizeGitHubMessage(parsed.error_description);
    if (typeof parsed.error === 'string') return sanitizeGitHubMessage(parsed.error);
  } catch {
    // Plain text response.
  }
  return sanitizeGitHubMessage(text);
}

export async function githubApiFetch<T>(
  path: string,
  options: GitHubApiRequestOptions
): Promise<T> {
  if (!options.token) {
    throw new GitHubApiError('GitHub credential is missing', 'app_auth_failed');
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
        'User-Agent': 'BugWiser-GitHub-App',
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
        throw new GitHubApiError('GitHub credential was rejected', 'app_auth_failed', {
          status: 401,
        });
      }
      if (response.status === 403) {
        throw new GitHubApiError(message || 'GitHub permission denied', 'missing_permissions', {
          status: 403,
        });
      }
      if (response.status === 404) {
        throw new GitHubApiError(message || 'GitHub resource not found', 'api_error', {
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
    if (error instanceof GitHubAppError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new GitHubApiError('GitHub API request timed out', 'network_error');
    }
    throw new GitHubApiError('Could not reach the GitHub API', 'network_error');
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchAppInstallation(
  appJwt: string,
  installationId: number
): Promise<GitHubAppInstallation> {
  return githubApiFetch<GitHubAppInstallation>(`/app/installations/${installationId}`, {
    token: appJwt,
  });
}

export async function createInstallationAccessToken(
  appJwt: string,
  installationId: number
): Promise<GitHubInstallationToken> {
  return githubApiFetch<GitHubInstallationToken>(
    `/app/installations/${installationId}/access_tokens`,
    { token: appJwt, method: 'POST', body: {} }
  );
}

export async function fetchInstallationRepositories(
  installationToken: string
): Promise<GitHubInstallationRepository[]> {
  const repositories: GitHubInstallationRepository[] = [];
  // Bound pagination: an installation with more than 1000 repos is unusual and
  // the analysis flow does not need an unbounded crawl.
  for (let page = 1; page <= 10; page += 1) {
    const data = await githubApiFetch<GitHubInstallationRepositoriesResponse>(
      `/installation/repositories?per_page=100&page=${page}`,
      { token: installationToken }
    );
    repositories.push(...(data.repositories || []));
    if (repositories.length >= data.total_count || (data.repositories || []).length < 100) break;
  }
  return repositories;
}

export async function fetchUserInstallations(userToken: string): Promise<GitHubAppInstallation[]> {
  const installations: GitHubAppInstallation[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const data = await githubApiFetch<GitHubUserInstallationsResponse>(
      `/user/installations?per_page=100&page=${page}`,
      { token: userToken }
    );
    installations.push(...(data.installations || []));
    if (installations.length >= data.total_count || (data.installations || []).length < 100) break;
  }
  return installations;
}

export async function fetchGitHubUser(userToken: string): Promise<GitHubApiUser> {
  return githubApiFetch<GitHubApiUser>('/user', { token: userToken });
}
