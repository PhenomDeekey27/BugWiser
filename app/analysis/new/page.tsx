'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { RepositorySelector } from '@/components/analysis/RepositorySelector';
import { IssueSelector } from '@/components/analysis/IssueSelector';
import { Button } from '@/components/ui/button';
import { Repository, Issue, GitHubUser } from '@/types';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';

export default function NewAnalysisPage() {
  const router = useRouter();
  const [selectedRepository, setSelectedRepository] = useState<Repository | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [reposLoading, setReposLoading] = useState(true);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [reposError, setReposError] = useState<string | null>(null);
  const [issuesError, setIssuesError] = useState<string | null>(null);
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [authExpired, setAuthExpired] = useState(false);
  const [startingAnalysis, setStartingAnalysis] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user: authUser } }) => {
      if (authUser?.user_metadata) {
        setUser({
          login: authUser.user_metadata.user_name || authUser.user_metadata.login || 'user',
          name: authUser.user_metadata.full_name || authUser.user_metadata.name || null,
          avatarUrl: authUser.user_metadata.avatar_url || '',
        });
      }
    });
  }, []);

  useEffect(() => {
    async function fetchRepos() {
      try {
        const response = await fetch('/api/github/repos');
        if (response.status === 401) {
          setAuthExpired(true);
          setReposError(null);
          return;
        }
        if (!response.ok) {
          throw new Error('Failed to fetch repositories');
        }
        const data = await response.json();
        setRepositories(data.repositories || []);
      } catch {
        setReposError("We couldn't load your repositories. Please try again later.");
      } finally {
        setReposLoading(false);
      }
    }
    fetchRepos();
  }, []);

  useEffect(() => {
    if (!selectedRepository) return;

    let cancelled = false;

    async function fetchRepoIssues() {
      setIssuesLoading(true);
      setIssuesError(null);
      try {
        const [owner, repo] = selectedRepository!.fullName.split('/');
        const response = await fetch(
          `/api/github/issues?owner=${owner}&repo=${repo}&state=open`
        );
        if (!response.ok) {
          throw new Error('Failed to fetch issues');
        }
        const data = await response.json();
        if (!cancelled) {
          setIssues(data.issues || []);
        }
      } catch {
        if (!cancelled) {
          setIssuesError("We couldn't load issues for this repository.");
        }
      } finally {
        if (!cancelled) {
          setIssuesLoading(false);
        }
      }
    }
    fetchRepoIssues();

    return () => {
      cancelled = true;
    };
  }, [selectedRepository]);

  const handleRepositorySelect = useCallback((repo: Repository) => {
    setSelectedRepository(repo);
    setSelectedIssue(null);
    setIssues([]);
  }, []);

  const handleStartAnalysis = async () => {
    if (!selectedRepository || !selectedIssue || startingAnalysis) return;

    setStartingAnalysis(true);

    try {
      const createResponse = await fetch('/api/analyses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repository: selectedRepository,
          issue: selectedIssue,
        }),
      });

      if (!createResponse.ok) {
        let errorMessage = 'Failed to create analysis';
        try {
          const errData = await createResponse.json();
          errorMessage = errData.error || errorMessage;
        } catch {
          errorMessage = `Server error (${createResponse.status})`;
        }
        throw new Error(errorMessage);
      }

      const { analysisId } = await createResponse.json();

      localStorage.setItem(
        'analysis-selection',
        JSON.stringify({
          repository: selectedRepository,
          issue: selectedIssue,
        })
      );

      const runResponse = await fetch(`/api/analyses/${analysisId}/run`, {
        method: 'POST',
      });

      if (!runResponse.ok) {
        let errorMessage = 'Failed to start analysis runner';
        try {
          const errData = await runResponse.json();
          errorMessage = errData.error || errorMessage;
        } catch {
          errorMessage = `Server error (${runResponse.status})`;
        }
        throw new Error(errorMessage);
      }

      toast.success('Analysis created! Initializing investigation...');
      router.push(`/analysis/${analysisId}`);
    } catch (error) {
      const err = error as Error;
      toast.error(err.message || 'Failed to start analysis');
      setStartingAnalysis(false);
    }
  };

  const handleReLogin = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    localStorage.removeItem('analysis-selection');
    router.push('/auth/github');
  };

  return (
    <AppShell user={user} gradient="new-analysis">
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-semibold text-bw-peach-light mb-6">
          New Analysis
        </h1>

        {authExpired ? (
          <div className="flex flex-col items-center justify-center py-16 rounded-lg bg-surface-container/90 border border-bw-burgundy/40">
            <p className="text-sm text-bw-peach mb-4 text-center">
              Your session has expired. Please sign in again to access your repositories.
            </p>
            <Button
              className="btn-bw-primary font-medium"
              onClick={handleReLogin}
            >
              Sign in with GitHub
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <RepositorySelector
                selectedRepository={selectedRepository}
                onSelect={handleRepositorySelect}
                repositories={repositories}
                loading={reposLoading}
                error={reposError}
              />
            </div>

            <div>
              {selectedRepository ? (
                <IssueSelector
                  selectedIssue={selectedIssue}
                  onSelect={setSelectedIssue}
                  issues={issues}
                  loading={issuesLoading}
                  error={issuesError}
                />
              ) : (
                <div className="flex items-center justify-center h-64 rounded-lg bg-surface-container/80 border border-bw-burgundy/30">
                  <p className="text-sm text-bw-peach">
                    Select a repository first
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {selectedRepository && selectedIssue && (
          <div className="mt-6 flex justify-end">
            <Button
              className="btn-bw-primary font-medium"
              onClick={handleStartAnalysis}
              disabled={startingAnalysis}
            >
              {startingAnalysis ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-bw-peach-light/30 border-t-bw-peach-light rounded-full animate-spin" />
                  Creating Analysis...
                </span>
              ) : (
                'Start Analysis'
              )}
            </Button>
          </div>
        )}
      </div>
    </AppShell>
  );
}
