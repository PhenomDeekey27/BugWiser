'use client';

import { Issue } from '@/types';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

interface IssueSelectorProps {
  selectedIssue: Issue | null;
  onSelect: (issue: Issue) => void;
  issues: Issue[];
  loading?: boolean;
  error?: string | null;
}

export function IssueSelector({
  selectedIssue,
  onSelect,
  issues,
  loading = false,
  error = null,
}: IssueSelectorProps) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-bw-peach-light mb-4">
        Select Issue
      </h2>

      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="w-full p-4 rounded-lg bg-surface-container/80 border border-bw-burgundy/30 animate-pulse"
            >
              <div className="h-4 bg-surface-container-high rounded w-1/4 mb-2" />
              <div className="h-3 bg-surface-container-high rounded w-2/3" />
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="p-4 rounded-lg border border-error-default/30 bg-error-container/10">
          <p className="text-sm text-error-default">{error}</p>
        </div>
      )}

      {!loading && !error && issues.length === 0 && (
        <div className="p-8 rounded-lg bg-surface-container/80 border border-bw-burgundy/30 text-center">
          <p className="text-sm text-bw-peach">
            No open issues found in this repository.
          </p>
        </div>
      )}

      {!loading && !error && issues.length > 0 && (
        <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
          {issues.map((issue) => (
            <button
              key={issue.id}
              onClick={() => onSelect(issue)}
              className={cn(
                'w-full p-4 rounded-lg border text-left transition-all',
                selectedIssue?.id === issue.id
                  ? 'border-primary-container bg-primary-container/10 glow-primary-sm'
                  : 'border-bw-burgundy/30 bg-surface-container/80 hover:border-bw-terracotta/50'
              )}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-mono text-bw-peach-light">
                  #{issue.number}
                </span>
                <div className="flex gap-1">
                  {issue.labels.slice(0, 2).map((label) => (
                    <Badge key={label} variant="secondary" className="text-xs font-mono">
                      {label}
                    </Badge>
                  ))}
                </div>
              </div>
              <p className="text-sm text-bw-peach truncate">
                {issue.title}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
