import { RelevantFile, UnavailableSourceFile } from '@/types';

interface RelevantFilesPanelProps {
  files: RelevantFile[];
  unavailableFiles?: UnavailableSourceFile[];
}

export function RelevantFilesPanel({ files, unavailableFiles = [] }: RelevantFilesPanelProps) {
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

      {unavailableFiles.length > 0 && (
        <div className="mt-4 p-3 rounded-lg bg-surface-dim border border-yellow-500/30">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-yellow-400" />
            <span className="text-xs font-semibold text-yellow-400">
              Files that could not be read at the pinned commit
            </span>
          </div>
          <p className="text-xs text-bw-peach leading-relaxed mb-2">
            Evidence citing these files cannot be verified. That is a retrieval limit,
            not proof the location is wrong.
          </p>
          <ul className="space-y-1">
            {unavailableFiles.map((file) => (
              <li key={file.path} className="text-xs leading-relaxed">
                <span className="font-mono text-bw-peach-light">{file.path}</span>
                <span className="text-bw-peach"> — {file.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
