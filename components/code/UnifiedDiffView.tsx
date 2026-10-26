interface UnifiedDiffViewProps {
  /** Raw unified diff text (`@@` hunks with +/- lines). */
  diff: string;
  className?: string;
}

/**
 * Renders a raw unified diff with the same colouring the workspace uses, so a
 * fetched GitHub comparison and a staged workspace diff look identical.
 */
export function UnifiedDiffView({ diff, className }: UnifiedDiffViewProps) {
  return (
    <pre
      className={`text-[11px] font-mono leading-relaxed overflow-x-auto max-h-80 overflow-y-auto bg-surface-code p-2 rounded border border-border ${
        className || ''
      }`}
    >
      {diff.split('\n').map((line, index) => {
        const tone =
          line.startsWith('+++') || line.startsWith('---')
            ? 'text-bw-peach'
            : line.startsWith('@@')
              ? 'text-primary-container'
              : line.startsWith('+')
                ? 'text-green-400'
                : line.startsWith('-')
                  ? 'text-red-400'
                  : 'text-bw-peach-light';
        return (
          <div key={index} className={tone}>
            {line || ' '}
          </div>
        );
      })}
    </pre>
  );
}
