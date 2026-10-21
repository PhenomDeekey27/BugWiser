// Centralized GitHub App repository authorization.
//
// Every caller proves WHO the user is (BugWiser session), then this module
// proves WHICH installation/repository that user may use. A client-supplied
// installation id or repository name is never trusted on its own.

import { createBackgroundClient } from '@/lib/supabase/background';
import { getStoredUserAccessToken } from '@/lib/auth/identity';
import { githubAppInstallUrl, isGitHubAppConfigured } from './config';
import { GitHubApiError, fetchInstallationRepositories, fetchUserInstallations } from './api';
import { GitHubAppError } from './errors';
import { githubErrorCode, logGitHubError, logGitHubEvent } from './log';
import {
  buildInstallationRepositoryRows,
  findRemovedRepositoryIds,
} from './repository-sync-core';
import { getInstallationAccount, getInstallationToken, type CachedInstallationToken } from './token-cache';
import type { GitHubAppInstallation, GitHubInstallationRepository } from './types';

export interface InstallationRecord {
  installation_id: number;
  account_id: number;
  account_login: string;
  account_type: string;
  repository_selection: string | null;
  suspended_at: string | null;
  html_url?: string | null;
}

export interface AccessibleRepository {
  installationId: number;
  repoId: number;
  fullName: string;
  owner: string;
  name: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
  pushedAt: string | null;
  accountLogin: string;
  accountType: string;
}

export interface RepositoryAccess {
  installationId: number;
  repository: AccessibleRepository;
  token: CachedInstallationToken;
}

export interface InstallationStatus {
  configured: boolean;
  installations: Array<{
    installationId: number;
    accountLogin: string;
    accountType: string;
    repositorySelection: string | null;
    suspended: boolean;
    htmlUrl: string | null;
  }>;
  repositoryCount: number;
  installUrl: string | null;
  manageUrl: string;
}

function mapRepository(
  row: {
    installation_id: number;
    repo_id: number;
    full_name: string;
    owner: string;
    name: string;
    private: boolean;
    default_branch: string | null;
    html_url: string | null;
    pushed_at: string | null;
  },
  installation: InstallationRecord | undefined
): AccessibleRepository {
  return {
    installationId: row.installation_id,
    repoId: row.repo_id,
    fullName: row.full_name,
    owner: row.owner,
    name: row.name,
    private: row.private === true,
    defaultBranch: row.default_branch || 'main',
    htmlUrl: row.html_url || `https://github.com/${row.full_name}`,
    pushedAt: row.pushed_at,
    accountLogin: installation?.account_login || row.owner,
    accountType: installation?.account_type || 'User',
  };
}

export function normalizeRepositoryFullName(value: string): { owner: string; repo: string; fullName: string } {
  const trimmed = (value || '').trim();
  const parts = trimmed.split('/');
  if (parts.length !== 2) {
    throw new GitHubAppError('Repository must be in "owner/name" form', 'repository_not_found');
  }
  const [owner, repo] = parts;
  const segment = /^[A-Za-z0-9_.-]{1,100}$/;
  if (!segment.test(owner) || !segment.test(repo)) {
    throw new GitHubAppError('Invalid repository name', 'repository_not_found');
  }
  return { owner, repo, fullName: `${owner}/${repo}` };
}

async function getLinkedInstallationIds(userId: string): Promise<number[]> {
  const db = createBackgroundClient();
  const { data, error } = await db
    .from('github_installation_users')
    .select('installation_id')
    .eq('user_id', userId);

  if (error) {
    console.error('[github-access] Failed to read installation links:', error.message);
    throw new GitHubAppError('Could not read GitHub installation access', 'api_error');
  }

  return (data || [])
    .map((row) => Number(row.installation_id))
    .filter((id) => Number.isSafeInteger(id) && id > 0);
}

async function getInstallationRecords(ids: number[]): Promise<Map<number, InstallationRecord>> {
  if (ids.length === 0) return new Map();
  const db = createBackgroundClient();
  const { data, error } = await db
    .from('github_installations')
    .select('*')
    .in('installation_id', ids);

  if (error) {
    console.error('[github-access] Failed to read installations:', error.message);
    throw new GitHubAppError('Could not read GitHub installations', 'api_error');
  }

  return new Map(
    (data || []).map((row) => [Number(row.installation_id), row as InstallationRecord])
  );
}

