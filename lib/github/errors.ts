// GitHub API and OAuth configuration errors.
//
// Two kinds of failure are deliberately distinct:
//
//   * `GitHubConfigError` — this deployment is missing its OAuth client id or
//     secret. Nothing the user can do; a 503, never a "sign in again" prompt.
//   * `GitHubError` — a request GitHub answered badly, or a credential GitHub
//     rejected. `codes` are stable so routes can map them to HTTP statuses and
//     the UI can choose a message without ever echoing GitHub's text.
//
// OAuth App authentication means there is no installation token and no App JWT.
// The only credential is the user's own token, so "we cannot act for this user"
// is always `auth_rejected` (the user must authorize again).

export type GitHubErrorCode =
  | 'not_configured'
  /** GitHub rejected the user credential: revoked, expired, or malformed. */
  | 'auth_rejected'
  /** The credential is valid but this resource/permission is not granted. */
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'api_error'
  | 'network_error';

export class GitHubConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubConfigError';
  }
}

export class GitHubError extends Error {
  code: GitHubErrorCode;
  status?: number;
  retryAfterSeconds?: number;

  constructor(
    message: string,
    code: GitHubErrorCode,
    options: { status?: number; retryAfterSeconds?: number } = {}
  ) {
    super(message);
    this.name = 'GitHubError';
    this.code = code;
    this.status = options.status;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

/** Strip anything token-shaped from messages that could reach logs or clients. */
export function sanitizeGitHubMessage(message: string): string {
  return message
    .replace(/\b(gh[pousr]_[A-Za-z0-9_]{8,})\b/g, '[redacted-token]')
    .replace(/\b(github_pat_[A-Za-z0-9_]{8,})\b/g, '[redacted-token]')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[redacted]')
    // The whole header value is secret, including a scheme word such as
    // `token` in front of the credential, so redact to the end of the line.
    .replace(/\b(Authorization:\s*)[^\r\n]+/gi, '$1[redacted]')
    .slice(0, 500);
}

export function isRateLimited(status: number, headers: Headers): boolean {
  if (status === 429) return true;
  return status === 403 && headers.get('x-ratelimit-remaining') === '0';
}

export function retryAfterSeconds(
  status: number,
  headers: Headers,
  nowMs = Date.now()
): number | undefined {
  const retryAfter = headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(1, Math.ceil((date - nowMs) / 1000));
  }

  const reset = headers.get('x-ratelimit-reset');
  if (reset) {
    const timestamp = Number(reset);
    if (Number.isFinite(timestamp)) {
      return Math.max(1, Math.ceil((timestamp * 1000 - nowMs) / 1000));
    }
  }

  return status === 429 ? 60 : undefined;
}
