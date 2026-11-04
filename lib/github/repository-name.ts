// Pure parsing rules for the "owner/name" form BugWiser accepts from clients.
// No GitHub, database, or Next.js imports so the rules are unit-testable.

export type RepositoryNameParse =
  | { ok: true; owner: string; repo: string; fullName: string }
  | { ok: false; reason: 'shape' | 'invalid' };

/**
 * Validates "owner/name" without throwing, so callers choose the error type.
 * The segment rule matches GitHub's own naming limits and rejects path
 * traversal, encoded separators, and whitespace before anything is sent to the
 * GitHub API or used in a query.
 */
export function parseRepositoryFullName(value: string): RepositoryNameParse {
  const trimmed = (value || '').trim();
  const parts = trimmed.split('/');
  if (parts.length !== 2) return { ok: false, reason: 'shape' };

  const [owner, repo] = parts;
  const segment = /^[A-Za-z0-9_.-]{1,100}$/;
  if (!segment.test(owner) || !segment.test(repo)) return { ok: false, reason: 'invalid' };
  if (owner === '.' || owner === '..' || repo === '.' || repo === '..') {
    return { ok: false, reason: 'invalid' };
  }

  return { ok: true, owner, repo, fullName: `${owner}/${repo}` };
}
