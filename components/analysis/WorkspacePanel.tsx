'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LocalTestPanel } from '@/components/analysis/LocalTestPanel';
import { FixWorkflowPanel } from '@/components/analysis/FixWorkflowPanel';
import { WorkspaceReview } from '@/components/analysis/WorkspaceReview';
import { toast } from 'sonner';
import type { ApplyFixError, ApplyFixResult, FixStatus, WorkspaceSummary } from '@/types';

interface WorkspacePanelProps {
  analysisId: string;
  repositoryFullName: string;
  repositorySource?: 'github' | 'installation' | 'public' | null;
  repositoryBranch?: string | null;
  repositoryCommit?: string | null;
  patchStatus?: 'none' | 'pending' | 'applied' | 'failed' | null;
  createdBranch?: string | null;
  commitSha?: string | null;
  fixStatus?: FixStatus | null;
  fixError?: string | null;
  fixTargetRepository?: string | null;
  fixBaseBranch?: string | null;
  fixUsedFork?: boolean | null;
  pullRequestUrl?: string | null;
  pullRequestNumber?: number | null;
  onApplied?: (result: ApplyFixResult) => void;
}

/** Which GitHub action the confirmation panel is currently asking about. */
type PushIntent = 'branch' | 'pull_request';

interface StageResponse {
  ok: boolean;
  baseCommit?: string;
  workspace?: WorkspaceSummary;
  error?: string;
  code?: string;
}

