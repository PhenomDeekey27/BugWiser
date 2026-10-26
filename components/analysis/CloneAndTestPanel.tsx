'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { UnifiedDiffView } from '@/components/code/UnifiedDiffView';
import { CloneTargetCard, CommandBlock } from '@/components/analysis/CloneTargetCard';
import type { ClonePlan, CompareFileRecord } from '@/lib/analysis/clone-instructions';

interface CloneAndTestPanelProps {
  analysisId: string;
}

interface CloneResponse {
  plan?: ClonePlan;
  error?: string;
  code?: string;
}

interface CompareResponse {
  compare?: {
    baseCommit: string;
    headCommit: string;
    status: string;
    aheadBy: number;
    behindBy: number;
    totalCommits: number;
    files: CompareFileRecord[];
    truncated: boolean;
    compareUrl: string;
  };
  error?: string;
  code?: string;
}

/**
 * Clone instructions for the pinned original and the fix branch, plus the
 * change comparison. Everything shown here comes from the analysis record and
 * live GitHub reads; nothing is written back to GitHub.
 */
export function CloneAndTestPanel({ analysisId }: CloneAndTestPanelProps) {
  const [plan, setPlan] = useState<ClonePlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [compareOpen, setCompareOpen] = useState(false);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareFiles, setCompareFiles] = useState<CompareFileRecord[] | null>(null);
  const [compareSummary, setCompareSummary] = useState<string | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const response = await fetch(`/api/analyses/${analysisId}/clone`, { cache: 'no-store' });
        const data = (await response.json().catch(() => null)) as CloneResponse | null;
        if (!alive) return;
        if (!response.ok || !data?.plan) {
          setPlan(null);
          setError(data?.error || `Could not build clone instructions (${response.status}).`);
          return;
        }
        setPlan(data.plan);
        setError(null);
      } catch {
        if (!alive) return;
        setPlan(null);
        setError('Could not build clone instructions. Check your connection and try again.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [analysisId, reloadToken]);

  const handleRetry = () => {
    setLoading(true);
    setReloadToken((token) => token + 1);
  };

  const handleCompare = async () => {
    if (compareOpen) {
      setCompareOpen(false);
      return;
    }
    setCompareOpen(true);
    if (!plan || compareFiles || compareLoading || !plan.compare.serverSide) return;

    setCompareLoading(true);
    setCompareError(null);
    try {
      const response = await fetch(`/api/analyses/${analysisId}/clone?diff=1`, {
        cache: 'no-store',
      });
      const data = (await response.json().catch(() => null)) as CompareResponse | null;
      if (!response.ok || !data?.compare) {
        setCompareError(data?.error || `Could not compare the commits (${response.status}).`);
        return;
      }
      setCompareFiles(data.compare.files);
      setCompareSummary(
        `${data.compare.aheadBy} commit${data.compare.aheadBy === 1 ? '' : 's'} ahead, ` +
          `${data.compare.behindBy} behind · ${data.compare.files.length} file${
            data.compare.files.length === 1 ? '' : 's'
          } changed`
      );
    } catch {
      setCompareError('Could not compare the commits. Check your connection and try again.');
    } finally {
      setCompareLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="mt-4 rounded-lg border border-border bg-surface p-4">
        <div className="flex items-center gap-2 text-xs text-bw-peach">
          <div className="w-3 h-3 border-2 border-primary-container/30 border-t-primary-container rounded-full animate-spin" />
          Building clone instructions…
        </div>
      </div>
    );
  }

  if (error || !plan) {
    return (
      <div className="mt-4 rounded-lg border border-error-container/50 bg-error-container/20 p-4">
        <p className="text-sm text-error-default">Clone &amp; Test unavailable</p>
        <p className="mt-1 text-xs text-bw-peach leading-relaxed">
          {error || 'No clone instructions could be generated for this analysis.'}
        </p>
        <Button
          size="sm"
          variant="outline"
          className="mt-3 h-7 text-xs border-border text-bw-peach"
          onClick={handleRetry}
        >
          Retry
        </Button>
      </div>
    );
  }

  const canCompare = plan.compare.serverSide || plan.compare.commands.length > 0;

  return (
    <div className="mt-4 rounded-lg border border-border bg-surface p-4 card-depth">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-bw-peach-light">Clone &amp; Test</h3>
          <Badge
            variant="outline"
            className={`text-[10px] font-mono ${
              plan.fixedState === 'available'
                ? 'border-green-500/50 text-green-400'
                : 'border-amber-500/50 text-amber-400'
            }`}
          >
            {plan.fixedState === 'available'
              ? 'both versions ready'
              : plan.fixedState.replace('_', ' ')}
          </Badge>
        </div>
        <span className="text-[10px] font-mono text-bw-peach">
          {plan.isPrivate ? 'private' : 'public'} · no credentials in commands
        </span>
      </div>

      <p className="mt-2 text-xs text-bw-peach leading-relaxed">
        Clone the exact snapshot BugWiser investigated and the branch carrying its fix, then run the
        project&apos;s own tests against both.
      </p>

      <div className="mt-3 space-y-3">
        <CloneTargetCard target={plan.original} isPrivate={plan.isPrivate} />

        {plan.fixed ? (
          <CloneTargetCard target={plan.fixed} isPrivate={plan.isPrivate} isFork={plan.fixIsFork} />
        ) : (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
            <p className="text-xs font-mono font-bold uppercase tracking-wider text-amber-400">
              No fixed version to clone
            </p>
            <p className="mt-1 text-xs text-bw-peach leading-relaxed">
              {plan.fixedReason || 'A fix branch must exist before the fixed code can be cloned.'}
            </p>
          </div>
        )}

        <div className="rounded-lg border border-border bg-surface-dim p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs border-border text-bw-peach hover:text-bw-peach-light"
              onClick={() => void handleCompare()}
              disabled={!canCompare}
            >
              {compareOpen ? 'Hide comparison' : 'Compare Changes'}
            </Button>
            {plan.compare.githubUrl && (
              <a
                href={plan.compare.githubUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] font-mono text-primary-container hover:underline"
              >
                Open comparison on GitHub →
              </a>
            )}
            {!canCompare && (
              <span className="text-[11px] text-bw-peach">
                A pinned base commit and a fix branch are both required.
              </span>
            )}
          </div>

          <p className="mt-2 text-[11px] text-bw-peach leading-relaxed">{plan.compare.note}</p>

          {compareOpen && (
            <div className="mt-3 space-y-2">
              {plan.compare.serverSide ? (
                compareLoading ? (
                  <p className="text-xs text-bw-peach">Comparing commits…</p>
                ) : compareError ? (
                  <p className="text-xs text-error-default">{compareError}</p>
                ) : compareFiles && compareFiles.length > 0 ? (
                  <>
                    {compareSummary && (
                      <p className="text-[11px] font-mono text-bw-peach">{compareSummary}</p>
                    )}
                    {compareFiles.map((file) => (
                      <details key={file.path} className="rounded border border-border bg-surface">
                        <summary className="flex items-center justify-between gap-2 px-2 py-1.5 cursor-pointer">
                          <span className="font-mono text-[11px] text-bw-peach-light truncate">
                            {file.path}
                          </span>
                          <span className="font-mono text-[10px] whitespace-nowrap">
                            <span className="text-green-400">+{file.additions}</span>{' '}
                            <span className="text-red-400">-{file.deletions}</span>
                          </span>
                        </summary>
                        <div className="p-2 border-t border-border">
                          {file.patch ? (
                            <UnifiedDiffView diff={file.patch} />
                          ) : (
                            <p className="text-[11px] text-bw-peach">
                              GitHub did not include a text patch for this file (binary or too
                              large). Clone the branches to inspect it.
                            </p>
                          )}
                        </div>
                      </details>
                    ))}
                  </>
                ) : (
                  <p className="text-xs text-bw-peach">No changed files between these commits.</p>
                )
              ) : (
                <CommandBlock label="Compare locally" commands={plan.compare.commands} />
              )}
            </div>
          )}
        </div>

        {plan.warnings.length > 0 && (
          <ul className="space-y-1">
            {plan.warnings.map((warning) => (
              <li key={warning} className="text-[11px] text-bw-peach leading-relaxed">
                · {warning}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
