import { NextResponse } from 'next/server';
import { GitHubAppConfigError } from './config';
import { GitHubAppError } from './errors';

export function githubErrorStatus(error: unknown): number {
  if (error instanceof GitHubAppConfigError) return 503;
  if (error instanceof GitHubAppError) {
    switch (error.code) {
      case 'not_configured':
        return 503;
      case 'app_auth_failed':
        return 401;
      case 'installation_forbidden':
      case 'repository_not_authorized':
      case 'missing_permissions':
        return 403;
      case 'installation_suspended':
        return 409;
      case 'installation_not_found':
      case 'repository_not_found':
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

  if (error instanceof GitHubAppConfigError) {
    code = 'not_configured';
    message = 'GitHub App is not configured on this deployment.';
  } else if (error instanceof GitHubAppError) {
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