export async function listLinkedInstallations(userId: string): Promise<InstallationRecord[]> {
  const ids = await getLinkedInstallationIds(userId);
  const map = await getInstallationRecords(ids);
  return ids.map((id) => map.get(id)).filter(Boolean) as InstallationRecord[];
}

export async function listAccessibleRepositories(userId: string): Promise<AccessibleRepository[]> {
  const ids = await getLinkedInstallationIds(userId);
  if (ids.length === 0) return [];

  const db = createBackgroundClient();
  const installations = await getInstallationRecords(ids);
  const { data, error } = await db
    .from('github_installation_repositories')
    .select('*')
    .in('installation_id', ids);

  if (error) {
    console.error('[github-access] Failed to read installation repositories:', error.message);
    throw new GitHubAppError('Could not read repositories', 'api_error');
  }

  return (data || [])
    .map((row) => mapRepository(row, installations.get(Number(row.installation_id))))
    .sort((a, b) => (b.pushedAt || '').localeCompare(a.pushedAt || ''));
}

export async function verifyInstallationOwnership(
  userToken: string,
  installationId: number
): Promise<GitHubAppInstallation> {
  let installations: GitHubAppInstallation[];
  try {
    installations = await fetchUserInstallations(userToken);
  } catch (error) {
    if (error instanceof GitHubAppError && error.code === 'app_auth_failed') {
      throw new GitHubAppError(
        'Your GitHub authorization expired. Please sign in again.',
        'installation_forbidden',
        { status: 401 }
      );
    }
    throw error;
  }

  const match = installations.find((installation) => installation.id === installationId);
  if (!match) {
    throw new GitHubAppError(
      'This installation is not accessible to your GitHub account.',
      'installation_forbidden',
      { status: 403 }
    );
  }
  return match;
}

export async function syncInstallation(
  userId: string,
  installationId: number,
  options: { userToken?: string; verifiedInstallation?: GitHubAppInstallation } = {}
): Promise<{ installation: InstallationRecord; repositories: GitHubInstallationRepository[] }> {
  if (!Number.isSafeInteger(installationId) || installationId <= 0) {
    throw new GitHubAppError('Invalid installation id', 'installation_not_found');
  }

  logGitHubEvent('github-access', 'sync started', {
    installation: installationId,
    user: userId,
  });

  const alreadyVerified =
    options.verifiedInstallation?.id === installationId ? options.verifiedInstallation : null;

  // GitHub explicitly recommends verifying installations with a user token
  // because a spoofed `installation_id` can reach the setup URL.
  if (options.userToken && !alreadyVerified) {
    await verifyInstallationOwnership(options.userToken, installationId);
  }

  let installation: GitHubAppInstallation;
  try {
    installation = alreadyVerified || (await getInstallationAccount(installationId));
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) {
      throw new GitHubAppError('GitHub App installation was not found', 'installation_not_found');
    }
    throw error;
  }

  if (installation.suspended_at) {
    throw new GitHubAppError('This GitHub App installation is suspended', 'installation_suspended');
  }

  const db = createBackgroundClient();
  const updatedAt = new Date().toISOString();

  const { error: installationError } = await db.from('github_installations').upsert(
    {
      installation_id: installation.id,
      account_id: installation.account.id,
      account_login: installation.account.login,
      account_type: installation.account.type,
      repository_selection: installation.repository_selection,
      permissions: installation.permissions || {},
      suspended_at: installation.suspended_at,
      html_url: installation.html_url,
      updated_at: updatedAt,
    },
    { onConflict: 'installation_id' }
  );

  if (installationError) {
    logGitHubError('github-access', 'installation write failed', installationError, {
      installation: installation.id,
    });
    throw new GitHubAppError('Could not store GitHub installation', 'api_error');
  }

  logGitHubEvent('github-access', 'installation stored', {
    installation: installation.id,
    account: installation.account.login,
  });

  const { error: linkError } = await db.from('github_installation_users').upsert(
    { installation_id: installation.id, user_id: userId },
    { onConflict: 'installation_id,user_id' }
  );

  if (linkError) {
    logGitHubError('github-access', 'installation link failed', linkError, {
      installation: installation.id,
    });
    throw new GitHubAppError('Could not link GitHub installation', 'api_error');
  }

  logGitHubEvent('github-access', 'installation linked to user', {
    installation: installation.id,
  });

  const token = await getInstallationToken(installation.id);
  const repositories = await fetchInstallationRepositories(token.token);

  const rows = buildInstallationRepositoryRows(installation.id, repositories, updatedAt);
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    const { error } = await db
      .from('github_installation_repositories')
      .upsert(batch, { onConflict: 'installation_id,repo_id' });
    if (error) {
      logGitHubError('github-access', 'repository write failed', error, {
        installation: installation.id,
      });
      throw new GitHubAppError('Could not store installation repositories', 'api_error');
    }
  }

  logGitHubEvent('github-access', 'repositories synchronized', {
    installation: installation.id,
    count: rows.length,
  });

  // Repository access can be removed on GitHub. Drop rows no longer returned.
  const { data: stored, error: storedError } = await db
    .from('github_installation_repositories')
    .select('repo_id')
    .eq('installation_id', installation.id);

  if (storedError) {
    logGitHubError('github-access', 'stored repository read failed', storedError, {
      installation: installation.id,
    });
    throw new GitHubAppError('Could not read installation repositories', 'api_error');
  }

  const removed = findRemovedRepositoryIds(
    (stored || []).map((row) => Number(row.repo_id)),
    repositories.map((repo) => repo.id)
  );

  if (removed.length > 0) {
    const { error: deleteError } = await db
      .from('github_installation_repositories')
      .delete()
      .eq('installation_id', installation.id)
      .in('repo_id', removed);
    if (deleteError) {
      logGitHubError('github-access', 'stale repository delete failed', deleteError, {
        installation: installation.id,
      });
    } else {
      logGitHubEvent('github-access', 'stale repositories removed', {
        installation: installation.id,
        count: removed.length,
      });
    }
  }

  return {
    installation: {
      installation_id: installation.id,
      account_id: installation.account.id,
      account_login: installation.account.login,
      account_type: installation.account.type,
      repository_selection: installation.repository_selection,
      suspended_at: installation.suspended_at,
      html_url: installation.html_url,
    },
    repositories,
  };
}

