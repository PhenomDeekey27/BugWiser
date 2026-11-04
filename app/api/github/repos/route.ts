import { NextResponse } from 'next/server';
import {
  applyCredentialRefresh,
  githubAuthErrorResponse,
  resolveGitHubCredential,
} from '@/lib/auth/github-token';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { listAccessibleRepositories } from '@/lib/github/access';
import { githubErrorResponse } from '@/lib/github/http';
import { logGitHubError, logGitHubEvent } from '@/lib/github/log';
import { githubOAuthManageUrl } from '@/lib/github/oauth/config';
import { describeRepositoryAccessState } from '@/lib/github/repositories-core';
import { Repository } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The repositories the signed-in GitHub account can reach.
 *
 * There is no installation to synchronize and no database cache: the list is
 * whatever GitHub returns for this user's token right now, so a revoked
 * collaboration disappears immediately. A guest (no GitHub identity) is a valid
 * state, reported as `requiresGitHub` with an empty list — not as an error.
 */
export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const manageUrl = githubOAuthManageUrl();

  if (user.source !== 'github') {
    return NextResponse.json(
      {
        repositories: [],
        connected: false,
        requiresGitHub: true,
        empty: false,
        truncated: false,
        manageUrl,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const credential = await resolveGitHubCredential();
  if (!credential.ok) {
    return githubAuthErrorResponse(credential.reason);
  }

  try {
    const { repositories: accessible, truncated } = await listAccessibleRepositories(
      credential.credential.accessToken
    );

    const repositories: Repository[] = accessible.map((repo) => ({
      id: String(repo.repoId),
      name: repo.name,
      fullName: repo.fullName,
      description: repo.description,
      language: repo.language,
      stars: repo.stars,
      forks: repo.forks,
      lastUpdated: repo.pushedAt || repo.updatedAt || new Date(0).toISOString(),
      private: repo.private,
      owner: repo.owner,
      ownerAvatar: '',
      defaultBranch: repo.defaultBranch,
      htmlUrl: repo.htmlUrl,
    }));

    const state = describeRepositoryAccessState({
      connected: true,
      repositoryCount: repositories.length,
    });

    logGitHubEvent('api/github/repos', 'listed repositories', {
      count: repositories.length,
      truncated,
      user: user.userId,
    });

    return applyCredentialRefresh(
      NextResponse.json(
        {
          repositories,
          connected: true,
          requiresGitHub: state.requiresGitHub,
          empty: state.empty,
          truncated,
          manageUrl,
        },
        { headers: { 'Cache-Control': 'no-store' } }
      ),
      credential
    );
  } catch (error) {
    // A rejected credential becomes 401 so the shared client flow can
    // re-authorize; every other GitHub failure keeps its own status.
    logGitHubError('api/github/repos', 'repository listing failed', error, {
      user: user.userId,
    });
    return applyCredentialRefresh(githubErrorResponse(error), credential);
  }
}
