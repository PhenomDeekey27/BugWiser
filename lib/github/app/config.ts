// GitHub App configuration. Server-only. Values are read from the environment
// and never returned to the browser.

export interface GitHubAppConfig {
  appId: number;
  clientId: string;
  clientSecret: string;
  privateKeyPem: string;
  /** Validated installation slug, or null when unset/malformed. */
  slug: string | null;
}

export class GitHubAppConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubAppConfigError';
  }
}

function decodeBase64Pem(raw: string): string | null {
  try {
    const decoded = Buffer.from(raw.trim(), 'base64').toString('utf8').trim();
    return decoded.includes('BEGIN') ? decoded : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the PEM from either variable. `GITHUB_APP_PRIVATE_KEY_BASE64` wins
 * because it survives editors and hosts that strip or reflow newlines. A
 * multi-line `GITHUB_APP_PRIVATE_KEY` must be *quoted* in `.env*`; an unquoted
 * PEM is truncated to its first line by the env loader.
 */
function normalizePrivateKey(): string {
  const base64 = process.env.GITHUB_APP_PRIVATE_KEY_BASE64;
  if (base64) {
    const decoded = decodeBase64Pem(base64);
    if (decoded) return decoded;
  }

  const raw = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!raw) return '';

  // Vercel stores multiline values as literal "\n" sequences when pasted.
  let value = raw.trim().replace(/\\n/g, '\n').trim();

  // A base64-encoded PEM is also accepted in the plain variable.
  if (!value.includes('BEGIN')) {
    const decoded = decodeBase64Pem(value);
    if (decoded) value = decoded;
  }

  return value;
}

const PRIVATE_KEY_BEGIN = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;
const PRIVATE_KEY_END = /-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;
const CERTIFICATE_BEGIN = /-----BEGIN CERTIFICATE-----/;

export type PrivateKeyShape = 'private_key' | 'certificate' | 'other' | 'missing';

/**
 * Distinguishes "no key" from "a key-shaped value that is not a private key".
 * A certificate here was the silent cause of a config that looked complete but
 * could never sign an App JWT.
 */
export function privateKeyShape(pem: string): PrivateKeyShape {
  if (!pem) return 'missing';
  if (PRIVATE_KEY_BEGIN.test(pem) && PRIVATE_KEY_END.test(pem)) return 'private_key';
  if (CERTIFICATE_BEGIN.test(pem)) return 'certificate';
  return 'other';
}

// GitHub App slugs are the last path segment of
// https://github.com/apps/<slug> — never a URL. GitHub's naming rules allow
// alphanumeric characters and single hyphens, and a slug cannot begin or end
// with a hyphen.
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/i;

/**
 * Accepts only a bare GitHub App slug. A full settings URL (the most common
 * misconfiguration), a path, a query string, or an encoded URL is rejected
 * rather than silently turned into a 404 install link.
 */
export function normalizeGitHubAppSlug(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 100) return null;
  if (trimmed.includes('://') || trimmed.includes('--')) return null;
  if (/[/\\?#:@%\s]/.test(trimmed)) return null;
  if (!SLUG_PATTERN.test(trimmed)) return null;

  return trimmed.toLowerCase();
}

/**
 * Human-readable configuration problem, or null when the App can be used.
 * Never includes a secret value, so it is safe to log and to return to a user.
 */
export function getGitHubAppConfigProblem(): string | null {
  const appIdRaw = process.env.GITHUB_APP_ID;
  if (!appIdRaw) return 'GITHUB_APP_ID is missing.';
  const appId = Number(appIdRaw);
  if (!Number.isSafeInteger(appId) || appId <= 0) return 'GITHUB_APP_ID is not a valid App id.';

  if (!process.env.GITHUB_APP_CLIENT_ID) return 'GITHUB_APP_CLIENT_ID is missing.';
  if (!process.env.GITHUB_APP_CLIENT_SECRET) return 'GITHUB_APP_CLIENT_SECRET is missing.';

  const shape = privateKeyShape(normalizePrivateKey());
  if (shape === 'missing') {
    return 'GITHUB_APP_PRIVATE_KEY (or GITHUB_APP_PRIVATE_KEY_BASE64) is missing.';
  }
  if (shape === 'certificate') {
    return 'GITHUB_APP_PRIVATE_KEY contains a certificate, not the App private key PEM.';
  }
  if (shape !== 'private_key') {
    return 'GITHUB_APP_PRIVATE_KEY is not a private key PEM. Set the key from the GitHub App settings (or quote the multi-line value / use GITHUB_APP_PRIVATE_KEY_BASE64).';
  }

  return null;
}

export function getGitHubAppConfig(): GitHubAppConfig | null {
  if (getGitHubAppConfigProblem() !== null) return null;

  const appId = Number(process.env.GITHUB_APP_ID);
  const privateKeyPem = normalizePrivateKey();
  const slug = normalizeGitHubAppSlug(process.env.GITHUB_APP_SLUG);

  return {
    appId,
    clientId: process.env.GITHUB_APP_CLIENT_ID as string,
    clientSecret: process.env.GITHUB_APP_CLIENT_SECRET as string,
    privateKeyPem,
    slug,
  };
}

export function requireGitHubAppConfig(): GitHubAppConfig {
  const config = getGitHubAppConfig();
  if (!config) {
    const problem = getGitHubAppConfigProblem() || 'GitHub App configuration is incomplete.';
    throw new GitHubAppConfigError(`GitHub App is not configured: ${problem}`);
  }
  return config;
}

export function isGitHubAppConfigured(): boolean {
  return getGitHubAppConfig() !== null;
}

/**
 * Builds the canonical installation URL. Returns null when the slug is missing
 * or malformed so callers can explain the problem instead of sending the user
 * to a 404.
 */
export function githubAppInstallUrl(slug?: string | null): string | null {
  const resolved = normalizeGitHubAppSlug(slug ?? process.env.GITHUB_APP_SLUG);
  if (!resolved) return null;
  return `https://github.com/apps/${resolved}/installations/new`;
}
