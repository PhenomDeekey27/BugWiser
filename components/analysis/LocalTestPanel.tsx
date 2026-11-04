'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CommandBlock } from '@/components/analysis/CloneTargetCard';
import { toast } from 'sonner';
import {
  buildLocalTestPlan,
  type LocalTestStagedFile,
  type LocalTestVerificationCommand,
} from '@/lib/analysis/local-test';

interface LocalTestPanelProps {
  repositoryFullName: string;
  baseBranch?: string | null;
  baseCommit?: string | null;
  fixBranch?: string | null;
  fixCommit?: string | null;
  stagedFiles?: LocalTestStagedFile[] | null;
  verification?: { commands?: LocalTestVerificationCommand[] | null } | null;
}

/**
 * Everything needed to reproduce the fix on the developer's machine: clone the
 * recorded snapshot, apply the proposed patch (or check out the pushed commit),
 * then run the repository's own checks. Nothing here executes anything.
 */
export function LocalTestPanel({
  repositoryFullName,
  baseBranch,
  baseCommit,
  fixBranch,
  fixCommit,
  stagedFiles,
  verification,
}: LocalTestPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [copiedPatch, setCopiedPatch] = useState(false);

  const plan = useMemo(
    () =>
      buildLocalTestPlan({
        repositoryFullName,
        baseBranch,
        baseCommit,
        fix: fixBranch ? { branch: fixBranch, commitSha: fixCommit ?? null } : null,
        stagedFiles,
        verification,
      }),
    [repositoryFullName, baseBranch, baseCommit, fixBranch, fixCommit, stagedFiles, verification]
  );

  const patchFile = plan.available ? plan.patchFile : null;

  const handleDownload = () => {
    if (!patchFile) return;
    try {
      const blob = new Blob([patchFile.content], { type: 'text/x-patch' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = patchFile.name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success(`${patchFile.name} downloaded`);
    } catch {
      toast.error('Could not build the patch file');
    }
  };

  const handleCopyPatch = async () => {
    if (!patchFile) return;
    try {
      await navigator.clipboard.writeText(patchFile.content);
      setCopiedPatch(true);
      toast.success('Patch copied to clipboard');
      window.setTimeout(() => setCopiedPatch(false), 2000);
    } catch {
      toast.error('Could not copy the patch to the clipboard');
    }
  };

  return (
    <div className="rounded-lg border border-border bg-surface-dim p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h4 className="text-xs font-semibold text-bw-peach-light">Test the fix locally</h4>
          {plan.available && (
            <Badge variant="outline" className="text-[10px] font-mono border-border text-bw-peach">
              {plan.mode === 'branch' ? 'checks out the fix commit' : 'applies the patch'}
            </Badge>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-xs border-border text-bw-peach hover:text-bw-peach-light"
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? 'Hide instructions' : 'Show instructions'}
        </Button>
      </div>

      {!plan.available ? (
        <p className="mt-2 text-[11px] text-bw-peach leading-relaxed">{plan.reason}</p>
      ) : expanded ? (
        <div className="mt-3 space-y-3">
          <p className="text-[11px] text-bw-peach leading-relaxed">
            {plan.mode === 'branch'
              ? 'Clone the repository and check out the pushed fix, then run the project\'s checks.'
              : 'Clone the exact snapshot this patch was generated from, apply the patch, then run the project\'s checks.'}
          </p>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-mono text-bw-peach">
            <span>
              repo: <span className="text-bw-peach-light">{plan.repositoryFullName}</span>
            </span>
            <span>
              base: <span className="text-bw-peach-light">{plan.baseBranch || 'default'}</span>
            </span>
            <span title={plan.baseCommit || ''}>
              commit: <span className="text-bw-peach-light">{plan.baseCommit?.slice(0, 10) || 'not pinned'}</span>
            </span>
            {plan.fixBranch && (
              <span>
                fix: <span className="text-bw-peach-light">{plan.fixBranch}</span>
              </span>
            )}
          </div>

          {patchFile && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-xs border-border text-bw-peach hover:text-bw-peach-light"
                onClick={handleDownload}
              >
                Download {patchFile.name} ({patchFile.fileCount} file
                {patchFile.fileCount === 1 ? '' : 's'})
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-xs border-border text-bw-peach hover:text-bw-peach-light"
                onClick={() => void handleCopyPatch()}
              >
                {copiedPatch ? 'Copied' : 'Copy patch'}
              </Button>
            </div>
          )}

          <CommandBlock label="1 · Clone and prepare" commands={plan.cloneCommands} />

          <CommandBlock
            label={plan.mode === 'branch' ? '2 · Check out the fix' : '2 · Apply the patch'}
            commands={plan.applyCommands}
          />

          {plan.testCommands.length > 0 ? (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-bw-peach">
                  3 · Run the checks
                </span>
              </div>
              <ul className="space-y-1">
                {plan.testCommands.map((command) => (
                  <li
                    key={`${command.name}-${command.command}`}
                    className="font-mono text-[11px] text-bw-peach-light"
                  >
                    <span className="text-bw-peach">{command.name}:</span> {command.command}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[10px] text-bw-peach">
                These checks were planned for this repository but were not executed by BugWiser.
              </p>
            </div>
          ) : null}

          <ul className="space-y-1">
            {plan.notes.map((note) => (
              <li key={note} className="text-[11px] text-bw-peach leading-relaxed">
                · {note}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-bw-peach leading-relaxed">
          Reproduce this fix on your machine before pushing it. Commands only — nothing runs from
          this page.
        </p>
      )}
    </div>
  );
}
