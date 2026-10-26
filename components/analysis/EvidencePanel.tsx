import { Evidence } from '@/types';

interface EvidencePanelProps {
  evidence: Evidence;
  onRerun?: () => void;
  onContinueToSolution?: () => void;
}

type VerificationStatus = 'verified' | 'unverified' | 'rejected';

const VERIFICATION_STYLES: Record<VerificationStatus, { label: string; className: string }> = {
  verified: {
    label: 'Verified',
    className: 'bg-green-500/20 text-green-400 border-green-500/30',
  },
  unverified: {
    label: 'Unverified',
    className: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  },
  rejected: {
    label: 'Rejected',
    className: 'bg-red-500/20 text-red-400 border-red-500/30',
  },
};

function countByVerification(evidence: Evidence) {
  const counts = { verified: 0, unverified: 0, rejected: 0, unannotated: 0 };
  for (const ref of evidence.evidence || []) {
    if (ref.verification === 'verified') counts.verified += 1;
    else if (ref.verification === 'unverified') counts.unverified += 1;
    else if (ref.verification === 'rejected') counts.rejected += 1;
    else counts.unannotated += 1;
  }
  return counts;
}

export function EvidencePanel({ evidence, onRerun, onContinueToSolution }: EvidencePanelProps) {
  const isNoEvidence =
    evidence.status === 'no_evidence' ||
    evidence.status === 'insufficient_evidence' ||
    !evidence.evidence ||
    evidence.evidence.length === 0;

  if (isNoEvidence) {
    const isInsufficient = evidence.status === 'insufficient_evidence';

    return (
      <div>
        <h2 className="text-lg font-semibold text-bw-peach-light mb-4">
          Evidence Analysis
        </h2>

        <div className="p-4 rounded-lg bg-surface border border-yellow-500/30 bg-yellow-500/5 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-yellow-400" />
            <span className="text-sm font-semibold text-yellow-400">
              {isInsufficient ? 'Evidence Could Not Be Confirmed' : 'No Strong Evidence Found'}
            </span>
          </div>
          <p className="text-sm text-bw-peach-light leading-relaxed">
            {evidence.description}
          </p>
          {isInsufficient && (
            <p className="text-xs text-yellow-400/90 mt-2">
              The analysis returned file references, but none of them matched the source
              files retrieved for this commit. Treat the reported locations as unconfirmed.
            </p>
          )}
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

        <div className="p-4 rounded-lg bg-surface border border-border mb-4">
          <p className="text-xs text-bw-peach leading-relaxed">
            The analysis could not identify specific code locations that independently support the proposed root cause. This is common for styling, layout, or responsive design issues where the problem is in CSS behavior rather than code logic.
          </p>
        </div>

        <div className="flex gap-2">
          {onRerun && (
            <button
              onClick={onRerun}
              className="px-3 py-1.5 text-xs font-mono rounded bg-surface border border-border text-bw-peach hover:text-bw-peach-light hover:border-primary/20 transition-colors"
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

  const counts = countByVerification(evidence);
  const hasVerification = counts.verified + counts.unverified + counts.rejected > 0;

  return (
    <div>
      <h2 className="text-lg font-semibold text-bw-peach-light mb-4">
        Evidence
      </h2>

      <div className="p-4 rounded-lg bg-surface border border-border mb-4">
        <p className="text-sm text-bw-peach-light leading-relaxed">
          {evidence.description}
        </p>
      </div>

      {hasVerification && (
        <div className="mb-4 p-3 rounded-lg bg-surface-dim border border-border">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-mono uppercase tracking-wider text-bw-peach">
              Checked against pinned source
            </span>
            {counts.verified > 0 && (
              <span className={`text-xs font-mono px-2 py-0.5 rounded-full border ${VERIFICATION_STYLES.verified.className}`}>
                {counts.verified} verified
              </span>
            )}
            {counts.unverified > 0 && (
              <span className={`text-xs font-mono px-2 py-0.5 rounded-full border ${VERIFICATION_STYLES.unverified.className}`}>
                {counts.unverified} unverified
              </span>
            )}
            {counts.rejected > 0 && (
              <span className={`text-xs font-mono px-2 py-0.5 rounded-full border ${VERIFICATION_STYLES.rejected.className}`}>
                {counts.rejected} rejected
              </span>
            )}
          </div>
          {counts.unverified + counts.rejected > 0 && (
            <p className="text-xs text-bw-peach mt-2 leading-relaxed">
              Unverified and rejected references could not be confirmed at the cited
              location. They are shown for context only and are not evidence.
            </p>
          )}
        </div>
      )}

      <div className="space-y-4">
        {evidence.evidence.map((ref, index) => {
          const verification = ref.verification
            ? VERIFICATION_STYLES[ref.verification]
            : null;
          const rangeMoved =
            ref.correctedRange &&
            (ref.correctedRange.lineStart !== ref.lineStart ||
              ref.correctedRange.lineEnd !== ref.lineEnd);

          return (
            <div
              key={index}
              className={`rounded-lg border bg-surface-dim overflow-hidden ${
                ref.verification === 'rejected'
                  ? 'border-red-500/30'
                  : ref.verification === 'unverified'
                    ? 'border-yellow-500/30'
                    : 'border-border'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-border bg-surface">
                <span className="text-xs font-mono text-bw-peach">
                  {ref.file}
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-mono text-bw-peach">
                    Lines {ref.lineStart}-{ref.lineEnd}
                  </span>
                  <span className={`text-xs font-mono px-2 py-0.5 rounded-full ${
                    ref.type === 'direct' ? 'bg-green-500/20 text-green-400' : 'bg-blue-500/20 text-blue-400'
                  }`}>
                    {ref.type}
                  </span>
                  {verification && (
                    <span
                      className={`text-xs font-mono px-2 py-0.5 rounded-full border ${verification.className}`}
                    >
                      {verification.label}
                    </span>
                  )}
                </div>
              </div>
              <div className="p-3">
                {rangeMoved && ref.correctedRange && (
                  <p className="text-xs font-mono text-yellow-400 mb-2">
                    Snippet matched at lines {ref.correctedRange.lineStart}-
                    {ref.correctedRange.lineEnd} of the pinned commit.
                  </p>
                )}
                {ref.code && (
                  <pre className="text-xs font-mono text-bw-peach bg-surface-code p-2 rounded mb-2 overflow-x-auto border border-border">
                    {ref.code}
                  </pre>
                )}
                <p className="text-sm text-bw-peach">
                  {ref.explanation}
                </p>
                {ref.verificationReason && (
                  <p className="text-xs text-bw-peach mt-2">
                    {ref.verificationReason}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {onRerun && (
        <div className="mt-4">
          <button
            onClick={onRerun}
            className="px-3 py-1.5 text-xs font-mono rounded bg-surface border border-border text-bw-peach hover:text-bw-peach-light hover:border-primary/20 transition-colors"
          >
            Re-run Evidence
          </button>
        </div>
      )}
    </div>
  );
}
