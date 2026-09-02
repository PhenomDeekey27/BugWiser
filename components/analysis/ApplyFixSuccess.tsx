'use client';

import { Button } from '@/components/ui/button';

interface ApplyFixSuccessProps {
  branch: string;
  commitSha: string;
  repositoryFullName: string;
  filesChanged: string[];
  commitMessage: string;
  htmlUrl?: string;
  pullRequestUrl?: string;
}

export function ApplyFixSuccess({
  branch,
  commitSha,
  repositoryFullName,
  filesChanged,
  htmlUrl,
  pullRequestUrl,
}: ApplyFixSuccessProps) {
  const shortSha = commitSha.substring(0, 7);

  return (
    <div className="p-6 rounded-xl bg-bw-surface border border-green-500/30 bg-green-500/5 card-depth-lg">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center">
          <span className="text-green-400 text-lg">✓</span>
        </div>
        <h2 className="text-lg font-semibold text-bw-peach-light">Fix Applied</h2>
      </div>

      <div className="space-y-3 mb-6">
        <div className="flex items-start gap-2">
          <span className="text-xs font-mono font-bold uppercase tracking-wider text-bw-peach w-24 shrink-0">
            Repository
          </span>
          <span className="text-sm font-mono text-bw-peach-light">
            {repositoryFullName}
          </span>
        </div>
        <div className="flex items-start gap-2">
          <span className="text-xs font-mono font-bold uppercase tracking-wider text-bw-peach w-24 shrink-0">
            Branch
          </span>
          <span className="text-sm font-mono text-primary-container">
            {branch}
          </span>
        </div>
        <div className="flex items-start gap-2">
          <span className="text-xs font-mono font-bold uppercase tracking-wider text-bw-peach w-24 shrink-0">
            Commit
          </span>
          <span className="text-sm font-mono text-bw-peach-light">{shortSha}</span>
        </div>
        {filesChanged.length > 0 && (
          <div className="flex items-start gap-2">
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-bw-peach w-24 shrink-0">
              Files Changed
            </span>
            <div className="text-sm font-mono text-bw-peach-light">
              {filesChanged.map((f) => (
                <div key={f}>{f}</div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-3">
        {pullRequestUrl && (
          <a
            href={pullRequestUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex"
          >
            <Button
              size="sm"
              className="btn-bw-primary font-medium"
            >
              View Pull Request →
            </Button>
          </a>
        )}
        {htmlUrl && (
          <a
            href={htmlUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex"
          >
            <Button
              variant="outline"
              size="sm"
              className="border-green-500/50 text-green-400 hover:text-green-300 hover:border-green-400/50"
            >
              View Branch on GitHub →
            </Button>
          </a>
        )}
      </div>
    </div>
  );
}
