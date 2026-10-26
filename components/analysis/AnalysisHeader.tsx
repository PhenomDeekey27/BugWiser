import { Analysis, AnalysisRecord } from '@/types';
import { Badge } from '@/components/ui/badge';

interface AnalysisHeaderProps {
  analysis: Analysis;
  record?: AnalysisRecord | null;
}

export function AnalysisHeader({ analysis, record }: AnalysisHeaderProps) {
  const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
    completed: { label: 'Index Ready', variant: 'default' },
    indexing: { label: 'Indexing...', variant: 'secondary' },
    analyzing: { label: 'Analyzing...', variant: 'secondary' },
    failed: { label: 'Failed', variant: 'destructive' },
    idle: { label: 'Pending', variant: 'outline' },
    relevant_file_discovery: { label: 'Discovering...', variant: 'secondary' },
    relevant_files_ready: { label: 'Files Ready', variant: 'default' },
  };

  const config = statusConfig[analysis.status] || statusConfig.idle;
  const isPublic = record?.repository_source === 'public';
  const isDescriptionOnly = record?.issue_source === 'description';
  const commit = record?.repository_commit;
  const branch = record?.repository_branch || analysis.repository.defaultBranch;

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-mono text-primary-default">
          {analysis.repository.fullName || analysis.repository.name}
        </span>
        <span className="text-bw-peach">/</span>
        <span className="text-sm font-mono text-bw-peach-light">
          {isDescriptionOnly ? 'Issue description' : `Issue #${analysis.issue.number}`}
        </span>
      </div>

      <h1 className="text-xl font-semibold text-bw-peach-light mb-3">
        {analysis.issue.title}
      </h1>

      <div className="flex flex-wrap items-center gap-3">
        {branch && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-bw-peach">Branch:</span>
            <span className="text-xs font-mono text-bw-peach-light">{branch}</span>
          </div>
        )}
        {commit && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-bw-peach">Commit:</span>
            <span className="text-xs font-mono text-bw-peach-light" title={commit}>
              {commit.slice(0, 7)}
            </span>
          </div>
        )}
        {isPublic && (
          <Badge variant="outline" className="text-xs font-mono border-border text-bw-peach">
            Public repository · read-only
          </Badge>
        )}
        {isDescriptionOnly && (
          <Badge variant="outline" className="text-xs font-mono border-border text-bw-peach">
            No issue link
          </Badge>
        )}
        <Badge
          variant={config.variant}
          className="text-xs font-mono"
        >
          {config.label}
        </Badge>
      </div>
    </div>
  );
}
