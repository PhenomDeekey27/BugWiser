'use client';

import { useState } from 'react';
import { Patch, PatchFile, ApplyFixResult } from '@/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DiffViewer } from '@/components/code/DiffViewer';
import { ApplyFixModal } from '@/components/analysis/ApplyFixModal';
import { ApplyFixSuccess } from '@/components/analysis/ApplyFixSuccess';
import { toast } from 'sonner';

interface PatchViewerProps {
  patch: Patch;
  analysisId: string;
  repositoryFullName: string;
  issueNumber: number;
  patchStatus?: 'none' | 'pending' | 'applied' | 'failed' | null;
  createdBranch?: string | null;
  commitSha?: string | null;
  changedFiles?: string[] | null;
}

function formatPatchAsDiff(patch: Patch): string {
  const lines: string[] = [];
  lines.push(`# Patch Summary: ${patch.summary}`);
  lines.push('');

  for (const file of patch.files) {
    lines.push(`--- a/${file.path}`);
    lines.push(`+++ b/${file.path}`);
    lines.push(
      `@@ -0,0 +1,${file.hunks.reduce((acc: number, h) => acc + h.lines.length, 0)} @@`
    );

    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.type === 'added') {
          lines.push(`+${line.content}`);
        } else if (line.type === 'removed') {
          lines.push(`-${line.content}`);
        } else {
          lines.push(` ${line.content}`);
        }
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

function inferOperation(file: PatchFile): string {
  const allAdded = file.hunks.every((h) =>
    h.lines.every((l) => l.type === 'added')
  );
  const allRemoved = file.hunks.every((h) =>
    h.lines.every((l) => l.type === 'removed')
  );
  if (allAdded) return 'create';
  if (allRemoved) return 'delete';
  return 'modify';
}

function getRemovedCode(file: PatchFile): string {
  const result: string[] = [];
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'removed') {
        result.push(line.content);
      }
    }
  }
  return result.join('\n');
}

function getAddedCode(file: PatchFile): string {
  const result: string[] = [];
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'added') {
        result.push(line.content);
      }
    }
  }
  return result.join('\n');
}

function FileCard({ file, patchSummary }: { file: PatchFile; patchSummary: string }) {
  const operation = inferOperation(file);
  const reason = `Part of: ${patchSummary}`;
  const removedCode = getRemovedCode(file);
  const addedCode = getAddedCode(file);

  return (
    <div className="rounded-lg border border-border bg-surface-code overflow-hidden card-depth">
      <div className="px-3 py-2 border-b border-border bg-surface">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-bw-peach-light">{file.path}</span>
            <Badge
              variant="outline"
              className={`text-[10px] font-mono ${
                operation === 'create'
                  ? 'border-green-500/50 text-green-400'
                  : operation === 'delete'
                    ? 'border-red-500/50 text-red-400'
                    : 'border-primary-container/50 text-primary-container'
              }`}
            >
              {operation}
            </Badge>
          </div>
          <div className="flex items-center gap-2 text-xs font-mono">
            <span className="text-green-400">
              +{file.additions}
            </span>
            <span className="text-red-400">
              -{file.deletions}
            </span>
          </div>
        </div>
      </div>

      <div className="px-3 py-2 border-b border-border">
        <p className="text-xs text-bw-peach">{reason}</p>
      </div>

      <DiffViewer hunks={file.hunks} />

      {(removedCode || addedCode) && (
        <div className="px-3 py-2 border-t border-border">
          <div className="grid grid-cols-2 gap-2">
            {removedCode && (
              <div>
                <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-red-400 mb-1">
                  Before
                </p>
                <pre className="text-[11px] font-mono text-bw-peach bg-red-500/5 p-2 rounded overflow-x-auto max-h-32 overflow-y-auto border border-red-500/20">
                  {removedCode}
                </pre>
              </div>
            )}
            {addedCode && (
              <div>
                <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-green-400 mb-1">
                  After
                </p>
                <pre className="text-[11px] font-mono text-bw-peach bg-green-500/5 p-2 rounded overflow-x-auto max-h-32 overflow-y-auto border border-green-500/20">
                  {addedCode}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function PatchViewer({
  patch,
  analysisId,
  repositoryFullName,
  issueNumber,
  patchStatus,
  createdBranch,
  commitSha,
  changedFiles,
}: PatchViewerProps) {
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [applyResult, setApplyResult] = useState<ApplyFixResult | null>(null);

  const handleCopy = async () => {
    try {
      const diff = formatPatchAsDiff(patch);
      await navigator.clipboard.writeText(diff);
      toast.success('Patch copied to clipboard');
    } catch {
      toast.error('Failed to copy patch');
    }
  };

  const handleApplySuccess = (result: ApplyFixResult) => {
    setApplyResult(result);
    setShowApplyModal(false);
  };

  if (patchStatus === 'applied' && createdBranch) {
    return (
      <ApplyFixSuccess
        branch={createdBranch}
        commitSha={commitSha || ''}
        repositoryFullName={repositoryFullName}
        filesChanged={changedFiles || []}
        commitMessage={`fix: resolve issue #${issueNumber}`}
      />
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-bw-peach-light">
            Proposed Patch
          </h2>
          <Badge variant="outline" className="text-xs font-mono">
            {patch.files.length} file{patch.files.length !== 1 ? 's' : ''}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="border-border text-bw-peach hover:text-bw-peach-light"
            onClick={handleCopy}
          >
            Copy Patch
          </Button>
          <Button
            size="sm"
            className="btn-bw-primary font-medium"
            onClick={() => setShowApplyModal(true)}
            disabled={patchStatus === 'pending'}
          >
            {patchStatus === 'pending' ? (
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 border-2 border-bw-peach-light/30 border-t-bw-peach-light rounded-full animate-spin" />
                Applying...
              </span>
            ) : (
              'Apply Fix to New Branch'
            )}
          </Button>
        </div>
      </div>

      <div className="p-4 rounded-lg bg-surface border border-border mb-4 card-depth">
        <p className="text-xs font-mono font-bold uppercase tracking-wider text-bw-peach mb-1">
          Summary
        </p>
        <p className="text-sm text-bw-peach-light leading-relaxed">
          {patch.summary}
        </p>
      </div>

      <div className="p-3 rounded-lg bg-green-500/5 border border-green-500/30 mb-4">
        <p className="text-xs text-green-400 leading-relaxed">
          Your default branch will not be modified. A new fix branch will be
          created from the latest commit.
        </p>
      </div>

      <div className="space-y-4">
        {patch.files.map((file, fileIdx) => (
          <FileCard key={`${fileIdx}-${file.path}`} file={file} patchSummary={patch.summary} />
        ))}
      </div>

      {showApplyModal && (
        <ApplyFixModal
          analysisId={analysisId}
          repositoryFullName={repositoryFullName}
          issueNumber={issueNumber}
          patch={patch}
          onClose={() => setShowApplyModal(false)}
          onSuccess={handleApplySuccess}
        />
      )}

      {applyResult && !showApplyModal && (
        <ApplyFixSuccess
          branch={applyResult.branch}
          commitSha={applyResult.commitSha}
          repositoryFullName={applyResult.repositoryFullName}
          filesChanged={applyResult.filesChanged}
          commitMessage={applyResult.commitMessage}
          htmlUrl={applyResult.htmlUrl}
          pullRequestUrl={applyResult.pullRequestUrl}
        />
      )}
    </div>
  );
}
