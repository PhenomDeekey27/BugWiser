import { Evidence } from '@/types';

interface EvidencePanelProps {
  evidence: Evidence;
  onRerun?: () => void;
  onContinueToSolution?: () => void;
}

export function EvidencePanel({ evidence, onRerun, onContinueToSolution }: EvidencePanelProps) {
  const isNoEvidence = evidence.status === 'no_evidence' || (!evidence.evidence || evidence.evidence.length === 0);

  if (isNoEvidence) {
    return (
      <div>
        <h2 className="text-lg font-semibold text-bw-peach-light mb-4">
          Evidence Analysis
        </h2>

        <div className="p-4 rounded-lg bg-surface-container/80 border border-yellow-500/30 bg-yellow-500/5 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-yellow-400" />
            <span className="text-sm font-semibold text-yellow-400">
              No Strong Evidence Found
            </span>
          </div>
          <p className="text-sm text-bw-peach-light leading-relaxed">
            {evidence.description}
          </p>
          {evidence.reason && (
            <p className="text-xs text-bw-peach mt-2">
              Reason: {evidence.reason}
            </p>
          )}
          {evidence.confidence !== undefined && (
            <p className="text-xs text-bw-peach mt-1">
              Confidence: {Math.round(evidence.confidence * 100)}%
            </p>
          )}
        </div>

        <div className="p-4 rounded-lg bg-surface-container/80 border border-bw-burgundy/30 mb-4">
          <p className="text-xs text-bw-peach leading-relaxed">
            The analysis could not identify specific code locations that independently support the proposed root cause. This is common for styling, layout, or responsive design issues where the problem is in CSS behavior rather than code logic.
          </p>
        </div>

        <div className="flex gap-2">
          {onRerun && (
            <button
              onClick={onRerun}
              className="px-3 py-1.5 text-xs font-mono rounded bg-surface-container/80 border border-bw-burgundy/30 text-bw-peach hover:text-bw-peach-light hover:border-bw-terracotta/50 transition-colors"
            >
              Re-run Evidence
            </button>
          )}
          {onContinueToSolution && (
            <button
              onClick={onContinueToSolution}
              className="px-3 py-1.5 text-xs font-mono rounded btn-bw-primary"
            >
              Continue to Solution
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-bw-peach-light mb-4">
        Evidence
      </h2>

      <div className="p-4 rounded-lg bg-surface-container/80 border border-bw-burgundy/30 mb-4">
        <p className="text-sm text-bw-peach-light leading-relaxed">
          {evidence.description}
        </p>
      </div>

      <div className="space-y-4">
        {evidence.evidence.map((ref, index) => (
          <div
            key={index}
            className="rounded-lg border border-bw-burgundy/30 bg-surface-container-low/50 overflow-hidden"
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-bw-burgundy/20 bg-surface-container/50">
              <span className="text-xs font-mono text-bw-peach">
                {ref.file}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-bw-peach">
                  Lines {ref.lineStart}-{ref.lineEnd}
                </span>
                <span className={`text-xs font-mono px-2 py-0.5 rounded-full ${
                  ref.type === 'direct' ? 'bg-green-500/20 text-green-400' : 'bg-blue-500/20 text-blue-400'
                }`}>
                  {ref.type}
                </span>
              </div>
            </div>
            <div className="p-3">
              {ref.code && (
                <pre className="text-xs font-mono text-bw-peach bg-[#18090B] p-2 rounded mb-2 overflow-x-auto border border-bw-burgundy/20">
                  {ref.code}
                </pre>
              )}
              <p className="text-sm text-bw-peach">
                {ref.explanation}
              </p>
            </div>
          </div>
        ))}
      </div>

      {onRerun && (
        <div className="mt-4">
          <button
            onClick={onRerun}
            className="px-3 py-1.5 text-xs font-mono rounded bg-surface-container/80 border border-bw-burgundy/30 text-bw-peach hover:text-bw-peach-light hover:border-bw-terracotta/50 transition-colors"
          >
            Re-run Evidence
          </button>
        </div>
      )}
    </div>
  );
}
