import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { Repository } from '@/types';
import {
  listAccessibleRepositories,
  listLinkedInstallations,
  refreshInstallationsForUser,
} from '@/lib/github/app/access';
import { githubAppInstallUrl } from '@/lib/github/app/config';
import { GitHubAppError } from '@/lib/github/app/errors';
import { githubErrorResponse } from '@/lib/github/app/http';
import { logGitHubError, logGitHubEvent } from '@/lib/github/app/log';
import { describeRepositoryListState } from '@/lib/github/app/repository-sync-core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    let installations = await listLinkedInstallations(user.userId);
    let access = await listAccessibleRepositories(user.userId);
    let syncFailureCount = 0;

    // First visit after installing (or after a stale/missing sync): pull the
    // installation's repositories. Failures are reported, never hidden as an
    // empty list.
    if (access.length === 0) {
      const refresh = await refreshInstallationsForUser(user.userId, user.githubUserId);
      syncFailureCount =
        refresh.failures.length + (refresh.reason === 'github_error' ? 1 : 0);

      if (refresh.attempted > 0) {
        installations = await listLinkedInstallations(user.userId);
        access = await listAccessibleRepositories(user.userId);
      }

      logGitHubEvent('api/github/repos', 'refresh finished', {
        attempted: refresh.attempted,
        refreshed: refresh.refreshed,
        failed: refresh.failures.length,
        reason: refresh.reason,
      });
    }

    const state = describeRepositoryListState({
      installationCount: installations.length,
      repositoryCount: access.length,
      syncFailureCount,
    });

    if (state.failWithSyncError) {
      logGitHubEvent('api/github/repos', 'returning sync error instead of empty list', {
        installations: installations.length,
        syncFailures: syncFailureCount,
      });
      throw new GitHubAppError(
        'The GitHub App installation could not be synchronized. Check the server logs and reconnect GitHub.',
        'api_error'
      );
    }

    const repositories: Repository[] = access.map((repo) => ({
      id: String(repo.repoId),
      name: repo.name,
      fullName: repo.fullName,
      description: '',
      language: '',
      stars: 0,
      forks: 0,
      lastUpdated: repo.pushedAt || new Date(0).toISOString(),
      private: repo.private,
      owner: repo.owner,
      ownerAvatar: '',
      defaultBranch: repo.defaultBranch,
      htmlUrl: repo.htmlUrl,
    }));

    logGitHubEvent('api/github/repos', 'listed repositories', {
      count: repositories.length,
      installations: installations.length,
      requiresInstallation: state.requiresInstallation,
      requiresRepositorySelection: state.requiresRepositorySelection,
    });

    return NextResponse.json(
      {
        repositories,
        requiresInstallation: state.requiresInstallation,
        requiresRepositorySelection: state.requiresRepositorySelection,
        installUrl: githubAppInstallUrl(),
        manageUrl:
          installations.find((installation) => installation.html_url)?.html_url ||
          installations[0]?.html_url ||
          'https://github.com/settings/installations',
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    logGitHubError('api/github/repos', 'repository listing failed', error);
    return githubErrorResponse(error);
  }
}