export type InstallationRefreshReason =
  | 'ok'
  | 'no_user_token'
  | 'no_installation'
  | 'github_error';

export interface InstallationRefreshResult {
  attempted: number;
  refreshed: number;
  failures: Array<{ installationId: number; code: string }>;
  reason: InstallationRefreshReason;
  message?: string;
}

/**
 * Resolve the GitHub numeric id from the signed session, falling back to the
 * stored identity for legacy Supabase sessions.
 */
async function resolveNumericGithubId(
  userId: string,
  githubUserId?: string | number | null
): Promise<number | null> {
  const direct = Number(githubUserId);
  if (Number.isSafeInteger(direct) && direct > 0) return direct;

  const db = createBackgroundClient();
  const { data } = await db
    .from('github_identities')
    .select('github_user_id')
    .eq('user_id', userId)
    .maybeSingle();

  const stored = Number(data?.github_user_id);
  return Number.isSafeInteger(stored) && stored > 0 ? stored : null;
}

/**
 * Refresh installations using the encrypted user token, when one is stored.
 *
 * Returns what happened instead of swallowing it: the repository endpoint must
 * be able to tell "no installation" from "the sync failed", otherwise a broken
 * configuration is rendered as an empty repository list.
 */
export async function refreshInstallationsForUser(
  userId: string,
  githubUserId?: string | number | null
): Promise<InstallationRefreshResult> {
  const numericId = await resolveNumericGithubId(userId, githubUserId);
  if (!numericId) {
    logGitHubEvent('github-access', 'installation refresh skipped', { reason: 'no_github_identity' });
    return { attempted: 0, refreshed: 0, failures: [], reason: 'no_user_token' };
  }

  const userToken = await getStoredUserAccessToken(numericId);
  if (!userToken) {
    logGitHubEvent('github-access', 'installation refresh skipped', { reason: 'no_user_token' });
    return {
      attempted: 0,
      refreshed: 0,
      failures: [],
      reason: 'no_user_token',
      message: 'No recent GitHub user token is stored.',
    };
  }

  let installations: GitHubAppInstallation[];
  try {
    installations = await fetchUserInstallations(userToken);
  } catch (error) {
    logGitHubError('github-access', 'installation enumeration failed', error);
    return {
      attempted: 0,
      refreshed: 0,
      failures: [],
      reason: 'github_error',
      message: 'Could not list GitHub installations.',
    };
  }

  if (installations.length === 0) {
    logGitHubEvent('github-access', 'installation refresh found none');
    return { attempted: 0, refreshed: 0, failures: [], reason: 'no_installation' };
  }

  let refreshed = 0;
  const failures: Array<{ installationId: number; code: string }> = [];

  for (const installation of installations.slice(0, 20)) {
    try {
      await syncInstallation(userId, installation.id);
      refreshed++;
    } catch (error) {
      // One broken installation must not hide the others.
      if (error instanceof GitHubAppError && error.code === 'installation_suspended') {
        const db = createBackgroundClient();
        await db
          .from('github_installations')
          .update({ suspended_at: installation.suspended_at, updated_at: new Date().toISOString() })
          .eq('installation_id', installation.id);
        logGitHubEvent('github-access', 'installation suspended', {
          installation: installation.id,
        });
        continue;
      }

      failures.push({ installationId: installation.id, code: githubErrorCode(error) });
      logGitHubError('github-access', 'installation refresh failed', error, {
        installation: installation.id,
      });
    }
  }

  logGitHubEvent('github-access', 'installation refresh finished', {
    attempted: installations.length,
    refreshed,
    failed: failures.length,
  });

  return {
    attempted: installations.length,
    refreshed,
    failures,
    reason: 'ok',
  };
}

