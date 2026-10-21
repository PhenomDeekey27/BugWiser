'use client';

import { Repository } from '@/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface RepositorySelectorProps {
  selectedRepository: Repository | null;
  onSelect: (repository: Repository) => void;
  repositories: Repository[];
  loading?: boolean;
  error?: string | null;
  /** No GitHub App installation is linked to this account yet. */
  requiresInstallation?: boolean;
  /** An installation exists, but it has no selected repositories. */
  requiresRepositorySelection?: boolean;
  installUrl?: string | null;
  manageUrl?: string | null;
}

export function RepositorySelector({
  selectedRepository,
  onSelect,
  repositories,
  loading = false,
  error = null,
  requiresInstallation = false,
  requiresRepositorySelection = false,
  installUrl = null,
  manageUrl = null,
}: RepositorySelectorProps) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-bw-peach-light mb-4">
        Select Repository
      </h2>

      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="w-full p-4 rounded-lg bg-surface border border-border animate-pulse"
            >
              <div className="h-4 bg-surface-dim rounded w-1/3 mb-2" />
              <div className="h-3 bg-surface-dim rounded w-2/3" />
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="p-4 rounded-lg border border-error-default/30 bg-error-container/10">
          <p className="text-sm text-error-default">{error}</p>
        </div>
      )}

      {!loading && !error && repositories.length === 0 && requiresInstallation && (
        <div className="p-8 rounded-lg bg-surface border border-border text-center">
          <p className="text-sm text-bw-peach">
            No GitHub App installation is linked to your account yet. Install the
            App and choose the repositories BugWiser may access.
          </p>
          {installUrl && (
            <a href={installUrl} rel="noreferrer" className="inline-block mt-4">
              <Button className="btn-bw-primary font-medium">Install GitHub App</Button>
            </a>
          )}
        </div>
      )}

      {!loading && !error && repositories.length === 0 && requiresRepositorySelection && (
        <div className="p-8 rounded-lg bg-surface border border-border text-center">
          <p className="text-sm text-bw-peach">
            Your GitHub App installation has no repositories selected. Choose at
            least one repository on GitHub, then reload this page.
          </p>
          {manageUrl && (
            <a href={manageUrl} target="_blank" rel="noreferrer" className="inline-block mt-4">
              <Button variant="outline" className="font-medium">
                Manage repository access
              </Button>
            </a>
          )}
        </div>
      )}

      {!loading &&
        !error &&
        repositories.length === 0 &&
        !requiresInstallation &&
        !requiresRepositorySelection && (
          <div className="p-8 rounded-lg bg-surface border border-border text-center">
            <p className="text-sm text-bw-peach">
              No repositories found. Make sure your GitHub account has access to repositories.
            </p>
          </div>
        )}

      {!loading && !error && repositories.length > 0 && (
        <div className="space-y-2 max-h-125 overflow-y-auto pr-1 scrollbar-thin cursor-pointer">
          {repositories.map((repo) => (
            <button
              key={repo.id}
              onClick={() => onSelect(repo)}
              className={cn(
                'w-full p-4 rounded-lg border text-left transition-all cursor-pointer card-depth-hover',
                selectedRepository?.id === repo.id
                  ? 'border-primary bg-primary/5 glow-primary-sm'
                  : 'border-border bg-surface hover:border-primary/20'
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-mono text-primary-default truncate">
                  {repo.fullName}
                </span>
                <span className="text-xs font-mono text-bw-dusty-rose whitespace-nowrap shrink-0">
                  {repo.language || 'N/A'}
                </span>
              </div>
              <p className="text-sm text-bw-peach truncate mt-1">
                {repo.description || 'No description'}
              </p>
              <div className="flex items-center gap-4 mt-2 text-xs text-bw-dusty-rose">
                {repo.stars > 0 && <span>★ {repo.stars}</span>}
                {repo.forks > 0 && <span>⑂ {repo.forks}</span>}
                {repo.private && (
                  <span className="text-primary-default font-mono text-xs">Private</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
