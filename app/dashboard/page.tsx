import { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { DashboardHeader } from '@/components/dashboard/DashboardHeader';
import { StatsGrid } from '@/components/dashboard/StatsGrid';
import { RecentAnalyses } from '@/components/dashboard/RecentAnalyses';
import { WelcomeToast } from '@/components/dashboard/WelcomeToast';
import { GitHubStatusToast } from '@/components/dashboard/GitHubStatusToast';
import { GitHubConnectionCard, type GitHubInstallationView } from '@/components/dashboard/GitHubConnectionCard';
import { Button } from '@/components/ui/button';
import { getAuthenticatedUser, viewerFromAuthUser } from '@/lib/auth/session';
import { createBackgroundClient } from '@/lib/supabase/background';
import { getInstallationStatus } from '@/lib/github/app/access';
import { githubAppInstallUrl } from '@/lib/github/app/config';
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
  const user = await getAuthenticatedUser();
  if (!user) {
    // Backup for the middleware's protected-route redirect — same destination.
    redirect('/auth/github');
  }

  const githubUser = viewerFromAuthUser(user);

  let repoCount: string | number = '—';
  let installation: {
    configured: boolean;
    installations: GitHubInstallationView[];
    repositoryCount: number;
    installUrl: string | null;
    manageUrl: string;
  } = {
    configured: false,
    installations: [],
    repositoryCount: 0,
    installUrl: githubAppInstallUrl(),
    manageUrl: 'https://github.com/settings/installations',
  };

  try {
    const status = await getInstallationStatus(user.userId);
    repoCount = status.repositoryCount;
    installation = {
      configured: status.configured,
      installations: status.installations,
      repositoryCount: status.repositoryCount,
      installUrl: status.installUrl || githubAppInstallUrl(),
      manageUrl: status.manageUrl,
    };
  } catch (error) {
    // GitHub tables unavailable or a transient read failure: keep the card
    // honest ("not configured") instead of failing the whole dashboard.
    console.error('[dashboard] Failed to read GitHub installation status:', (error as Error).message);
  }

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
        <GitHubStatusToast />
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
          configured={installation.configured}
          installations={installation.installations}
          repositoryCount={installation.repositoryCount}
          installUrl={installation.installUrl}
          manageUrl={installation.manageUrl}
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
