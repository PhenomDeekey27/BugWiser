import { PatchHunk } from '@/types';
import { buildDiffLineRows } from './diffLineRows';

interface DiffViewerProps {
  hunks: PatchHunk[];
}

export function DiffViewer({ hunks }: DiffViewerProps) {
  return (
    <div className="overflow-x-auto bg-surface-code">
      <pre className="p-3 font-mono text-xs">
        {(hunks ?? []).map((hunk) => (
          <div key={`hunk:${hunk.oldStart}:${hunk.newStart}`}>
            {buildDiffLineRows(hunk).map((row) => (
              <div
                key={row.key}
                className={`flex ${
                  row.type === 'added'
                    ? 'bg-green-500/10'
                    : row.type === 'removed'
                    ? 'bg-red-500/10'
                    : ''
                }`}
              >
                <span className="w-12 text-right pr-3 text-bw-dusty-rose/70 select-none">
                  {row.number}
                </span>
                <span
                  className={
                    row.type === 'added'
                      ? 'text-green-400'
                      : row.type === 'removed'
                      ? 'text-red-400'
                      : 'text-bw-peach-light'
                  }
                >
                  {row.content}
                </span>
              </div>
            ))}
          </div>
        ))}
      </pre>
    </div>
  );
}
