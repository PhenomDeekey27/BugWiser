import { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { DashboardHeader } from '@/components/dashboard/DashboardHeader';
import { StatsGrid } from '@/components/dashboard/StatsGrid';
import { RecentAnalyses } from '@/components/dashboard/RecentAnalyses';
import { WelcomeToast } from '@/components/dashboard/WelcomeToast';
import {
  GitHubConnectionCard,
  type ConnectionCheck,
} from '@/components/dashboard/GitHubConnectionCard';
import { Button } from '@/components/ui/button';
import { authUserFromSession, readAppSession, viewerFromAuthUser } from '@/lib/auth/session';
import { isGitHubCredentialExpired } from '@/lib/auth/session-token';
import { createBackgroundClient } from '@/lib/supabase/background';
import { listAccessibleRepositories } from '@/lib/github/access';
import { GitHubError } from '@/lib/github/errors';
import { githubOAuthManageUrl, isGitHubOAuthConfigured } from '@/lib/github/oauth/config';
import { summarizeAnalyses } from '@/lib/analysis/dashboard-analyses';
import { Analysis, AnalysisRecord } from '@/types';

function recordToAnalysis(record: AnalysisRecord): Analysis {
  return {
    id: record.id,
    repository: {
      id: record.repository_id,
      name: record.repository_name,
      fullName: record.repository_full_name,
      description: '',
      language: '',
      stars: 0,
      forks: 0,
      lastUpdated: record.updated_at,
      private: false,
      owner: record.repository_owner,
    },
    issue: {
      id: '',
      number: record.issue_number,
      title: record.issue_title,
      body: '',
      state: 'open',
      labels: [],
      assignees: [],
      createdAt: record.created_at,
      updatedAt: record.updated_at,
      closedAt: null,
      comments: 0,
      htmlUrl: '',
      userLogin: '',
      repositoryId: record.repository_id,
    },
    status: record.status as Analysis['status'],
    currentStage: record.current_stage as Analysis['currentStage'],
    stages: [],
    relevantFiles: [],
    rootCause: null,
    evidence: null,
    solution: null,
    patch: null,
    startedAt: record.created_at,
    completedAt: record.completed_at,
  };
}

export default async function DashboardPage() {
  const session = await readAppSession();
  if (!session) {
    // Backup for the middleware's protected-route redirect — same destination.
    redirect('/auth/github');
  }

  const user = authUserFromSession(session);
  const githubUser = viewerFromAuthUser(user);

  // GitHub itself is the authority on how many repositories this account can
  // read. The credential is used as-is here: a server component cannot write
  // cookies, so a refresh belongs to `/api/auth/session`, not to this render.
  let repositoryCount: number | null = null;
  let connectionCheck: ConnectionCheck = 'not_checked';

  if (user.source === 'github') {
    if (!session.github || isGitHubCredentialExpired(session.github)) {
      connectionCheck = 'reauth_required';
    } else {
      try {
        const { repositories } = await listAccessibleRepositories(
          session.github.accessToken
        );
        repositoryCount = repositories.length;
        connectionCheck = repositories.length === 0 ? 'empty' : 'ok';
      } catch (error) {
        connectionCheck =
          error instanceof GitHubError && error.code === 'auth_rejected'
            ? 'reauth_required'
            : 'sync_failed';
        console.error(
          '[dashboard] Failed to list GitHub repositories:',
          error instanceof Error ? error.message : 'unknown error'
        );
      }
    }
  }

  const repoCount: string | number = repositoryCount ?? '—';

  let issuesAnalyzed = 0;
  let patchesGenerated = 0;
  let recentAnalyses: Analysis[] = [];

  try {
    const db = createBackgroundClient();
    const { data: analyses } = await db
      .from('analyses')
      .select('*')
      .eq('user_id', user.userId)
      .order('created_at', { ascending: false });

    if (analyses) {
      // One deduplicated row set drives BOTH the counters and the cards.
      // Dedupe is by the stable analysis id only: two intentional analyses of
      // the same repository/issue keep their own ids and both stay visible.
      const summary = summarizeAnalyses(analyses as AnalysisRecord[], 5);
      issuesAnalyzed = summary.issuesAnalyzed;
      patchesGenerated = summary.patchesGenerated;
      recentAnalyses = summary.recent.map(recordToAnalysis);
    }
  } catch {
    // Keep defaults on error
  }

  return (
    <AppShell user={githubUser} gradient="dashboard">
      <Suspense>
        <WelcomeToast />
      </Suspense>
      <div className="p-6 max-w-4xl mx-auto">
        <DashboardHeader userName={githubUser?.login || 'developer'} />
        <StatsGrid
          stats={[
            { label: 'Repositories', value: repoCount },
            { label: 'Issues Analyzed', value: issuesAnalyzed },
            { label: 'Patches Generated', value: patchesGenerated },
          ]}
        />
        <RecentAnalyses analyses={recentAnalyses} />

        <GitHubConnectionCard
          configured={isGitHubOAuthConfigured()}
          connected={user.source === 'github'}
          repositoryCount={repositoryCount}
          manageUrl={githubOAuthManageUrl()}
          check={connectionCheck}
          login={githubUser?.login || null}
        />

        <div className="mt-8">
          <h2 className="text-lg font-semibold text-bw-peach-light mb-4">
            Quick Actions
          </h2>
          <div className="flex gap-4">
            <Link href="/analysis/new">
              <Button className="btn-bw-primary font-medium">
                Analyze an Issue
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
