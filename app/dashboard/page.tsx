import { Suspense } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { DashboardHeader } from '@/components/dashboard/DashboardHeader';
import { StatsGrid } from '@/components/dashboard/StatsGrid';
import { RecentAnalyses } from '@/components/dashboard/RecentAnalyses';
import { WelcomeToast } from '@/components/dashboard/WelcomeToast';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
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
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    // Backup for the middleware's protected-route redirect — same destination.
    redirect('/auth/github');
  }

  const githubUser = user?.user_metadata
    ? {
        login: user.user_metadata.user_name || user.user_metadata.login || 'user',
        name: user.user_metadata.full_name || user.user_metadata.name || null,
        avatarUrl: user.user_metadata.avatar_url || '',
      }
    : null;

  let repoCount: string | number = '—';
  let issuesAnalyzed = 0;
  let patchesGenerated = 0;
  let recentAnalyses: Analysis[] = [];
  let tokenExpired = false;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.provider_token) {
      const response = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${session.provider_token}`,
          Accept: 'application/vnd.github+json',
        },
      });
      if (response.ok) {
        const githubUserData = await response.json();
        repoCount = githubUserData.public_repos ?? '—';
      } else if (response.status === 401) {
        tokenExpired = true;
      }
    } else {
      tokenExpired = true;
    }
  } catch {
    // Keep default
  }

  if (tokenExpired) {
    // GitHub session expired (missing provider_token or GitHub rejected the
    // token) — reconnect at /auth/github, never a silent bounce to home.
    redirect(
      `/auth/github?error=${encodeURIComponent('Your GitHub session has expired. Please sign in again.')}`
    );
  }

  if (user) {
    try {
      const { data: analyses } = await supabase
        .from('analyses')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (analyses) {
        issuesAnalyzed = analyses.filter(
          (a) => a.status === 'completed'
        ).length;

        patchesGenerated = analyses.filter(
          (a) => a.patch_status && a.patch_status !== 'none'
        ).length;

        recentAnalyses = analyses.slice(0, 5).map(recordToAnalysis);
      }
    } catch {
      // Keep defaults on error
    }
  }

  return (
    <AppShell user={githubUser} gradient="dashboard">
      <Suspense>
        <WelcomeToast />
      </Suspense>
      <div className="p-6 max-w-4xl mx-auto">
        <DashboardHeader userName={githubUser?.login || 'developer'} />
        <StatsGrid stats={[
          { label: 'Repositories', value: repoCount },
          { label: 'Issues Analyzed', value: issuesAnalyzed },
          { label: 'Patches Generated', value: patchesGenerated },
        ]} />
        <RecentAnalyses analyses={recentAnalyses} />

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
