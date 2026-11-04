// Public-origin resolution for OAuth redirects. Pure so the per-environment
// behaviour (production URL, callback override, request origin fallback) can be
// tested without a Next.js request context.

export interface AppUrlEnv {
  NEXT_PUBLIC_APP_URL?: string;
  APP_URL?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
  GITHUB_CALLBACK_URL?: string;
  /** Older name kept as a fallback so a deployment keeps its registered URL. */
  GITHUB_APP_CALLBACK_URL?: string;
  /** Allows passing `process.env` directly. */
  [key: string]: string | undefined;
}

export const DEFAULT_APP_BASE_URL = 'http://localhost:3000';

export function resolveAppBaseUrl(env: AppUrlEnv, requestUrl?: string): string {
  const configured =
    env.NEXT_PUBLIC_APP_URL ||
    env.APP_URL ||
    (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : '');
  if (configured) return configured.replace(/\/+$/, '');
  if (requestUrl) {
    try {
      return new URL(requestUrl).origin;
    } catch {
      return DEFAULT_APP_BASE_URL;
    }
  }
  return DEFAULT_APP_BASE_URL;
}

/**
 * The `redirect_uri` sent to GitHub. It must match a callback URL registered on
 * the OAuth App, so an explicit override wins over the derived value. The
 * endpoint path is the same one the former GitHub App used, so an existing
 * registration stays valid.
 */
export function resolveGitHubCallbackUrl(env: AppUrlEnv, requestUrl?: string): string {
  const configured = env.GITHUB_CALLBACK_URL || env.GITHUB_APP_CALLBACK_URL;
  if (configured) return configured;
  return `${resolveAppBaseUrl(env, requestUrl)}/api/auth/callback`;
}
