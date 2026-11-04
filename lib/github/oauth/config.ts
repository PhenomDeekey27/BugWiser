// GitHub OAuth App configuration. Server-only: the client id is public, the
// client secret never leaves the server and is never logged.
//
// Two variable names are accepted for each value:
//
//   GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET            (documented, preferred)
//   GITHUB_OAUTH_CLIENT_ID / GITHUB_OAUTH_CLIENT_SECRET (explicit alias)
//
// The aliases exist because an existing deployment may already carry an OAuth
// App's credentials under a different name; renaming an environment variable is
// an operational risk for no benefit. `GITHUB_APP_*` is still read as a last
// resort so a deployment that created a GitHub App and switched to OAuth does
// not have to rotate credentials to keep signing users in.

import { GitHubConfigError } from '../errors.ts';

export interface GitHubOAuthConfig {
  clientId: string;
  clientSecret: string;
}

export class GitHubOAuthConfigError extends GitHubConfigError {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubOAuthConfigError';
  }
}

/** Scopes BugWiser requests. `repo` is required for private repositories. */
export const GITHUB_OAUTH_SCOPES = ['read:user', 'repo'] as const;

function firstDefined(names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return '';
}

function clientId(): string {
  return firstDefined([
    'GITHUB_CLIENT_ID',
    'GITHUB_OAUTH_CLIENT_ID',
    'GITHUB_APP_CLIENT_ID',
  ]);
}

function clientSecret(): string {
  return firstDefined([
    'GITHUB_CLIENT_SECRET',
    'GITHUB_OAUTH_CLIENT_SECRET',
    'GITHUB_APP_CLIENT_SECRET',
  ]);
}

/**
 * Human-readable configuration problem, or null when sign-in can work.
 * Never includes a secret value, so it is safe to log and to show a user.
 */
export function getGitHubOAuthConfigProblem(): string | null {
  const id = clientId();
  if (!id) {
    return 'GITHUB_CLIENT_ID is missing.';
  }
  // GitHub OAuth App client ids are 20 alphanumeric characters. A purely
  // numeric value is almost always the GitHub App id pasted by mistake, which
  // produces a GitHub error page instead of a consent screen.
  if (/^\d+$/.test(id)) {
    return 'GITHUB_CLIENT_ID looks like a numeric App id; use the OAuth App Client ID.';
  }
  if (!/^[A-Za-z0-9._-]{8,64}$/.test(id)) {
    return 'GITHUB_CLIENT_ID is not a valid OAuth App client id.';
  }

  const secret = clientSecret();
  if (!secret) return 'GITHUB_CLIENT_SECRET is missing.';
  if (/\s/.test(secret)) return 'GITHUB_CLIENT_SECRET contains whitespace.';

  return null;
}

export function getGitHubOAuthConfig(): GitHubOAuthConfig | null {
  if (getGitHubOAuthConfigProblem() !== null) return null;
  return { clientId: clientId(), clientSecret: clientSecret() };
}

export function requireGitHubOAuthConfig(): GitHubOAuthConfig {
  const config = getGitHubOAuthConfig();
  if (!config) {
    const problem = getGitHubOAuthConfigProblem() || 'GitHub OAuth is not configured.';
    throw new GitHubOAuthConfigError(problem);
  }
  return config;
}

export function isGitHubOAuthConfigured(): boolean {
  return getGitHubOAuthConfig() !== null;
}

/**
 * Where a user revokes or reviews BugWiser's access. Derived from the public
 * client id, so it needs no additional configuration; null when unconfigured.
 */
export function githubOAuthManageUrl(): string | null {
  const id = clientId();
  if (!id || /^\d+$/.test(id)) return null;
  return `https://github.com/settings/connections/applications/${encodeURIComponent(id)}`;
}
