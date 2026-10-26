import { NextResponse } from 'next/server';
import { PublicRepositoryError, type PublicRepositoryErrorCode } from './public';

const STATUS_BY_CODE: Record<PublicRepositoryErrorCode, number> = {
  invalid_url: 400,
  invalid_issue_url: 400,
  unsupported_host: 400,
  invalid_ref: 400,
  invalid_commit: 400,
  not_found: 404,
  private_repository: 404,
  rate_limited: 429,
  too_large: 413,
  api_error: 502,
};

/** Maps a public GitHub failure onto a stable API response. */
export function publicErrorResponse(error: unknown): NextResponse {
  if (error instanceof PublicRepositoryError) {
    const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
    if (error.code === 'rate_limited' && error.retryAfterSeconds) {
      headers['Retry-After'] = String(Math.max(1, Math.ceil(error.retryAfterSeconds)));
    }
    return NextResponse.json(
      {
        error: error.message,
        code: error.code,
        retryAfterSeconds: error.retryAfterSeconds,
      },
      { status: STATUS_BY_CODE[error.code], headers }
    );
  }

  console.error('[public-github] Unexpected error:', (error as Error)?.message);
  return NextResponse.json(
    { error: 'GitHub could not be reached. Try again later.', code: 'api_error' },
    { status: 502 }
  );
}
