import { RootCause } from '@/types';
import { Badge } from '@/components/ui/badge';

interface RootCausePanelProps {
  rootCause: RootCause;
}

export function RootCausePanel({ rootCause }: RootCausePanelProps) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-lg font-semibold text-bw-peach-light">
          Root Cause Identified
        </h2>
        <Badge variant="outline" className="text-xs font-mono">
          {Math.round(rootCause.confidence * 100)}% confidence
        </Badge>
      </div>

      {rootCause.summary && (
        <div className="p-4 rounded-lg bg-bw-surface border border-border mb-4 card-depth">
          <p className="text-sm text-bw-peach-light font-medium">
            {rootCause.summary}
          </p>
        </div>
      )}

      <div className="p-4 rounded-lg bg-bw-surface border border-border mb-4 card-depth">
        <p className="text-sm text-bw-peach leading-relaxed">
          {rootCause.description}
        </p>
      </div>

      {rootCause.affectedFiles && rootCause.affectedFiles.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-bw-peach-light mb-2">
            Affected Files
          </h3>
          <div className="space-y-1">
            {rootCause.affectedFiles.map((file) => (
              <div
                key={file}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-bw-surface"
              >
                <span className="text-sm font-mono text-primary-default">
                  {file}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
