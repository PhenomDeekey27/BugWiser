'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { UnifiedDiffView } from '@/components/code/UnifiedDiffView';
import { LocalTestPanel } from '@/components/analysis/LocalTestPanel';
import { toast } from 'sonner';
import type { ApplyFixError, ApplyFixResult, WorkspaceSummary } from '@/types';

interface WorkspacePanelProps {
  analysisId: string;
  repositoryFullName: string;
  repositorySource?: 'github' | 'installation' | 'public' | null;
  repositoryBranch?: string | null;
  repositoryCommit?: string | null;
  patchStatus?: 'none' | 'pending' | 'applied' | 'failed' | null;
  createdBranch?: string | null;
  commitSha?: string | null;
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
  onApplied,
}: WorkspacePanelProps) {
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [staging, setStaging] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pendingPush, setPendingPush] = useState<PushIntent | null>(null);
  const [pushed, setPushed] = useState<ApplyFixResult | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        const failure = data as ApplyFixError | null;
        setError(failure?.error || `Could not push the branch (${response.status}).`);
        return;
      }
      setPendingPush(null);
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

          {staged && !alreadyApplied && !isPublic && (
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
      </p>

      {pendingPush && (
        <div className="mt-3 rounded border border-primary-container/40 bg-surface-dim p-3 space-y-2">
          <p className="text-xs text-bw-peach-light leading-relaxed">
            {pendingPush === 'pull_request'
              ? 'Push the staged files to a new branch and open a pull request against '
              : 'Push the staged files to a new branch created from '}
            <span className="font-mono">{repositoryBranch || workspace?.baseCommit?.slice(0, 10)}</span>?
            {pendingPush === 'branch' && ' The default branch is never modified.'}
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
        </div>
      )}

      {staged && (
        <div className="mt-4 space-y-3">
          <div className="space-y-2">
            {files.map((file) => (
              <details key={file.path} className="rounded border border-border bg-surface-dim">
                <summary className="flex items-center justify-between gap-2 px-2 py-1.5 cursor-pointer">
                  <span className="font-mono text-[11px] text-bw-peach-light truncate">{file.path}</span>
                  <span className="font-mono text-[10px] whitespace-nowrap">
                    <span className="text-green-400">+{file.additions}</span>{' '}
                    <span className="text-red-400">-{file.deletions}</span>
                  </span>
                </summary>
                <div className="p-2 border-t border-border">
                  <UnifiedDiffView diff={file.diff} />
                </div>
              </details>
            ))}
          </div>

          <div className="rounded border border-border bg-surface-dim p-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-bw-peach">
                Verification
              </span>
              <Badge variant="outline" className="text-[10px] font-mono border-amber-500/50 text-amber-400">
                {verification?.status === 'not_run' || !verification ? 'not run' : verification.status}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-bw-peach leading-relaxed">
              {verification?.reason ||
                'No verification plan was generated for this repository, so no checks were executed.'}
            </p>
            {verification?.commands?.length ? (
              <ul className="mt-2 space-y-1">
                {verification.commands.map((command) => (
                  <li key={`${command.name}-${command.command}`} className="font-mono text-[11px] text-bw-peach-light">
                    <span className="text-bw-peach">{command.name}:</span> {command.command}
                  </li>
                ))}
              </ul>
            ) : null}
            {verification?.regressionTests?.length ? (
              <p className="mt-2 text-[11px] font-mono text-bw-peach">
                Regression tests: {verification.regressionTests.join(', ')}
              </p>
            ) : null}
            <p className="mt-2 text-[10px] text-bw-peach">
              A staged patch is not a verified fix. Only completed checks can be reported as passing.
            </p>
          </div>

          {pushed ? (
            <div className="rounded border border-green-500/30 bg-green-500/5 p-3">
              <p className="text-xs text-green-400">
                Pushed {pushed.filesChanged.length} file
                {pushed.filesChanged.length === 1 ? '' : 's'} to{' '}
                <span className="font-mono">{pushed.branch}</span>.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {pushed.htmlUrl && (
                  <a
                    href={pushed.htmlUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] font-mono text-primary-container hover:underline"
                  >
                    View branch →
                  </a>
                )}
                {pushed.pullRequestUrl && (
                  <a
                    href={pushed.pullRequestUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] font-mono text-primary-container hover:underline"
                  >
                    View pull request →
                  </a>
                )}
              </div>
            </div>
          ) : isPublic ? (
            <div className="rounded border border-border bg-surface-dim p-3">
              <p className="text-xs text-bw-peach leading-relaxed">
                This repository was imported without GitHub access, so the staged
                changes cannot be pushed automatically. Copy the patch or apply it
                in your own fork.
              </p>
            </div>
          ) : alreadyApplied ? (
            <div className="rounded border border-green-500/30 bg-green-500/5 p-3">
              <p className="text-xs text-green-400">
                This patch has already been pushed to a branch on GitHub.
              </p>
            </div>
          ) : null}
        </div>
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
