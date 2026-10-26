import { Badge } from '@/components/ui/badge';

export interface PublicResolvedRepository {
  fullName: string;
  description: string;
  language: string | null;
  stars: number;
}

export interface PublicResolvedBranch {
  name: string;
  sha: string;
  protected: boolean;
}

interface PublicRepositoryCardProps {
  repository: PublicResolvedRepository;
  branch: string;
  branches: PublicResolvedBranch[];
  commit: { sha: string; message: string };
  resolving: boolean;
  onBranchChange: (branch: string) => void;
}

function shortSha(sha: string): string {
  return sha ? `${sha.slice(0, 10)}…` : '';
}

/** Pinned repository, branch and commit shown before an analysis starts. */
export function PublicRepositoryCard({
  repository,
  branch,
  branches,
  commit,
  resolving,
  onBranchChange,
}: PublicRepositoryCardProps) {
  const branchMissing = !branches.some((item) => item.name === branch);

  return (
    <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm text-bw-peach-light">{repository.fullName}</span>
        {repository.language && (
          <Badge variant="outline" className="text-[10px] font-mono">
            {repository.language}
          </Badge>
        )}
        <Badge variant="outline" className="text-[10px] font-mono">
          ★ {repository.stars.toLocaleString()}
        </Badge>
        <Badge variant="outline" className="text-[10px] font-mono border-green-500/40 text-green-400">
          public
        </Badge>
      </div>

      {repository.description && (
        <p className="text-sm text-bw-peach leading-relaxed">{repository.description}</p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label
            htmlFor="public-branch"
            className="block text-[10px] font-mono font-bold uppercase tracking-wider text-bw-peach mb-1"
          >
            Branch
          </label>
          <select
            id="public-branch"
            value={branch}
            onChange={(event) => onBranchChange(event.target.value)}
            disabled={resolving}
            className="w-full h-8 rounded-lg border border-border bg-surface-dim px-2 font-mono text-xs text-bw-peach-light"
          >
            {branchMissing && <option value={branch}>{branch} (current)</option>}
            {branches.map((item) => (
              <option key={item.name} value={item.name}>
                {item.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <span className="block text-[10px] font-mono font-bold uppercase tracking-wider text-bw-peach mb-1">
            Pinned commit
          </span>
          <div className="h-8 flex items-center rounded-lg border border-border bg-surface-dim px-2">
            <span className="font-mono text-xs text-bw-peach-light" title={commit.sha}>
              {shortSha(commit.sha)}
            </span>
          </div>
        </div>
      </div>

      <p className="text-xs text-bw-peach font-mono break-words">
        {commit.message.split('\n')[0]}
      </p>
      <p className="text-[11px] text-bw-peach">
        The analysis reads this exact commit. Changing the branch re-pins it before anything starts.
      </p>
    </div>
  );
}
