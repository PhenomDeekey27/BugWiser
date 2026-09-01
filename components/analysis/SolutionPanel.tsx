import { Solution, RootCause } from '@/types';
import { Badge } from '@/components/ui/badge';

interface SolutionPanelProps {
  solution: Solution;
  rootCause?: RootCause | null;
}

export function SolutionPanel({ solution, rootCause }: SolutionPanelProps) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-lg font-semibold text-bw-peach-light">
          Proposed Solution
        </h2>
        <Badge variant="outline" className="text-xs font-mono">
          {Math.round(solution.confidence * 100)}% confidence
        </Badge>
      </div>

      {rootCause && (
        <div className="p-4 rounded-lg bg-surface-container/80 border border-red-500/30 bg-red-500/5 mb-4">
          <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-bw-peach mb-2">
            What is wrong
          </h3>
          <p className="text-sm text-bw-peach-light font-medium mb-2">
            {rootCause.summary}
          </p>
          <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-bw-peach mb-2 mt-3">
            Why the problem occurs
          </h3>
          <p className="text-sm text-bw-peach leading-relaxed">
            {rootCause.description}
          </p>
        </div>
      )}

      {!rootCause && solution.summary && (
        <div className="p-4 rounded-lg bg-surface-container/80 border border-bw-burgundy/30 mb-4">
          <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-bw-peach mb-2">
            Summary
          </h3>
          <p className="text-sm text-bw-peach-light font-medium">
            {solution.summary}
          </p>
        </div>
      )}

      <div className="p-4 rounded-lg bg-surface-container/80 border border-bw-burgundy/30 mb-4">
        <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-bw-peach mb-2">
          What will be changed
        </h3>
        <p className="text-sm text-bw-peach-light leading-relaxed">
          {solution.description}
        </p>
      </div>

      {solution.affectedFiles && solution.affectedFiles.length > 0 && (
        <div className="p-4 rounded-lg bg-surface-container/80 border border-bw-burgundy/30 mb-4">
          <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-bw-peach mb-2">
            Affected Files
          </h3>
          <div className="space-y-2">
            {solution.affectedFiles.map((file, index) => (
              <div key={index} className="flex items-start gap-2">
                <span className="text-sm font-mono text-primary-default">
                  {file.path}
                </span>
                <span className="text-sm text-bw-peach">
                  {file.change}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {solution.steps && solution.steps.length > 0 && (
        <div className="p-4 rounded-lg bg-surface-container/80 border border-bw-burgundy/30 mb-4">
          <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-bw-peach mb-2">
            Implementation Steps
          </h3>
          <div className="space-y-2">
            {solution.steps.map((step, index) => (
              <div key={index} className="flex items-start gap-2">
                <span className="text-xs font-mono text-primary-default mt-0.5">
                  {index + 1}.
                </span>
                <p className="text-sm text-bw-peach-light">{step}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {solution.risks && solution.risks.length > 0 && (
        <div className="p-4 rounded-lg bg-surface-container/80 border border-yellow-500/30 bg-yellow-500/5">
          <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-bw-peach mb-2">
            Risks & Considerations
          </h3>
          <div className="space-y-1">
            {solution.risks.map((risk, index) => (
              <div key={index} className="flex items-start gap-2">
                <span className="text-xs text-yellow-500 mt-0.5">⚠</span>
                <p className="text-sm text-bw-peach">{risk}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
