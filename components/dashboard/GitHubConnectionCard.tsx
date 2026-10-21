'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

export interface GitHubInstallationView {
  installationId: number;
  accountLogin: string;
  accountType: string;
  repositorySelection: string | null;
  suspended: boolean;
  htmlUrl: string | null;
}

interface GitHubConnectionCardProps {
  configured: boolean;
  installations: GitHubInstallationView[];
  repositoryCount: number;
  installUrl: string | null;
  manageUrl: string;
}

/**
 * GitHub App connection state on the dashboard.
 *
 * Three distinct states, each with the action that actually helps:
 *  - not configured on this deployment → explain, no fake "connected" claim
 *  - signed in but no installation      → install on selected repositories
 *  - installed                          → manage access / reconnect
 */
export function GitHubConnectionCard({
  configured,
  installations,
  repositoryCount,
  installUrl,
  manageUrl,
}: GitHubConnectionCardProps) {
  const [busy, setBusy] = useState(false);

  const reconnect = () => {
    setBusy(true);
    window.location.href = '/api/auth/github/start?force=1&returnTo=%2Fdashboard';
  };

  const suspended = installations.some((installation) => installation.suspended);

  return (
    <section
      aria-labelledby="github-connection-heading"
      className="mt-8 rounded-lg bg-surface border border-border p-4 card-depth"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="github-connection-heading"
            className="text-xs font-mono font-bold uppercase tracking-wider text-bw-dusty-rose"
          >
            GitHub App
          </h2>
          <p className="text-sm text-bw-peach-light mt-2">
            {!configured && 'GitHub App is not configured on this deployment.'}
            {configured && installations.length === 0 && 'No repositories connected yet.'}
            {configured && installations.length > 0 && !suspended && 'Connected.'}
            {configured && suspended && 'Installation suspended on GitHub.'}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {configured && installations.length === 0 && installUrl && (
            <a href={installUrl} rel="noreferrer">
              <Button className="btn-bw-primary font-medium">Install GitHub App</Button>
            </a>
          )}

          {configured && installations.length > 0 && (
            <a href={manageUrl} target="_blank" rel="noreferrer">
              <Button variant="outline" className="font-medium">
                Manage repositories
              </Button>
            </a>
          )}

          {configured && (
            <Button
              variant="ghost"
              className="font-medium"
              onClick={reconnect}
              disabled={busy}
            >
              {busy ? 'Redirecting…' : 'Reconnect GitHub'}
            </Button>
          )}
        </div>
      </div>

      {!configured && (
        <p className="text-xs text-bw-dusty-rose mt-3">
          Sign-in and repository access are unavailable until the GitHub App
          credentials are set for this environment.
        </p>
      )}

      {configured && installations.length === 0 && installUrl && (
        <p className="text-xs text-bw-dusty-rose mt-3">
          BugWiser only sees the repositories you choose during installation. You
          can change that selection at any time on GitHub.
        </p>
      )}

      {configured && installations.length === 0 && !installUrl && (
        <p className="text-xs text-error-default mt-3">
          The installation link is unavailable: <code className="font-mono">GITHUB_APP_SLUG</code>{' '}
          is missing or is not a valid App slug (use the value from
          github.com/apps/&lt;slug&gt;, not the settings URL).
        </p>
      )}

      {installations.length > 0 && (
        <div className="mt-4">
          <p className="text-xs text-bw-dusty-rose mb-2">
            {repositoryCount} {repositoryCount === 1 ? 'repository' : 'repositories'} accessible
          </p>
          <ul className="space-y-1">
            {installations.map((installation) => (
              <li
                key={installation.installationId}
                className="flex flex-wrap items-center gap-2 text-sm font-mono text-bw-peach-light border-b border-border/60 pb-1 last:border-0"
              >
                <span>{installation.accountLogin}</span>
                <span className="text-[11px] uppercase tracking-wide text-bw-dusty-rose">
                  {installation.accountType}
                </span>
                <span className="text-[11px] text-bw-dusty-rose">
                  {installation.repositorySelection === 'all'
                    ? 'all repositories'
                    : 'selected repositories'}
                </span>
                {installation.suspended && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-error-container/20 text-error-default">
                    Suspended
                  </span>
                )}
              </li>
            ))}
          </ul>
          {suspended && (
            <p className="text-xs text-error-default mt-2">
              GitHub suspended this installation. Re-enable it on GitHub, then use
              Reconnect.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
