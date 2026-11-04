// Repository authorization with a GitHub OAuth user token.
//
// WHAT REPLACED THE INSTALLATION CHECK
// The former design resolved a repository through a GitHub App installation the
// user was linked to. An OAuth App has no installations, so the authority is
// simpler and stronger: GitHub itself decides, per request, whether THIS user's
// token can see THIS repository.
//
//   * `GET /repos/{owner}/{repo}` with the user's token succeeds → the user has
//     at least read access, and the response carries their push permission;
//   * 404 → the repository is invisible to this token (private repo without
//     access, deleted, or renamed). It is reported as "not available to your
//     GitHub account", never as a server error;
//   * 401 → the credential is dead and only a new authorization helps.
//
// Nothing here trusts a client-supplied repository id, owner, or visibility, and
// nothing is read from a database cache: a revoked collaboration takes effect on
// the next request.

import { fetchRepository, listAllUserRepositories } from './api';
import { GitHubError } from './errors';
import { logGitHubError } from './log';
import { mapApiRepositories, mapApiRepository, type AccessibleRepository } from './repositories-core';
import { parseRepositoryFullName } from './repository-name';

export type { AccessibleRepository };

export interface RepositoryAccess {
  repository: AccessibleRepository;
}

export async function listAccessibleRepositories(
  token: string
): Promise<{ repositories: AccessibleRepository[]; truncated: boolean }> {
  const { repositories, truncated } = await listAllUserRepositories(token);
  return { repositories: mapApiRepositories(repositories), truncated };
}

/**
 * Resolves "owner/name" against the user's own GitHub permissions.
 *
 * A malformed name is rejected before the network call; a repository the token
 * cannot see is a 404 from GitHub and becomes `not_found` with a message that
 * does not reveal whether the repository exists.
 */
export async function resolveRepositoryAccess(
  token: string,
  repositoryFullName: string
): Promise<RepositoryAccess> {
  const parsed = parseRepositoryFullName(repositoryFullName);
  if (!parsed.ok) {
    throw new GitHubError(
      parsed.reason === 'shape'
        ? 'Repository must be in "owner/name" form'
        : 'Invalid repository name',
      'not_found',
      { status: 400 }
    );
  }

  try {
    const row = await fetchRepository(token, parsed.owner, parsed.repo);
    const repository = mapApiRepository(row);
    if (!repository) {
      throw new GitHubError('GitHub returned an unusable repository record', 'api_error');
    }
    return { repository };
  } catch (error) {
    if (error instanceof GitHubError && error.code === 'not_found') {
      logGitHubError('github-access', 'repository not visible to this token', error, {
        repository: parsed.fullName,
      });
      throw new GitHubError(
        'This repository is not available to your GitHub account.',
        'not_found',
        { status: 404 }
      );
    }
    throw error;
  }
}

/**
 * Refuses a write when GitHub says this token has no push permission.
 *
 * When GitHub withheld `permissions` entirely the check is inconclusive, so the
 * write is attempted and GitHub remains the authority instead of BugWiser
 * inventing a denial.
 */
export function assertRepositoryWriteAccess(repository: AccessibleRepository): void {
  if (repository.permissionsKnown && !repository.canWrite) {
    throw new GitHubError(
      'Your GitHub account does not have write access to this repository.',
      'forbidden',
      { status: 403 }
    );
  }
}
