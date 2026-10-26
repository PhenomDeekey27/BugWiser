'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import type { CloneTarget } from '@/lib/analysis/clone-instructions';

function shortSha(sha: string | null): string {
  return sha ? sha.slice(0, 10) : 'unknown';
}

/** One copyable command block. Used for clones and for local comparisons. */
export function CommandBlock({ label, commands }: { label: string; commands: string[] }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(commands.join('\n'));
      setCopied(true);
      toast.success(`${label} copied to clipboard`);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy to the clipboard');
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-bw-peach">
          {label}
        </span>
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-xs border-border text-bw-peach hover:text-bw-peach-light"
          onClick={() => void handleCopy()}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre className="font-mono text-[11px] leading-relaxed text-bw-peach-light bg-surface-code border border-border rounded p-2 overflow-x-auto whitespace-pre">
        {commands.join('\n')}
      </pre>
    </div>
  );
}

interface CloneTargetCardProps {
  target: CloneTarget;
  isPrivate: boolean;
  isFork?: boolean;
}

/** Repository, branch and commit details for one clone target. */
export function CloneTargetCard({ target, isPrivate, isFork }: CloneTargetCardProps) {
  const commitUrl = target.commit
    ? `https://github.com/${target.repositoryFullName}/commit/${target.commit}`
    : null;

  return (
    <div className="rounded-lg border border-border bg-surface-dim p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant="outline"
          className={`text-[10px] font-mono ${
            target.kind === 'original'
              ? 'border-border text-bw-peach'
              : 'border-green-500/50 text-green-400'
          }`}
        >
          {target.kind === 'original' ? 'original' : 'fixed'}
        </Badge>
        <span className="font-mono text-xs text-bw-peach-light">{target.repositoryFullName}</span>
        {isFork && (
          <Badge
            variant="outline"
            className="text-[10px] font-mono border-amber-500/50 text-amber-400"
          >
            fork
          </Badge>
        )}
        {isPrivate && (
          <Badge variant="outline" className="text-[10px] font-mono border-border text-bw-peach">
            private
          </Badge>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-mono text-bw-peach">
        <span>
          branch: <span className="text-bw-peach-light">{target.branch || 'not recorded'}</span>
        </span>
        <span>
          commit:{' '}
          {commitUrl ? (
            <a
              href={commitUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary-container hover:underline"
              title={target.commit || ''}
            >
              {shortSha(target.commit)}
            </a>
          ) : (
            <span className="text-amber-400">not pinned</span>
          )}
        </span>
      </div>

      <CommandBlock label={`Clone ${target.kind}`} commands={target.commands} />

      {target.archiveUrl && (
        <a
          href={target.archiveUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-block text-[11px] font-mono text-primary-container hover:underline"
        >
          Download source archive (tar.gz) →
        </a>
      )}
    </div>
  );
}
