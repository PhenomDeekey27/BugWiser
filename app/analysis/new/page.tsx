'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { RepositorySelector } from '@/components/analysis/RepositorySelector';
import { IssueSelector } from '@/components/analysis/IssueSelector';
import { SelectedModelSummary } from '@/components/models/SelectedModelSummary';
import { ModelPreflight } from '@/components/analysis/ModelPreflight';
import { Repository, Issue, GitHubUser } from '@/types';
import { createClient } from '@/lib/supabase/client';
import { invalidateGitHubSession } from '@/lib/supabase/auth-session';
import { toast } from 'sonner';
import type { CatalogModel, CatalogProvider, Preference } from '@/app/models/page';

interface PreflightStrategy {
  tier: string;
  provider: string;
  model: string;
  isFree: boolean;
  costLevel: string;
  speed: string;
  reason: string;
}

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
  const [startingAnalysis, setStartingAnalysis] = useState(false);
  const [showPreflight, setShowPreflight] = useState(false);

  const [providers, setProviders] = useState<CatalogProvider[]>([]);
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [preference, setPreference] = useState<Preference | null>(null);
  const [mode, setMode] = useState<'auto' | 'manual'>('auto');
  const [selectedProvider, setSelectedProvider] = useState('');
  const [selectedModel, setSelectedModel] = useState('');

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
    (async () => {
      try {
        const res = await fetch('/api/models');
        if (!res.ok) return;
        const data = await res.json();
        setProviders(data.providers || []);
        setModels(data.models || []);
        if (data.preference) {
          const p = data.preference as Preference;
          setPreference(p);
          setMode(p.selection_mode || 'auto');
          setSelectedProvider(p.provider || '');
          setSelectedModel(p.model || '');
        }
      } catch { /* ignore */ }
    })();
  }, []);

  const handleSaveModel = async () => {
    try {
      if (mode === 'manual' && (!selectedProvider || !selectedModel)) {
        toast.error('Select a provider and model for manual mode.');
        return false;
      }
      const res = await fetch('/api/models/preference', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selection_mode: mode,
          provider: mode === 'manual' ? selectedProvider : null,
          model: mode === 'manual' ? selectedModel : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save preference');
      setPreference(data.preference);
      return true;
    } catch (e) {
      toast.error((e as Error).message || 'Failed to save preference');
      return false;
    }
  };

  useEffect(() => {
    async function fetchRepos() {
      try {
        const response = await fetch('/api/github/repos');
        if (response.status === 401) {
          // Auth-expired response from the GitHub API route — one shared
          // flow: clear global GitHub state and go to /auth/github.
          await invalidateGitHubSession(router);
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
  }, [router]);

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
        if (response.status === 401) {
          // Auth-expired response — same shared invalidation flow as repos.
          if (!cancelled) await invalidateGitHubSession(router);
          return;
        }
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
  }, [selectedRepository, router]);

  const handleRepositorySelect = useCallback((repo: Repository) => {
    setSelectedRepository(repo);
    setSelectedIssue(null);
    setIssues([]);
  }, []);

  const handleStartAnalysis = async () => {
    if (!selectedRepository || !selectedIssue || startingAnalysis) return;

    // Persist the user's model selection before starting.
    const saved = await handleSaveModel();
    if (!saved) return;

    // Show preflight model selection
    setShowPreflight(true);
  };

  const handlePreflightSelect = async (strategy: PreflightStrategy) => {
    setShowPreflight(false);
    await startAnalysisWithStrategy(strategy);
  };

  const startAnalysisWithStrategy = async (strategy: PreflightStrategy | null) => {
    if (!selectedRepository || !selectedIssue) return;

    setStartingAnalysis(true);

    try {
      const createResponse = await fetch('/api/analyses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repository: selectedRepository,
          issue: selectedIssue,
          model_strategy: strategy ? {
            tier: strategy.tier,
            provider: strategy.provider,
            model: strategy.model,
          } : null,
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

  return (
    <AppShell user={user} gradient="new-analysis">
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-semibold text-bw-peach-light mb-6">
          New Analysis
        </h1>

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
<div className="flex items-center justify-center h-64 rounded-lg bg-surface border border-border">
                 <p className="text-sm text-bw-peach">
                   Select a repository first
                 </p>
               </div>
            )}
          </div>
        </div>

        {selectedRepository && selectedIssue && (
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <SelectedModelSummary
                mode={mode}
                onModeChange={setMode}
                providers={providers}
                models={models}
                selectedProvider={selectedProvider}
                setSelectedProvider={setSelectedProvider}
                selectedModel={selectedModel}
                setSelectedModel={setSelectedModel}
                preference={preference}
                onSave={handleSaveModel as () => void}
                onStart={handleStartAnalysis}
                starting={startingAnalysis}
                available={!!selectedRepository && !!selectedIssue}
              />
            </div>
          </div>
        )}

        {showPreflight && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto p-4 sm:p-6 rounded-xl bg-surface border border-border shadow-2xl">
              <ModelPreflight
                onSelect={handlePreflightSelect}
                onCancel={() => {
                  setShowPreflight(false);
                  setStartingAnalysis(false);
                }}
              />
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
