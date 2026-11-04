'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * What the server established about this session's GitHub access:
 *  - not_checked     → no GitHub credential (guest), nothing was queried
 *  - ok              → GitHub listed at least one repository for this account
 *  - empty           → authenticated, but the account can read no repository
 *  - reauth_required → the credential is expired or GitHub rejected it
 *  - sync_failed     → GitHub could not be reached this render
 */
export type ConnectionCheck =
  | 'not_checked'
  | 'ok'
  | 'empty'
  | 'reauth_required'
  | 'sync_failed';

interface GitHubConnectionCardProps {
  configured: boolean;
  connected: boolean;
  repositoryCount: number | null;
  manageUrl: string | null;
  check: ConnectionCheck;
  login: string | null;
}

/**
 * GitHub connection state on the dashboard.
 *
 * With an OAuth App there is no installation to add or select: the grant covers
 * whatever the account can already read. Each state therefore offers only the
 * action that actually helps — sign in, authorize again, or review access.
 */
export function GitHubConnectionCard({
  configured,
  connected,
  repositoryCount,
  manageUrl,
  check,
  login,
}: GitHubConnectionCardProps) {
  const [busy, setBusy] = useState(false);

  // A browser-restored page (back navigation / bfcache) keeps the previous
  // component state, which would leave this button stuck on "Redirecting…".
  useEffect(() => {
    const reset = (event: PageTransitionEvent) => {
      if (event.persisted) setBusy(false);
    };
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, []);

  const authorize = () => {
    setBusy(true);
    // A full page load is required: the endpoint answers with a 302 to GitHub.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = '/api/auth/github/start?force=1&returnTo=%2Fdashboard';
  };

  const account = login ? `@${login}` : 'this account';

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
            GitHub
          </h2>
          <p className="text-sm text-bw-peach-light mt-2">
            {!configured && 'GitHub sign-in is not configured on this deployment.'}
            {configured && !connected && 'Not connected. Sign in with GitHub to analyze issues.'}
            {configured && connected && check === 'reauth_required' &&
              `GitHub no longer accepts this authorization for ${account}.`}
            {configured && connected && check === 'sync_failed' &&
              `Connected as ${account}, but BugWiser could not list your repositories.`}
            {configured && connected && check === 'ok' &&
              `Connected as ${account}.`}
            {configured && connected && check === 'empty' &&
              `Connected as ${account}, but the account can read no repositories.`}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {configured && !connected && (
            <a href="/auth/github?returnTo=%2Fdashboard">
              <Button className="btn-bw-primary font-medium">Sign in with GitHub</Button>
            </a>
          )}

          {configured && connected && (check === 'reauth_required' || check === 'sync_failed') && (
            <Button className="btn-bw-primary font-medium" onClick={authorize} disabled={busy}>
              {busy ? 'Redirecting…' : 'Reconnect GitHub'}
            </Button>
          )}

          {configured && connected && check !== 'reauth_required' && manageUrl && (
            <a href={manageUrl} target="_blank" rel="noreferrer">
              <Button variant="outline" className="font-medium">
                Manage access
              </Button>
            </a>
          )}

          {configured && connected && check === 'ok' && (
            <Button variant="ghost" className="font-medium" onClick={authorize} disabled={busy}>
              {busy ? 'Redirecting…' : 'Reconnect GitHub'}
            </Button>
          )}
        </div>
      </div>

      {configured && connected && check === 'ok' && (
        <p className="text-xs text-bw-dusty-rose mt-3">
          {repositoryCount ?? 0}{' '}
          {repositoryCount === 1 ? 'repository' : 'repositories'} accessible with your
          GitHub account — public, private, and organization repositories you belong to.
        </p>
      )}

      {configured && connected && check === 'reauth_required' && (
        <p className="text-xs text-bw-dusty-rose mt-3">
          Your session is still valid, but the GitHub credential inside it can no longer
          read repositories. Reconnect to authorize BugWiser again.
        </p>
      )}

      {configured && connected && check === 'sync_failed' && (
        <p className="text-xs text-bw-dusty-rose mt-3">
          This is usually a temporary GitHub outage or rate limit. Reconnect to try again;
          the server log names the GitHub error code.
        </p>
      )}

      {!configured && (
        <p className="text-xs text-bw-dusty-rose mt-3">
          Sign-in and repository access are unavailable until the OAuth App credentials
          (<code className="font-mono">GITHUB_CLIENT_ID</code> /{' '}
          <code className="font-mono">GITHUB_CLIENT_SECRET</code>) are set for this
          environment.
        </p>
      )}
    </section>
  );
}
