// Sanitized server-side logging for the GitHub App flow.
//
// Callers pass only non-secret values (ids, counts, codes, logins). Messages
// from GitHub are stripped of token-shaped strings, collapsed to one line, and
// truncated before they reach the log.

import { GitHubAppConfigError } from './config';
import { GitHubAppError, sanitizeGitHubMessage } from './errors';

type LogField = string | number | boolean | null | undefined;

const MAX_MESSAGE_LENGTH = 300;

export function sanitizeLogValue(value: string): string {
  const cleaned = sanitizeGitHubMessage(value)
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
  return cleaned.length > MAX_MESSAGE_LENGTH
    ? `${cleaned.slice(0, MAX_MESSAGE_LENGTH)}...`
    : cleaned;
}

function formatFields(fields: Record<string, LogField>): string {
  return Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) =>
      typeof value === 'string' ? `${key}=${sanitizeLogValue(value)}` : `${key}=${String(value)}`
    )
    .join(' ');
}

export function githubErrorCode(error: unknown): string {
  if (error instanceof GitHubAppConfigError) return 'not_configured';
  if (error instanceof GitHubAppError) return error.code;
  return 'unexpected_error';
}

export function githubErrorMessage(error: unknown): string {
  if (error instanceof Error) return sanitizeLogValue(error.message);
  return 'Unknown error';
}

/** One-line informational event. */
export function logGitHubEvent(
  scope: string,
  event: string,
  fields: Record<string, LogField> = {}
): void {
  console.info(`[${scope}] ${event} ${formatFields(fields)}`.trimEnd());
}

/** One-line failure event with a stable machine code and sanitized message. */
export function logGitHubError(
  scope: string,
  event: string,
  error: unknown,
  fields: Record<string, LogField> = {}
): void {
  console.error(
    `[${scope}] ${event} ${formatFields({
      ...fields,
      code: githubErrorCode(error),
      message: githubErrorMessage(error),
    })}`.trimEnd()
  );
}
