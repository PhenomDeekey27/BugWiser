import { RelevantFile } from '@/types';

interface RelevantFilesPanelProps {
  files: RelevantFile[];
}

export function RelevantFilesPanel({ files }: RelevantFilesPanelProps) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-bw-peach-light mb-4">
        Relevant Files
      </h2>

      <div className="space-y-2">
        {files.map((file, fileIdx) => (
          <div
            key={`${fileIdx}-${file.path}`}
            className="p-3 rounded-lg bg-surface border border-border"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-mono text-primary-default">
                {file.path}
              </span>
              <span className="text-xs font-mono text-bw-peach">
                {Math.round(file.relevanceScore * 100)}% relevance
              </span>
            </div>
            <p className="text-xs text-bw-peach">
              {file.description}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
