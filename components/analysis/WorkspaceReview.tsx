'use client';

import { Badge } from '@/components/ui/badge';
import { UnifiedDiffView } from '@/components/code/UnifiedDiffView';
import type { ApplyFixResult, VerificationPlanRecord, WorkspaceFileRecord } from '@/types';

interface WorkspaceReviewProps {
  files: WorkspaceFileRecord[];
  verification?: VerificationPlanRecord | null;
  pushed: ApplyFixResult | null;
  alreadyApplied: boolean;
}

/**
 * Read-only review of the staged workspace: the exact diff that will be pushed,
 * the verification plan (never claimed as run), and the resulting push state.
 */
export function WorkspaceReview({
  files,
  verification,
  pushed,
  alreadyApplied,
}: WorkspaceReviewProps) {
  return (
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
          <Badge
            variant="outline"
            className="text-[10px] font-mono border-amber-500/50 text-amber-400"
          >
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
              <li
                key={`${command.name}-${command.command}`}
                className="font-mono text-[11px] text-bw-peach-light"
              >
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
      ) : alreadyApplied ? (
        <div className="rounded border border-green-500/30 bg-green-500/5 p-3">
          <p className="text-xs text-green-400">
            This patch has already been pushed to a branch on GitHub.
          </p>
        </div>
      ) : null}
    </div>
  );
}
