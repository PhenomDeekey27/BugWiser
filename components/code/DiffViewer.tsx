import { PatchHunk } from '@/types';

interface DiffViewerProps {
  hunks: PatchHunk[];
}

export function DiffViewer({ hunks }: DiffViewerProps) {
  return (
    <div className="overflow-x-auto bg-[#18090B]">
      <pre className="p-3 font-mono text-xs">
        {hunks.map((hunk, hunkIndex) => (
          <div key={hunkIndex}>
            {hunk.lines.map((line) => (
              <div
                key={line.number}
                className={`flex ${
                  line.type === 'added'
                    ? 'bg-green-500/10'
                    : line.type === 'removed'
                    ? 'bg-red-500/10'
                    : ''
                }`}
              >
                <span className="w-12 text-right pr-3 text-bw-dusty-rose/70 select-none">
                  {line.number}
                </span>
                <span
                  className={
                    line.type === 'added'
                      ? 'text-green-400'
                      : line.type === 'removed'
                      ? 'text-red-400'
                      : 'text-bw-peach-light'
                  }
                >
                  {line.content}
                </span>
              </div>
            ))}
          </div>
        ))}
      </pre>
    </div>
  );
}