export function WorkspacePanel({
  analysisId,
  repositoryFullName,
  repositorySource,
  repositoryBranch,
  repositoryCommit,
  patchStatus,
  createdBranch,
  commitSha,
  fixStatus,
  fixError,
  fixTargetRepository,
  fixBaseBranch,
  fixUsedFork,
  pullRequestUrl,
  pullRequestNumber,
  onApplied,
}: WorkspacePanelProps) {
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [staging, setStaging] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pendingPush, setPendingPush] = useState<PushIntent | null>(null);
  const [pushed, setPushed] = useState<ApplyFixResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  // The server persists the failed stage; mirror it locally so the workflow
  // panel updates without waiting for a record refresh.
  const [localFix, setLocalFix] = useState<{ status: FixStatus; error: string } | null>(null);

  const isPublic = repositorySource === 'public';
  const alreadyApplied = patchStatus === 'applied';

  const loadWorkspace = useCallback(async () => {
    try {
      const response = await fetch(`/api/analyses/${analysisId}/workspace`, {
        cache: 'no-store',
      });
      if (!response.ok) return;
      const data = await response.json();
      setWorkspace(data.workspace || null);
    } catch {
      // The workspace is optional UI state; a failed read must not block the patch.
    } finally {
      setLoading(false);
    }
  }, [analysisId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const response = await fetch(`/api/analyses/${analysisId}/workspace`, {
          cache: 'no-store',
        });
        if (!response.ok) return;
        const data = await response.json();
        if (alive) setWorkspace(data.workspace || null);
      } catch {
        // The workspace is optional UI state; a failed read must not block the patch.
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [analysisId]);

  const handleStage = async () => {
    setStaging(true);
    setError(null);
    try {
      const response = await fetch(`/api/analyses/${analysisId}/workspace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      });
      const data = (await response.json().catch(() => null)) as StageResponse | null;
      if (!response.ok) {
        setError(data?.error || `Could not stage the patch (${response.status}).`);
        return;
      }
      await loadWorkspace();
      toast.success('Patch staged in the isolated workspace');
    } catch {
      setError('Could not stage the patch. Check your connection and try again.');
    } finally {
      setStaging(false);
    }
  };

  const handleDiscard = async () => {
    setError(null);
    try {
      const response = await fetch(`/api/analyses/${analysisId}/workspace`, {
        method: 'DELETE',
      });
      if (!response.ok && response.status !== 404) {
        setError(`Could not discard the workspace (${response.status}).`);
        return;
      }
      setPendingPush(null);
      await loadWorkspace();
      toast.success('Workspace discarded');
    } catch {
      setError('Could not discard the workspace.');
    }
  };

  const handlePush = async (intent: PushIntent) => {
    setPushing(true);
    setError(null);
    try {
      const response = await fetch(`/api/analyses/${analysisId}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirm: true,
          push: true,
          createPullRequest: intent === 'pull_request',
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        // A pull-request failure answers 502 while the branch and commit are
        // real; show the pushed branch and the exact failed step.
        const partial = data as ApplyFixResult | null;
        if (partial?.success === true && partial.branch) {
          setPendingPush(null);
          setPushed(partial);
          setError(partial.pullRequestError || 'The branch was pushed, but the pull request failed.');
          onApplied?.(partial);
          return;
        }
        const failure = data as (ApplyFixError & { loginUrl?: string }) | null;
        if (failure?.loginUrl) setAuthUrl(failure.loginUrl);
        setError(failure?.error || `Could not push the branch (${response.status}).`);
        setLocalFix({
          status: failure?.stage || 'failed',
          error: failure?.error || 'The GitHub write failed.',
        });
        return;
      }
      setPendingPush(null);
      setAuthUrl(null);
      setLocalFix(null);
      setPushed(data as ApplyFixResult);
      toast.success(
        intent === 'pull_request' ? 'Branch pushed and pull request opened' : 'Branch pushed to GitHub'
      );
      onApplied?.(data as ApplyFixResult);
    } catch {
      setError('Could not push the branch. Check your connection and try again.');
    } finally {
      setPushing(false);
    }
  };

  const files = workspace?.files || [];
  const staged = workspace?.status === 'staged' && files.length > 0;
  const verification = workspace?.verification;

  return (
    <div className="rounded-lg border border-border bg-surface p-4 mb-4 card-depth">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-bw-peach-light">Apply Fix</h3>
          <Badge
            variant="outline"
            className={`text-[10px] font-mono ${
              staged ? 'border-green-500/50 text-green-400' : 'border-border text-bw-peach'
            }`}
          >
            {loading ? 'loading' : staged ? 'applied in workspace' : 'not applied'}
          </Badge>
          {workspace?.baseCommit && (
            <span className="text-[10px] font-mono text-bw-peach" title={workspace.baseCommit}>
              @{workspace.baseCommit.slice(0, 10)}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {staged && !alreadyApplied && (
            <Button
              size="sm"
              variant="outline"
              className="border-border text-bw-peach"
              onClick={() => void handleDiscard()}
              disabled={pushing || staging}
            >
              Discard
            </Button>
          )}
          <Button
            size="sm"
            variant={staged ? 'outline' : 'default'}
            className={staged ? 'border-border text-bw-peach' : 'btn-bw-primary font-medium'}
            onClick={() => void handleStage()}
            disabled={staging || pushing || alreadyApplied}
          >
            {staging ? 'Applying…' : staged ? 'Re-apply fix' : 'Apply Fix'}
          </Button>

          {staged && !alreadyApplied && (
            <>
              <Button
                size="sm"
                variant="outline"
                className="border-border text-bw-peach"
                onClick={() => setPendingPush('branch')}
                disabled={pushing || staging}
              >
                Push branch
              </Button>
              <Button
                size="sm"
                className="btn-bw-primary font-medium"
                onClick={() => setPendingPush('pull_request')}
                disabled={pushing || staging}
              >
                Raise PR
              </Button>
            </>
          )}
        </div>
      </div>

      <p className="mt-2 text-xs text-bw-peach leading-relaxed">
        Apply Fix writes the patch into an isolated workspace pinned to the commit above.
        GitHub is not modified until you push a branch or raise a pull request.
        {isPublic &&
          ' This repository was imported without GitHub access — sign-in is only needed when you push.'}
      </p>

      {pendingPush && (
        <div className="mt-3 rounded border border-primary-container/40 bg-surface-dim p-3 space-y-2">
          <p className="text-xs text-bw-peach-light leading-relaxed">
            {pendingPush === 'pull_request'
              ? `Push the staged files to a fix branch and open a pull request against ${repositoryFullName} at `
              : 'Push the staged files to a fix branch created from '}
            <span className="font-mono">{repositoryBranch || workspace?.baseCommit?.slice(0, 10)}</span>?
            {pendingPush === 'branch' && ' The default branch is never modified.'}
            {isPublic && ' If your account cannot write to this repository, the branch goes to your fork.'}
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="btn-bw-primary font-medium"
              onClick={() => void handlePush(pendingPush)}
              disabled={pushing}
            >
              {pushing
                ? pendingPush === 'pull_request'
                  ? 'Raising PR…'
                  : 'Pushing…'
                : pendingPush === 'pull_request'
                  ? 'Confirm & raise PR'
                  : 'Confirm push'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-border text-bw-peach"
              onClick={() => setPendingPush(null)}
              disabled={pushing}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-3 rounded border border-error-container/50 bg-error-container/20 p-2">
          <p className="text-xs text-error-default">{error}</p>
          {authUrl && (
            <a href={authUrl} className="mt-2 inline-flex">
              <Button size="sm" className="btn-bw-primary font-medium">
                Authorize with GitHub →
              </Button>
            </a>
          )}
        </div>
      )}

      <FixWorkflowPanel
        fixStatus={pushed?.fixStatus ?? localFix?.status ?? fixStatus}
        fixError={localFix?.error ?? fixError}
        branch={pushed?.branch ?? createdBranch}
        commitSha={pushed?.commitSha ?? commitSha}
        pullRequestUrl={pushed?.pullRequestUrl ?? pullRequestUrl}
        pullRequestNumber={pushed?.pullRequestNumber ?? pullRequestNumber}
        targetRepository={pushed?.repositoryFullName ?? fixTargetRepository}
        baseBranch={pushed?.defaultBranch ?? fixBaseBranch}
        usedFork={pushed?.usedFork ?? fixUsedFork}
        loginUrl={
          authUrl ??
          `/api/auth/github/start?returnTo=${encodeURIComponent(`/analysis/${analysisId}`)}&force=1`
        }
        retrying={pushing}
        onRetryPullRequest={() => void handlePush('pull_request')}
        onRetry={() => void handlePush('branch')}
      />

      {staged && (
        <WorkspaceReview
          files={files}
          verification={verification}
          pushed={pushed}
          alreadyApplied={alreadyApplied}
        />
      )}

      {(staged || alreadyApplied) && (
        <div className="mt-3">
          <LocalTestPanel
            repositoryFullName={repositoryFullName}
            baseBranch={repositoryBranch ?? null}
            baseCommit={workspace?.baseCommit ?? repositoryCommit ?? null}
            fixBranch={createdBranch ?? null}
            fixCommit={commitSha ?? null}
            stagedFiles={staged ? files.map((file) => ({ path: file.path, diff: file.diff })) : null}
            verification={verification ? { commands: verification.commands } : null}
          />
        </div>
      )}
    </div>
  );
}
