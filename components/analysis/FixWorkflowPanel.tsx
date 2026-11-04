'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { fixStageLabel, isBranchPushed } from '@/lib/analysis/fix-branch';
import type { FixStatus } from '@/types';

export interface FixWorkflowPanelProps {
  fixStatus?: FixStatus | null;
  fixError?: string | null;
  branch?: string | null;
  commitSha?: string | null;
  pullRequestUrl?: string | null;
  pullRequestNumber?: number | null;
  targetRepository?: string | null;
  baseBranch?: string | null;
  usedFork?: boolean | null;
  /** GitHub authorization URL when the workflow needs (re)authentication. */
  loginUrl: string;
  retrying?: boolean;
  onRetryPullRequest?: () => void;
  onRetry?: () => void;
}

const ORDER: FixStatus[] = [
  'none',
  'awaiting_authorization',
  'branch_creating',
  'branch_created',
  'committing',
  'committed',
  'pushing',
  'pushed',
  'creating_pr',
  'pr_created',
];

function atLeast(current: FixStatus | null | undefined, threshold: FixStatus): boolean {
  const currentIndex = ORDER.indexOf(current ?? 'none');
  return currentIndex >= ORDER.indexOf(threshold);
}

function Step({
  label,
  state,
}: {
  label: string;
  state: 'done' | 'running' | 'failed' | 'pending';
}) {
  const mark = state === 'done' ? '✓' : state === 'failed' ? '!' : state === 'running' ? '·' : '○';
  const color =
    state === 'done'
      ? 'text-green-400'
      : state === 'failed'
        ? 'text-error-default'
        : state === 'running'
          ? 'text-primary-container'
          : 'text-bw-peach/50';
  return (
    <li className={`flex items-center gap-2 font-mono text-[11px] ${color}`}>
      <span aria-hidden="true" className="w-3 text-center">
        {mark}
      </span>
      <span>{label}</span>
      {state === 'running' && <span className="animate-pulse">…</span>}
    </li>
  );
}

/**
 * The persisted state of the approved-patch → branch → push → pull request
 * workflow. Presentational only: the server owns every transition, so a refresh
 * renders the same stages the server recorded.
 */
export function FixWorkflowPanel({
  fixStatus,
  fixError,
  branch,
  commitSha,
  pullRequestUrl,
  pullRequestNumber,
  targetRepository,
  baseBranch,
  usedFork,
  loginUrl,
  retrying = false,
  onRetryPullRequest,
  onRetry,
}: FixWorkflowPanelProps) {
  const status = fixStatus ?? 'none';
  const failed = status === 'failed';
  const prFailed = status === 'pr_failed';
  const prCreated = status === 'pr_created';
  const pushed = isBranchPushed(status);
  const needsAuthorization = status === 'awaiting_authorization';

  // Nothing has been attempted yet and there is no error: the workflow panel is
  // not useful until the user starts it.
  if (status === 'none' && !fixError) return null;

  return (
    <div className="mt-3 rounded border border-border bg-surface-dim p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-bw-peach">
            Fix workflow
          </span>
          <Badge
            variant="outline"
            className={`text-[10px] font-mono ${
              prCreated
                ? 'border-green-500/50 text-green-400'
                : failed || prFailed
                  ? 'border-error-container/60 text-error-default'
                  : needsAuthorization
                    ? 'border-amber-500/50 text-amber-400'
                    : 'border-primary-container/50 text-primary-container'
            }`}
          >
            {fixStageLabel(status)}
          </Badge>
          {usedFork && (
            <Badge variant="outline" className="text-[10px] font-mono border-border text-bw-peach">
              via fork
            </Badge>
          )}
        </div>
        {targetRepository && (
          <span className="text-[10px] font-mono text-bw-peach">
            {targetRepository}
            {baseBranch ? ` @ ${baseBranch}` : ''}
          </span>
        )}
      </div>

      <ol className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
        <Step
          label="Branch"
          state={
            atLeast(status, 'branch_created')
              ? 'done'
              : status === 'branch_creating'
                ? 'running'
                : failed
                  ? 'failed'
                  : 'pending'
          }
        />
        <Step
          label="Commit"
          state={
            atLeast(status, 'committed')
              ? 'done'
              : status === 'committing'
                ? 'running'
                : failed
                  ? 'failed'
                  : 'pending'
          }
        />
        <Step
          label="Push"
          state={
            pushed
              ? 'done'
              : status === 'pushing'
                ? 'running'
                : failed
                  ? 'failed'
                  : 'pending'
          }
        />
        <Step
          label="Pull request"
          state={
            prCreated
              ? 'done'
              : status === 'creating_pr'
                ? 'running'
                : prFailed
                  ? 'failed'
                  : 'pending'
          }
        />
      </ol>

      {(branch || commitSha) && (
        <div className="mt-2 flex flex-wrap items-center gap-3 font-mono text-[11px]">
          {branch && (
            <span className="text-bw-peach">
              branch <span className="text-primary-container">{branch}</span>
            </span>
          )}
          {commitSha && <span className="text-bw-peach">commit {commitSha.slice(0, 7)}</span>}
        </div>
      )}

      {(needsAuthorization || (!pushed && fixError && status === 'failed')) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <a href={loginUrl} className="inline-flex">
            <Button size="sm" className="btn-bw-primary font-medium">
              Authorize with GitHub →
            </Button>
          </a>
          <span className="text-[11px] text-bw-peach">
            Your analysis and staged patch stay exactly as they are.
          </span>
        </div>
      )}

      {fixError && (
        <div className="mt-2 rounded border border-error-container/50 bg-error-container/20 p-2">
          <p className="text-xs text-error-default">{fixError}</p>
          {prFailed && (
            <p className="mt-1 text-[11px] text-bw-peach">
              The branch and commit were pushed. Only the pull request failed, so retrying does not
              push anything again.
            </p>
          )}
          {prFailed && onRetryPullRequest && (
            <Button
              size="sm"
              variant="outline"
              className="mt-2 border-border text-bw-peach"
              onClick={onRetryPullRequest}
              disabled={retrying}
            >
              {retrying ? 'Creating Pull Request…' : 'Retry pull request'}
            </Button>
          )}
          {failed && onRetry && (
            <Button
              size="sm"
              variant="outline"
              className="mt-2 border-border text-bw-peach"
              onClick={onRetry}
              disabled={retrying}
            >
              {retrying ? 'Retrying…' : 'Retry'}
            </Button>
          )}
        </div>
      )}

      {prCreated && pullRequestUrl && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <a
            href={pullRequestUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] font-mono text-primary-container hover:underline"
          >
            View pull request{pullRequestNumber ? ` #${pullRequestNumber}` : ''} →
          </a>
          <span className="text-[11px] text-green-400">Pull request created on GitHub.</span>
        </div>
      )}

      {pushed && !prCreated && !prFailed && (
        <p className="mt-2 text-[11px] text-bw-peach">
          The branch is on GitHub. Raise a pull request when you are ready; the branch is not
          recreated.
        </p>
      )}
    </div>
  );
}
