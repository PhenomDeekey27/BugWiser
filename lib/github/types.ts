// GitHub REST payloads used by BugWiser, narrowed to the fields we read.

export interface GitHubApiUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
  email?: string | null;
}

/** Repository object from `GET /user/repos` and `GET /repos/{owner}/{repo}`. */
export interface GitHubApiRepository {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string; avatar_url?: string | null };
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  private: boolean;
  default_branch: string;
  html_url: string;
  pushed_at: string | null;
  updated_at: string;
  /** True for a repository that is a fork of another repository. */
  fork?: boolean;
  /** Present on a fork: the repository it was forked from. */
  parent?: {
    full_name: string;
    owner: { login: string };
    default_branch?: string;
  } | null;
  permissions?: {
    admin?: boolean;
    maintain?: boolean;
    push?: boolean;
    triage?: boolean;
    pull?: boolean;
  };
}

/**
 * Token endpoint response for an OAuth App.
 *
 * `expires_in`/`refresh_token` are only present when the OAuth App has
 * "Expire user access tokens" enabled; without them the token does not expire
 * and must be treated as permanent (`expiresAt = 0` in the session).
 */
export interface GitHubOAuthTokenResponse {
  access_token?: string;
  token_type?: string;
  /** Comma-separated scopes granted by the user. */
  scope?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  error?: string;
  error_description?: string;
  error_uri?: string;
}