export async function resolveRepositoryAccess(
  userId: string,
  repositoryFullName: string,
  options: { refresh?: boolean } = {}
): Promise<{ installationId: number; repository: AccessibleRepository }> {
  const { fullName } = normalizeRepositoryFullName(repositoryFullName);

  const find = async (): Promise<{ installationId: number; repository: AccessibleRepository } | null> => {
    const ids = await getLinkedInstallationIds(userId);
    if (ids.length === 0) return null;

    const db = createBackgroundClient();
    const { data, error } = await db
      .from('github_installation_repositories')
      .select('*')
      .in('installation_id', ids)
      .ilike('full_name', fullName)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[github-access] Repository lookup failed:', error.message);
      throw new GitHubAppError('Could not check repository access', 'api_error');
    }
    if (!data) return null;

    const installations = await getInstallationRecords([Number(data.installation_id)]);
    const installation = installations.get(Number(data.installation_id));
    if (installation?.suspended_at) {
      throw new GitHubAppError('This GitHub App installation is suspended', 'installation_suspended');
    }
    return {
      installationId: Number(data.installation_id),
      repository: mapRepository(data, installation),
    };
  };

  let access = await find();
  if (!access && options.refresh !== false) {
    await refreshInstallationsForUser(userId);
    access = await find();
  }

  if (!access) {
    throw new GitHubAppError(
      'This repository is not available to your GitHub App installation.',
      'repository_not_authorized',
      { status: 403 }
    );
  }

  return access;
}

export async function getRepositoryAccessToken(
  userId: string,
  repositoryFullName: string
): Promise<RepositoryAccess> {
  const access = await resolveRepositoryAccess(userId, repositoryFullName);
  const token = await getInstallationToken(access.installationId);
  return { ...access, token };
}

export function assertTokenPermissions(
  token: CachedInstallationToken,
  required: Record<string, 'read' | 'write'>
): void {
  for (const [permission, level] of Object.entries(required)) {
    const actual = token.permissions[permission];
    if (level === 'write') {
      if (actual !== 'write') {
        throw new GitHubAppError(
          `The GitHub App installation is missing the "${permission}: write" permission.`,
          'missing_permissions',
          { status: 403 }
        );
      }
    } else if (actual !== 'read' && actual !== 'write') {
      throw new GitHubAppError(
        `The GitHub App installation is missing the "${permission}: read" permission.`,
        'missing_permissions',
        { status: 403 }
      );
    }
  }
}

export async function getInstallationStatus(userId: string): Promise<InstallationStatus> {
  const installations = await listLinkedInstallations(userId);
  const repositories = await listAccessibleRepositories(userId);
  // A present-but-invalid key must not be reported as "configured".
  const configured = isGitHubAppConfigured();

  return {
    configured,
    installations: installations.map((installation) => ({
      installationId: installation.installation_id,
      accountLogin: installation.account_login,
      accountType: installation.account_type,
      repositorySelection: installation.repository_selection,
      suspended: Boolean(installation.suspended_at),
      htmlUrl: installation.html_url || null,
    })),
    repositoryCount: repositories.length,
    installUrl: githubAppInstallUrl(),
    manageUrl:
      installations.find((installation) => installation.html_url)?.html_url ||
      installations[0]?.html_url ||
      'https://github.com/settings/installations',
  };
}
