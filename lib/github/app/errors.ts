export type GitHubAppErrorCode =
  | 'not_configured'
  | 'app_auth_failed'
  | 'installation_not_found'
  | 'installation_suspended'
  | 'installation_forbidden'
  | 'repository_not_found'
  | 'repository_not_authorized'
  | 'missing_permissions'
  | 'rate_limited'
  | 'api_error'
  | 'network_error';

export class GitHubAppError extends Error {
  code: GitHubAppErrorCode;
  status?: number;
  retryAfterSeconds?: number;

  constructor(
    message: string,
    code: GitHubAppErrorCode,
    options: { status?: number; retryAfterSeconds?: number } = {}
  ) {
    super(message);
    this.name = 'GitHubAppError';
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
    .replace(/\b(Authorization:\s*)[^\s,]+/gi, '$1[redacted]')
    .slice(0, 500);
}

export function isRateLimited(status: number, headers: Headers): boolean {
  if (status === 429) return true;
  return status === 403 && headers.get('x-ratelimit-remaining') === '0';
}

export function retryAfterSeconds(status: number, headers: Headers, nowMs = Date.now()): number | undefined {
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
