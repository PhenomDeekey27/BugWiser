import { Analysis } from '@/types';

interface RecentAnalysesProps {
  analyses?: Analysis[];
}

export function RecentAnalyses({ analyses = [] }: RecentAnalysesProps) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-bw-peach-light mb-4">
        Recent Analyses
      </h2>

      {analyses.length === 0 ? (
        <div className="p-8 rounded-lg bg-surface border border-border text-center">
            <p className="text-sm text-bw-peach">
            No analyses yet. Start by analyzing a GitHub issue.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {analyses.map((analysis) => (
            <div
              key={analysis.id}
              className="block p-4 rounded-lg bg-surface border border-border hover:border-primary/20 transition-all cursor-pointer card-depth card-depth-hover"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-mono text-primary-default">
                      {analysis.repository.name}
                    </span>
                    <span className="text-bw-dusty-rose">/</span>
                    <span className="text-sm font-mono text-bw-peach-light">
                      Issue #{analysis.issue.number}
                    </span>
                  </div>
                  <p className="text-sm text-bw-peach truncate">
                    {analysis.issue.title}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
