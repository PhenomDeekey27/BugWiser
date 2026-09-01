import { Analysis } from '@/types';
import { Badge } from '@/components/ui/badge';

interface AnalysisHeaderProps {
  analysis: Analysis;
}

export function AnalysisHeader({ analysis }: AnalysisHeaderProps) {
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

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-mono text-primary-default">
          {analysis.repository.name}
        </span>
        <span className="text-bw-peach">/</span>
        <span className="text-sm font-mono text-bw-peach-light">
          Issue #{analysis.issue.number}
        </span>
      </div>

      <h1 className="text-xl font-semibold text-bw-peach-light mb-3">
        {analysis.issue.title}
      </h1>

      <div className="flex items-center gap-3">
        {analysis.repository.defaultBranch && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-bw-peach">Branch:</span>
            <span className="text-xs font-mono text-bw-peach-light">{analysis.repository.defaultBranch}</span>
          </div>
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
