'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  PublicIssuePicker,
  type PublicIssueSelection,
} from '@/components/public/PublicIssuePicker';
import { PublicRepositoryCard } from '@/components/public/PublicRepositoryCard';
import { AUTH_CHANGED_EVENT, invalidateAuthCache } from '@/lib/auth/client-session';
import { toast } from 'sonner';

interface ResolvedRepository {
  id: string;
  name: string;
  fullName: string;
  owner: string;
  description: string;
  language: string | null;
  stars: number;
  forks: number;
  defaultBranch: string;
  htmlUrl: string;
  private: boolean;
}

interface ResolvedBranch {
  name: string;
  sha: string;
  protected: boolean;
}

interface ResolveResponse {
  repository: ResolvedRepository;
  branch: string;
  defaultBranch: string;
  commit: {
    sha: string;
    message: string;
    committedAt: string | null;
    htmlUrl: string;
  };
  pinnedFrom: 'branch' | 'commit';
  branches: ResolvedBranch[];
}

type IssueMode = 'github' | 'description';

const MIN_DESCRIPTION = 20;

function createSubmissionKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `public-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function PublicImportForm() {
  const router = useRouter();

  const [url, setUrl] = useState('');
  const [resolved, setResolved] = useState<ResolveResponse | null>(null);
  const [branch, setBranch] = useState('');
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const [issueMode, setIssueMode] = useState<IssueMode>('github');
  const [issueSelection, setIssueSelection] = useState<PublicIssueSelection>({
    issueNumber: null,
    issueUrl: '',
  });
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const [creating, setCreating] = useState(false);

  const [schemaReady, setSchemaReady] = useState<boolean | null>(null);
  const [schemaMessage, setSchemaMessage] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const response = await fetch('/api/public/schema', { cache: 'no-store' });
        const data = await response.json().catch(() => null);
        if (!alive) return;
        if (response.ok && data?.ready === true) {
          setSchemaReady(true);
          return;
        }
        setSchemaReady(false);
        if (data?.migration) {
          setSchemaMessage(
            `${data.error || 'The public-repository schema is missing.'} Migration: ${data.migration}`
          );
        } else {
          setSchemaMessage(
            data?.error || 'The database schema could not be checked. Public analyses may fail.'
          );
        }
      } catch {
        if (alive) setSchemaReady(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const handleIssueSelection = useCallback((selection: PublicIssueSelection) => {
    setIssueSelection(selection);
  }, []);

  const resolveRepository = useCallback(
    async (options?: { branch?: string; fromUrl?: string; reset?: boolean }) => {
      const targetUrl = options?.fromUrl ?? url;
      if (!targetUrl.trim()) {
        setError('Paste a public GitHub repository URL.');
        setErrorCode('invalid_url');
        return;
      }

      setResolving(true);
      setError(null);
      setErrorCode(null);
      try {
        const response = await fetch('/api/public/repositories/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: targetUrl,
            branch: options?.branch,
          }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          setResolved(null);
          setError(data?.error || `Could not inspect the repository (${response.status}).`);
          setErrorCode(data?.code || null);
          return;
        }
        const next = data as ResolveResponse;
        setResolved(next);
        setBranch(next.branch);
        if (options?.reset) {
          setIssueSelection({ issueNumber: null, issueUrl: '' });
          setTitle('');
          setDescription('');
        }
        // Inspecting a repository may have created a guest session. Refresh the
        // shell so it shows "Guest Session" instead of a stale signed-out state.
        invalidateAuthCache();
        window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
      } catch {
        setResolved(null);
        setError('Could not reach the server. Check your connection and try again.');
        setErrorCode('network');
      } finally {
        setResolving(false);
      }
    },
    [url]
  );

  const handleBranchChange = (nextBranch: string) => {
    setBranch(nextBranch);
    if (!resolved) return;
    if (nextBranch === resolved.branch) return;
    // Re-pin: the analysis must read exactly the commit shown on screen.
    void resolveRepository({ branch: nextBranch });
  };

  const handleIssueModeChange = (mode: IssueMode) => {
    setIssueMode(mode);
    // Each mode has its own input; carrying a hidden selection across modes
    // would let a stale issue or description start the analysis.
    setIssueSelection({ issueNumber: null, issueUrl: '' });
    setError(null);
    setErrorCode(null);
  };

  const issueValid =
    issueMode === 'github'
      ? Boolean(issueSelection.issueNumber) || issueSelection.issueUrl.trim().length > 0
      : description.trim().length >= MIN_DESCRIPTION;

  const handleStart = async () => {
    if (!resolved || creating) return;
    if (!issueValid) {
      setError(
        issueMode === 'github'
          ? 'Select an issue from the list, or paste its URL.'
          : `Describe the issue in at least ${MIN_DESCRIPTION} characters.`
      );
      return;
    }

    setCreating(true);
    setError(null);
    setErrorCode(null);
    const idempotencyKey = createSubmissionKey();

    try {
      const response = await fetch('/api/public/analyses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          repositoryUrl: resolved.repository.htmlUrl,
          branch,
          commit: resolved.commit.sha,
          idempotencyKey,
          ...(issueMode === 'github'
            ? issueSelection.issueUrl.trim()
              ? { issueUrl: issueSelection.issueUrl.trim() }
              : { issueNumber: issueSelection.issueNumber }
            : { description: description.trim(), title: title.trim() || undefined }),
        }),
      });

      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(data?.error || `Could not create the analysis (${response.status}).`);
        setErrorCode(data?.code || null);
        return;
      }

      const analysisId = data?.analysisId as string;
      if (!analysisId) {
        setError('The server did not return an analysis id.');
        return;
      }

      // A previous private selection must not leak into this investigation.
      localStorage.removeItem('analysis-selection');

      const runResponse = await fetch(`/api/analyses/${analysisId}/run`, { method: 'POST' });
      if (!runResponse.ok && runResponse.status !== 409) {
        const runData = await runResponse.json().catch(() => null);
        setError(runData?.error || `The analysis was created but could not start (${runResponse.status}).`);
        return;
      }

      toast.success('Investigation started');
      router.push(`/analysis/${analysisId}`);
    } catch {
      setError('Could not start the investigation. Check your connection and try again.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      {schemaReady === false && (
        <div className="rounded-lg border border-error-container/50 bg-error-container/20 p-4">
          <p className="text-sm font-semibold text-error-default">
            Public analyses need a database migration
          </p>
          <p className="mt-1 text-xs text-bw-peach leading-relaxed">
            {schemaMessage ||
              'Apply supabase/migrations/020_public_repository_workspaces.sql in the Supabase SQL editor, then reload this page.'}
          </p>
          <p className="mt-1 text-[11px] text-bw-peach">
            Inspecting a repository still works. Creating the analysis will fail until the
            migration has run.
          </p>
        </div>
      )}

      <div className="rounded-lg border border-border bg-surface p-4">
        <label htmlFor="public-repo-url" className="block text-xs font-mono font-bold uppercase tracking-wider text-bw-peach mb-2">
          Repository URL
        </label>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            id="public-repo-url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void resolveRepository({ reset: true });
            }}
            placeholder="https://github.com/owner/repo"
            spellCheck={false}
            autoComplete="off"
            className="font-mono text-xs"
          />
          <Button
            className="btn-bw-primary font-medium shrink-0"
            onClick={() => void resolveRepository({ reset: true })}
            disabled={resolving}
          >
            {resolving ? 'Inspecting…' : 'Inspect repository'}
          </Button>
        </div>
        <p className="mt-2 text-xs text-bw-peach">
          Public repositories only. No GitHub account or installation is required.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-error-container/50 bg-error-container/20 p-3">
          <p className="text-sm text-error-default">{error}</p>
          {errorCode === 'rate_limited' && (
            <p className="mt-1 text-xs text-bw-peach">
              GitHub limits anonymous reads. Wait for the window to reset, or configure a deployment read token.
            </p>
          )}
          {errorCode === 'requires_github_access' && (
            <p className="mt-1 text-xs text-bw-peach">
              Push and pull requests need a GitHub account with write access.
            </p>
          )}
          {errorCode === 'schema_missing' && (
            <p className="mt-1 text-xs text-bw-peach">
              Run supabase/migrations/020_public_repository_workspaces.sql in the Supabase
              SQL editor, then reload this page.
            </p>
          )}
        </div>
      )}

      {resolved && (
        <>
          <PublicRepositoryCard
            repository={resolved.repository}
            branch={branch}
            branches={resolved.branches}
            commit={resolved.commit}
            resolving={resolving}
            onBranchChange={handleBranchChange}
          />

          <div className="rounded-lg border border-border bg-surface p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-bw-peach">
                Issue
              </span>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant={issueMode === 'github' ? 'default' : 'ghost'}
                  onClick={() => handleIssueModeChange('github')}
                  className={issueMode === 'github' ? 'h-6 text-xs' : 'h-6 text-xs text-bw-peach'}
                >
                  GitHub issue
                </Button>
                <Button
                  size="sm"
                  variant={issueMode === 'description' ? 'default' : 'ghost'}
                  onClick={() => handleIssueModeChange('description')}
                  className={issueMode === 'description' ? 'h-6 text-xs' : 'h-6 text-xs text-bw-peach'}
                >
                  Describe it
                </Button>
              </div>
            </div>

            {issueMode === 'github' ? (
              <PublicIssuePicker
                key={resolved.repository.fullName}
                repositoryFullName={resolved.repository.fullName}
                onChange={handleIssueSelection}
              />
            ) : (
              <div className="space-y-2">
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Title (optional)"
                  className="text-xs"
                  aria-label="Issue title"
                />
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="What is broken? Include the observed behaviour, expected behaviour, and any reproduction steps."
                  rows={6}
                  className="w-full rounded-lg border border-border bg-surface-dim p-2 text-xs text-bw-peach-light outline-none focus-visible:border-primary-container"
                  aria-label="Issue description"
                />
                <p className="text-[11px] text-bw-peach">
                  {description.trim().length}/{MIN_DESCRIPTION} minimum characters
                </p>
              </div>
            )}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <Button
              className="btn-bw-primary font-medium"
              onClick={() => void handleStart()}
              disabled={creating || resolving || !issueValid || schemaReady === false}
            >
              {creating ? (
                <span className="flex items-center gap-2">
                  <span className="w-3 h-3 border-2 border-bw-peach-light/30 border-t-bw-peach-light rounded-full animate-spin" />
                  Starting…
                </span>
              ) : (
                'Start investigation'
              )}
            </Button>
            <p className="text-[11px] text-bw-peach">
              Patch changes stay in an isolated workspace. Nothing is pushed to GitHub.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
