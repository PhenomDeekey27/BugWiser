'use client';

import { Analysis, AnalysisRecord } from '@/types';

interface AnalysisDetailsSidebarProps {
  analysis: Analysis;
  record: AnalysisRecord | null;
  isRunning: boolean;
  isComplete: boolean;
  isFailed: boolean;
}

const STAGE_LABELS: Record<string, string> = {
  issue_context: 'Issue Context',
  issue_comments: 'Issue Comments',
  repository_tree: 'Repository Tree',
  file_filtering: 'File Filtering',
  repository_fingerprint: 'Repository Fingerprint',
  ready: 'Ready',
  relevant_files_discovery: 'AI Discovery',
  relevant_files_fetch: 'Fetching Files',
  relevant_files_complete: 'Files Ready',
};

export function AnalysisDetailsSidebar({
  analysis,
  record,
  isRunning,
  isComplete,
  isFailed,
}: AnalysisDetailsSidebarProps) {
  return (
    <div className="w-72 border-l border-border bg-surface-glass-sidebar p-4 hidden lg:block">
      <h3 className="text-sm font-semibold text-bw-peach-light mb-4">
        Analysis Details
      </h3>

      <div className="space-y-4">
        <div>
          <p className="text-xs font-mono font-bold uppercase tracking-wider text-bw-peach mb-1">
            Repository
          </p>
          <p className="text-sm font-mono text-bw-peach-light" suppressHydrationWarning>
            {analysis.repository.fullName || 'Loading...'}
          </p>
        </div>

        <div>
          <p className="text-xs font-mono font-bold uppercase tracking-wider text-bw-peach mb-1">
            Issue
          </p>
          <p className="text-sm font-mono text-bw-peach-light">
            #{analysis.issue.number}
          </p>
        </div>

        <div>
          <p className="text-xs font-mono font-bold uppercase tracking-wider text-bw-peach mb-1">
            Status
          </p>
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                isComplete
                  ? 'bg-green-500'
                  : isFailed
                    ? 'bg-error-default'
                    : isRunning
                      ? 'bg-primary-container animate-pulse'
                      : 'bg-surface-bright'
              }`}
            />
            <p className="text-sm text-bw-peach-light capitalize" suppressHydrationWarning>
              {record?.status?.replace(/_/g, ' ') || 'Loading...'}
            </p>
          </div>
        </div>

        {record?.current_stage && (
          <div>
            <p className="text-xs font-mono font-bold uppercase tracking-wider text-bw-peach mb-1">
              Current Stage
            </p>
            <p className="text-sm font-mono text-bw-peach-light">
              {STAGE_LABELS[record.current_stage] || record.current_stage}
            </p>
          </div>
        )}

        <div>
          <p className="text-xs font-mono font-bold uppercase tracking-wider text-bw-peach mb-1">
            Started
          </p>
          <p className="text-sm text-bw-peach-light">
            {new Date(analysis.startedAt).toLocaleString()}
          </p>
        </div>

        {analysis.completedAt && (
          <div>
            <p className="text-xs font-mono font-bold uppercase tracking-wider text-bw-peach mb-1">
              Completed
            </p>
            <p className="text-sm text-bw-peach-light">
              {new Date(analysis.completedAt).toLocaleString()}
            </p>
          </div>
        )}

        {record?.total_files ? (
          <div>
            <p className="text-xs font-mono font-bold uppercase tracking-wider text-bw-peach mb-1">
              Files
            </p>
            <p className="text-sm font-mono text-bw-peach-light">
              {record.filtered_files} / {record.total_files.toLocaleString()}
            </p>
          </div>
        ) : null}

        {record?.ai_provider && (
          <div>
            <p className="text-xs font-mono font-bold uppercase tracking-wider text-bw-peach mb-1">
              AI Provider
            </p>
            <p className="text-sm font-mono text-bw-peach-light">{record.ai_provider}</p>
          </div>
        )}

        {record?.ai_model && (
          <div>
            <p className="text-xs font-mono font-bold uppercase tracking-wider text-bw-peach mb-1">
              Model
            </p>
            <p className="text-sm font-mono text-bw-peach-light">{record.ai_model}</p>
          </div>
        )}

        {record?.ai_tier && (
          <div>
            <p className="text-xs font-mono font-bold uppercase tracking-wider text-bw-peach mb-1">
              Tier
            </p>
            <p className="text-sm font-mono text-bw-peach-light capitalize">{record.ai_tier}</p>
          </div>
        )}

        {record?.ai_duration_ms && (
          <div>
            <p className="text-xs font-mono font-bold uppercase tracking-wider text-bw-peach mb-1">
              Duration
            </p>
            <p className="text-sm font-mono text-bw-peach-light">
              {(record.ai_duration_ms / 1000).toFixed(1)}s
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
