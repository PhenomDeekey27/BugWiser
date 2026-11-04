import { NextResponse } from 'next/server';
import { GitHubConfigError, GitHubError } from './errors';

/**
 * HTTP status for a GitHub failure.
 *
 * `auth_rejected` becomes 401 on purpose: it tells every client (and the shared
 * client-session invalidation flow) that only a fresh GitHub authorization can
 * fix the request, instead of inviting a retry that cannot succeed.
 */
export function githubErrorStatus(error: unknown): number {
  if (error instanceof GitHubConfigError) return 503;
  if (error instanceof GitHubError) {
    switch (error.code) {
      case 'not_configured':
        return 503;
      case 'auth_rejected':
        return 401;
      case 'forbidden':
        return 403;
      case 'not_found':
        return 404;
      case 'rate_limited':
        return 429;
      case 'network_error':
      case 'api_error':
      default:
        return 502;
    }
  }
  return 500;
}

export function githubErrorResponse(error: unknown): NextResponse {
  const status = githubErrorStatus(error);

  let code = 'github_error';
  let message = 'GitHub request failed';
  let retryAfterSeconds: number | undefined;

  if (error instanceof GitHubConfigError) {
    code = 'not_configured';
    message = 'GitHub sign-in is not configured on this deployment.';
  } else if (error instanceof GitHubError) {
    code = error.code;
    message = error.message;
    retryAfterSeconds = error.retryAfterSeconds;
  }

  const response = NextResponse.json({ error: message, code }, { status });
  if (retryAfterSeconds) {
    response.headers.set('Retry-After', String(retryAfterSeconds));
  }
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
