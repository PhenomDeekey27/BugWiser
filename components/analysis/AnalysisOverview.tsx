'use client';

import { RepositoryFingerprint, IssueContext, IssueComment } from '@/types';
import { Badge } from '@/components/ui/badge';

interface AnalysisOverviewProps {
  fingerprint: RepositoryFingerprint | null;
  issue: IssueContext;
  comments: IssueComment[];
  totalFiles: number;
  filteredFiles: number;
  repositoryFullName: string;
  className?: string;
}

export function AnalysisOverview({
  fingerprint,
  issue,
  comments,
  totalFiles,
  filteredFiles,
  repositoryFullName,
  className,
}: AnalysisOverviewProps) {
  return (
    <div className={`space-y-6 ${className || ''}`}>
      <div className="rounded-lg bg-surface border border-border p-4 card-depth">
        <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-bw-peach mb-3">
          Issue Summary
        </h3>
        <div className="space-y-2">
          <div className="flex items-start gap-2">
            <span className="text-xs font-mono text-primary-default">#{issue.number}</span>
            <span className="text-sm text-bw-peach-light">{issue.title}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-bw-peach">
            <span>by @{issue.author}</span>
            <span>·</span>
            <span>{issue.state}</span>
            <span>·</span>
            <span>{comments.length} comments</span>
          </div>
          {issue.labels.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {issue.labels.map((label, labelIdx) => (
                <Badge key={`${labelIdx}-${label}`} variant="secondary" className="text-[10px]">
                  {label}
                </Badge>
              ))}
            </div>
          )}
          {issue.body && (
            <div className="mt-3 p-3 rounded bg-surface-dim text-xs text-bw-peach line-clamp-4">
              {issue.body.slice(0, 500)}
              {issue.body.length > 500 && '...'}
            </div>
          )}
        </div>
      </div>

      {fingerprint && (
        <div className="rounded-lg bg-surface border border-border p-4 card-depth">
          <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-bw-peach mb-3">
            Repository Fingerprint
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] font-mono text-bw-peach">Language</p>
              <p className="text-xs font-mono text-bw-peach-light">{fingerprint.primaryLanguage || 'Unknown'}</p>
            </div>
            <div>
              <p className="text-[10px] font-mono text-bw-peach">Framework</p>
              <p className="text-xs font-mono text-bw-peach-light">{fingerprint.framework || 'None detected'}</p>
            </div>
            <div>
              <p className="text-[10px] font-mono text-bw-peach">Package Manager</p>
              <p className="text-xs font-mono text-bw-peach-light">{fingerprint.packageManager || 'Unknown'}</p>
            </div>
            <div>
              <p className="text-[10px] font-mono text-bw-peach">Project Type</p>
              <p className="text-xs font-mono text-bw-peach-light">{fingerprint.projectType}</p>
            </div>
            <div>
              <p className="text-[10px] font-mono text-bw-peach">Total Files</p>
              <p className="text-xs font-mono text-bw-peach-light">{totalFiles.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-[10px] font-mono text-bw-peach">Active Files</p>
              <p className="text-xs font-mono text-bw-peach-light">{filteredFiles.toLocaleString()}</p>
            </div>
          </div>

          {fingerprint.languages.length > 0 && (
            <div className="mt-3">
              <p className="text-[10px] font-mono text-bw-peach mb-1">Languages</p>
              <div className="flex flex-wrap gap-1">
                {fingerprint.languages.slice(0, 8).map((lang, langIdx) => (
                  <Badge key={`${langIdx}-${lang}`} variant="outline" className="text-[10px]">
                    {lang}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {fingerprint.sourceDirectories.length > 0 && (
            <div className="mt-3">
              <p className="text-[10px] font-mono text-bw-peach mb-1">Source Directories</p>
              <div className="flex flex-wrap gap-1">
                {fingerprint.sourceDirectories.map((dir, dirIdx) => (
                  <span key={`${dirIdx}-${dir}`} className="text-[10px] font-mono text-primary-default">
                    {dir}/
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="rounded-lg bg-surface border border-border p-4 card-depth">
        <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-bw-peach mb-3">
          Repository
        </h3>
        <div className="space-y-2">
          <div>
            <p className="text-[10px] font-mono text-bw-peach">Full Name</p>
            <p className="text-xs font-mono text-primary-default">{repositoryFullName}</p>
          </div>
          <div>
            <p className="text-[10px] font-mono text-bw-peach">File Count</p>
            <p className="text-xs font-mono text-bw-peach-light">
              {filteredFiles} active / {totalFiles} total
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
