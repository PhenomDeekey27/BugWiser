// Public GitHub repository access.
//
// Everything here works without a GitHub App installation: only the public
// REST API is used, optionally with the deployment's own read token for a
// higher rate limit. Nothing in this module can write to GitHub.
//
// The URL parser and ref validator are pure so they can be unit tested without
// a network or request context.

const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_HOSTS = new Set(['github.com', 'www.github.com']);
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;

export const PUBLIC_REPOSITORY_LIMITS = {
  maxTreeEntries: 50_000,
  maxFileBytes: 512 * 1024,
  maxTotalSourceBytes: 4 * 1024 * 1024,
  maxBranches: 300,
  maxFilesToFetch: 15,
} as const;

export type PublicRepositoryErrorCode =
  | 'invalid_url'
  | 'invalid_issue_url'
  | 'unsupported_host'
  | 'invalid_ref'
  | 'invalid_commit'
  | 'not_found'
  | 'private_repository'
  | 'rate_limited'
  | 'too_large'
  | 'api_error';

export class PublicRepositoryError extends Error {
  code: PublicRepositoryErrorCode;
  status: number | null;
  retryAfterSeconds: number | null;

  constructor(
    message: string,
    code: PublicRepositoryErrorCode,
    options: { status?: number | null; retryAfterSeconds?: number | null } = {}
  ) {
    super(message);
    this.name = 'PublicRepositoryError';
    this.code = code;
    this.status = options.status ?? null;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}

export interface ParsedRepositoryUrl {
  owner: string;
  repo: string;
  fullName: string;
  htmlUrl: string;
  /** Present when the URL pointed at a branch/tag (`/tree/<ref>`). */
  ref: string | null;
}

export interface ParsedIssueUrl {
  owner: string;
  repo: string;
  fullName: string;
  number: number;
  htmlUrl: string;
}

export interface PublicRepositorySummary {
  repoId: number;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  description: string;
  language: string | null;
  stars: number;
  forks: number;
  private: false;
  htmlUrl: string;
  pushedAt: string | null;
  updatedAt: string | null;
}

export interface PublicBranch {
  name: string;
  sha: string;
  protected: boolean;
}

export interface ResolvedPublicRef {
  ref: string;
  commitSha: string;
  committedAt: string | null;
  message: string;
  htmlUrl: string;
}

export interface PublicTreeEntry {
  path: string;
  mode: string;
  type: string;
  size?: number;
  sha: string;
}

export interface PublicFile {
  path: string;
  content: string;
  bytes: number;
  sha: string;
}

export interface PublicIssue {
  number: number;
  title: string;
  body: string;
  state: string;
  labels: string[];
  author: string;
  createdAt: string;
  updatedAt: string;
  commentsCount: number;
  htmlUrl: string;
}

export interface PublicIssueComment {
  id: number;
  author: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
}

export interface PublicIssueSummary {
  number: number;
  title: string;
  state: string;
  labels: string[];
  author: string;
  commentsCount: number;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
}

export interface PublicGitHubOptions {
  /** Optional deployment read token. Never a user's token. */
  token?: string | null;
  fetchImpl?: typeof fetch;
  apiBase?: string;
  limits?: Partial<typeof PUBLIC_REPOSITORY_LIMITS>;
}

function invalidUrl(message: string): never {
  throw new PublicRepositoryError(message, 'invalid_url');
}

function validateOwnerRepo(owner: string, repo: string): void {
  if (!OWNER_PATTERN.test(owner)) {
    invalidUrl('Repository owner is not a valid GitHub account name.');
  }
  if (!REPO_PATTERN.test(repo) || repo === '.' || repo === '..' || repo.includes('..')) {
    invalidUrl('Repository name is not valid.');
  }
}

/**
 * Accepts the forms a user actually pastes:
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo.git
 *   https://github.com/owner/repo/tree/branch-name
 *   git@github.com:owner/repo.git
 *   owner/repo
 *
 * Anything else — other hosts, credentials, ports, query strings, issue URLs —
 * is rejected instead of being coerced into something plausible.
 */
export function parsePublicRepositoryUrl(input: string): ParsedRepositoryUrl {
  if (typeof input !== 'string') invalidUrl('Repository URL must be a string.');
  const raw = input.trim();
  if (raw.length === 0) invalidUrl('Repository URL is required.');
  if (raw.length > 300) invalidUrl('Repository URL is too long.');
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) invalidUrl('Repository URL contains invalid characters.');

  let path: string;

  if (/^git@github\.com:/i.test(raw)) {
    path = raw.replace(/^git@github\.com:/i, '');
  } else if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw)) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      invalidUrl('Repository URL is malformed.');
    }

    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new PublicRepositoryError(
        'Only GitHub web URLs are supported.',
        'unsupported_host'
      );
    }
    if (url.username || url.password) {
      invalidUrl('Repository URL must not contain credentials.');
    }
    if (url.port) invalidUrl('Repository URL must not contain a port.');
    if (!GITHUB_HOSTS.has(url.hostname.toLowerCase())) {
      throw new PublicRepositoryError(
        'Only public repositories on github.com are supported.',
        'unsupported_host'
      );
    }
    if (url.search || url.hash) {
      invalidUrl('Repository URL must not contain a query string or fragment.');
    }
    path = url.pathname;
  } else {
    if (raw.startsWith('//') || raw.includes('://')) {
      invalidUrl('Repository URL is malformed.');
    }
    path = raw;
  }

  const trimmed = path.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!trimmed) invalidUrl('Repository URL is missing the owner and repository.');

  const parts = trimmed.split('/');
  if (parts.some((part) => part.length === 0)) {
    invalidUrl('Repository URL contains an empty path segment.');
  }

  const owner = parts[0];
  let repo = parts[1];
  if (!repo) invalidUrl('Repository URL is missing the repository name.');

  if (repo.toLowerCase().endsWith('.git')) repo = repo.slice(0, -4);
  validateOwnerRepo(owner, repo);

  let ref: string | null = null;
  if (parts.length > 2) {
    if (parts[2] !== 'tree' || parts.length < 4) {
      invalidUrl('Repository URL must point at the repository or a branch tree.');
    }
    const refParts = parts.slice(3);
    let decoded: string;
    try {
      decoded = refParts.map((part) => decodeURIComponent(part)).join('/');
    } catch {
      invalidUrl('Repository URL contains an invalid encoded branch name.');
    }
    if (!isValidGitRef(decoded)) {
      throw new PublicRepositoryError('Branch name in the URL is not valid.', 'invalid_ref');
    }
    ref = decoded;
  }

  return {
    owner,
    repo,
    fullName: `${owner}/${repo}`,
    htmlUrl: `https://github.com/${owner}/${repo}`,
    ref,
  };
}

/** `owner/repo#123` or a full GitHub issue URL. */
export function parseGitHubIssueUrl(input: string): ParsedIssueUrl {
  if (typeof input !== 'string') {
    throw new PublicRepositoryError('Issue URL must be a string.', 'invalid_issue_url');
  }
  const raw = input.trim();
  if (!raw) {
    throw new PublicRepositoryError('Issue URL is empty.', 'invalid_issue_url');
  }

  const shorthand = raw.match(/^([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})#(\d{1,10})$/);
  if (shorthand) {
    const number = Number(shorthand[3]);
    if (!Number.isSafeInteger(number) || number <= 0) {
      throw new PublicRepositoryError('Issue number is not valid.', 'invalid_issue_url');
    }
    validateOwnerRepo(shorthand[1], shorthand[2]);
    return {
      owner: shorthand[1],
      repo: shorthand[2],
      fullName: `${shorthand[1]}/${shorthand[2]}`,
      number,
      htmlUrl: `https://github.com/${shorthand[1]}/${shorthand[2]}/issues/${number}`,
    };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PublicRepositoryError('Issue URL is malformed.', 'invalid_issue_url');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new PublicRepositoryError('Issue URL must use http(s).', 'invalid_issue_url');
  }
  if (url.username || url.password || url.port) {
    throw new PublicRepositoryError('Issue URL must not contain credentials or a port.', 'invalid_issue_url');
  }
  if (!GITHUB_HOSTS.has(url.hostname.toLowerCase())) {
    throw new PublicRepositoryError('Only github.com issue URLs are supported.', 'unsupported_host');
  }
  if (url.search || url.hash) {
    throw new PublicRepositoryError('Issue URL must not contain a query string or fragment.', 'invalid_issue_url');
  }

  const parts = url.pathname.replace(/^\/+/, '').replace(/\/+$/, '').split('/');
  if (parts.length !== 4 || parts[2] !== 'issues') {
    throw new PublicRepositoryError(
      'Issue URL must look like https://github.com/owner/repo/issues/123.',
      'invalid_issue_url'
    );
  }

  const [owner, repo, , numberRaw] = parts;
  validateOwnerRepo(owner, repo);
  if (!/^\d{1,10}$/.test(numberRaw)) {
    throw new PublicRepositoryError('Issue number is not valid.', 'invalid_issue_url');
  }
  const number = Number(numberRaw);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new PublicRepositoryError('Issue number is not valid.', 'invalid_issue_url');
  }

  return {
    owner,
    repo,
    fullName: `${owner}/${repo}`,
    number,
    htmlUrl: `https://github.com/${owner}/${repo}/issues/${number}`,
  };
}

/** Mirrors `git check-ref-format` for branch/tag names we accept. */
export function isValidGitRef(ref: string): boolean {
  if (typeof ref !== 'string') return false;
  if (ref.length === 0 || ref.length > 255) return false;
  if (ref === '@') return false;
  if (ref.startsWith('/') || ref.endsWith('/') || ref.endsWith('.')) return false;
  if (ref.startsWith('-')) return false;
  if (ref.includes('..') || ref.includes('//') || ref.includes('@{')) return false;
  if (ref.toLowerCase().endsWith('.lock')) return false;
  if (/[\u0000-\u001f\u007f ~^:?*[\\]/.test(ref)) return false;
  if (ref.split('/').some((part) => part.length === 0 || part.startsWith('.'))) return false;
  return true;
}

export function normalizeCommitSha(value: string): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return COMMIT_SHA_PATTERN.test(normalized) ? normalized : null;
}

function apiPath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

function rateLimitFromHeaders(headers: Headers): number | null {
  const remaining = headers.get('x-ratelimit-remaining');
  if (remaining !== null && remaining !== '0') return null;

  const reset = Number(headers.get('x-ratelimit-reset'));
  const retryAfter = Number(headers.get('retry-after'));
  const nowSeconds = Math.floor(Date.now() / 1000);

  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter;
  if (Number.isFinite(reset) && reset > nowSeconds) return reset - nowSeconds;
  return 60;
}

async function publicRequest<T>(
  path: string,
  options: PublicGitHubOptions = {},
  accept = 'application/vnd.github+json'
): Promise<{ data: T; headers: Headers }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = options.apiBase ?? GITHUB_API_BASE;
  const url = `${base}${apiPath(path)}`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: accept,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'BugWiser',
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      cache: 'no-store',
    });
  } catch {
    throw new PublicRepositoryError(
      'GitHub could not be reached. Check the network and try again.',
      'api_error'
    );
  }

  if (!response.ok) {
    const retryAfter = rateLimitFromHeaders(response.headers);
    if (response.status === 429 || (response.status === 403 && retryAfter !== null)) {
      throw new PublicRepositoryError(
        retryAfter
          ? `GitHub rate limit reached. Try again in ${Math.max(1, retryAfter)} seconds.`
          : 'GitHub rate limit reached. Try again later.',
        'rate_limited',
        { status: response.status, retryAfterSeconds: retryAfter }
      );
    }
    if (response.status === 451) {
      throw new PublicRepositoryError(
        'This repository is not available publicly (it may be private or blocked).',
        'private_repository',
        { status: response.status }
      );
    }
    if (response.status === 404) {
      throw new PublicRepositoryError(
        'Repository or resource not found. Private repositories are not supported here.',
        'not_found',
        { status: response.status }
      );
    }
    if (response.status === 409) {
      throw new PublicRepositoryError(
        'The repository is empty or has no commits.',
        'not_found',
        { status: response.status }
      );
    }
    throw new PublicRepositoryError(
      `GitHub returned ${response.status}.`,
      'api_error',
      { status: response.status }
    );
  }

  if (accept.includes('raw')) {
    const text = await response.text();
    return { data: text as unknown as T, headers: response.headers };
  }

  return { data: (await response.json()) as T, headers: response.headers };
}

export async function fetchPublicRepository(
  owner: string,
  repo: string,
  options: PublicGitHubOptions = {}
): Promise<PublicRepositorySummary> {
  validateOwnerRepo(owner, repo);

  const { data } = await publicRequest<{
    id: number;
    full_name: string;
    name: string;
    owner: { login: string };
    default_branch: string;
    description: string | null;
    language: string | null;
    stargazers_count: number;
    forks_count: number;
    private: boolean;
    html_url: string;
    pushed_at: string | null;
    updated_at: string | null;
  }>(`/repos/${owner}/${repo}`, options);

  if (data.private) {
    throw new PublicRepositoryError(
      'This repository is private. Public import only supports public repositories.',
      'private_repository'
    );
  }

  return {
    repoId: data.id,
    owner: data.owner?.login || owner,
    name: data.name,
    fullName: data.full_name,
    defaultBranch: data.default_branch || 'main',
    description: data.description || '',
    language: data.language,
    stars: data.stargazers_count ?? 0,
    forks: data.forks_count ?? 0,
    private: false,
    htmlUrl: data.html_url,
    pushedAt: data.pushed_at,
    updatedAt: data.updated_at,
  };
}

export async function fetchPublicBranches(
  owner: string,
  repo: string,
  options: PublicGitHubOptions = {}
): Promise<PublicBranch[]> {
  const limit = Math.min(
    options.limits?.maxBranches ?? PUBLIC_REPOSITORY_LIMITS.maxBranches,
    300
  );
  const perPage = Math.min(100, limit);
  const branches: PublicBranch[] = [];

  for (let page = 1; branches.length < limit && page <= 3; page++) {
    const { data } = await publicRequest<
      Array<{ name: string; commit: { sha: string }; protected?: boolean }>
    >(`/repos/${owner}/${repo}/branches?per_page=${perPage}&page=${page}`, options);

    if (!Array.isArray(data) || data.length === 0) break;
    for (const branch of data) {
      branches.push({
        name: branch.name,
        sha: branch.commit?.sha || '',
        protected: branch.protected === true,
      });
      if (branches.length >= limit) break;
    }
    if (data.length < perPage) break;
  }

  return branches;
}

export async function resolvePublicRef(
  owner: string,
  repo: string,
  ref: string,
  options: PublicGitHubOptions = {}
): Promise<ResolvedPublicRef> {
  if (!isValidGitRef(ref)) {
    throw new PublicRepositoryError('Branch name is not valid.', 'invalid_ref');
  }

  const { data } = await publicRequest<{
    sha: string;
    html_url: string;
    commit: { message: string; committer: { date: string } | null };
  }>(`/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`, options);

  const commitSha = normalizeCommitSha(data.sha);
  if (!commitSha) {
    throw new PublicRepositoryError(
      'GitHub returned an invalid commit for this branch.',
      'api_error'
    );
  }

  return {
    ref,
    commitSha,
    committedAt: data.commit?.committer?.date || null,
    message: data.commit?.message || '',
    htmlUrl: data.html_url,
  };
}

export async function resolvePublicCommit(
  owner: string,
  repo: string,
  commitSha: string,
  options: PublicGitHubOptions = {}
): Promise<ResolvedPublicRef> {
  const sha = normalizeCommitSha(commitSha);
  if (!sha) {
    throw new PublicRepositoryError(
      'Commit must be a full 40-character SHA.',
      'invalid_commit'
    );
  }
  return resolvePublicRef(owner, repo, sha, options);
}

export async function fetchPublicTreeAtCommit(
  owner: string,
  repo: string,
  commitSha: string,
  options: PublicGitHubOptions = {}
): Promise<{ tree: PublicTreeEntry[]; truncated: boolean; commitSha: string }> {
  const sha = normalizeCommitSha(commitSha);
  if (!sha) {
    throw new PublicRepositoryError('Commit must be a full 40-character SHA.', 'invalid_commit');
  }

  const { data } = await publicRequest<{
    sha: string;
    tree: PublicTreeEntry[];
    truncated: boolean;
  }>(`/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`, options);

  const maxEntries = options.limits?.maxTreeEntries ?? PUBLIC_REPOSITORY_LIMITS.maxTreeEntries;
  if (data.truncated) {
    throw new PublicRepositoryError(
      `Repository tree is too large to index safely (GitHub truncated it above ${maxEntries.toLocaleString()} entries).`,
      'too_large'
    );
  }
  if (!Array.isArray(data.tree)) {
    throw new PublicRepositoryError('GitHub returned no tree for this commit.', 'api_error');
  }
  if (data.tree.length > maxEntries) {
    throw new PublicRepositoryError(
      `Repository has ${data.tree.length.toLocaleString()} entries, above the ${maxEntries.toLocaleString()} limit.`,
      'too_large'
    );
  }

  return { tree: data.tree, truncated: false, commitSha: sha };
}

function safeContentPath(path: string): string {
  if (typeof path !== 'string' || path.length === 0 || path.length > 500) {
    throw new PublicRepositoryError('File path is not valid.', 'api_error');
  }
  if (
    path.startsWith('/') ||
    path.includes('\\') ||
    path.split('/').some((part) => part === '' || part === '.' || part === '..') ||
    /[\u0000-\u001f\u007f]/.test(path)
  ) {
    throw new PublicRepositoryError('File path is not valid.', 'api_error');
  }
  return path
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

export async function fetchPublicFileAtCommit(
  owner: string,
  repo: string,
  path: string,
  commitSha: string,
  options: PublicGitHubOptions = {}
): Promise<PublicFile> {
  const sha = normalizeCommitSha(commitSha);
  if (!sha) {
    throw new PublicRepositoryError('Commit must be a full 40-character SHA.', 'invalid_commit');
  }

  const maxBytes = options.limits?.maxFileBytes ?? PUBLIC_REPOSITORY_LIMITS.maxFileBytes;
  const encodedPath = safeContentPath(path);

  const { data, headers } = await publicRequest<string>(
    `/repos/${owner}/${repo}/contents/${encodedPath}?ref=${sha}`,
    options,
    'application/vnd.github.raw+json'
  );

  const content = typeof data === 'string' ? data : '';
  const bytes = Buffer.byteLength(content, 'utf8');

  if (bytes > maxBytes) {
    throw new PublicRepositoryError(
      `${path} is ${bytes.toLocaleString()} bytes, above the ${maxBytes.toLocaleString()} byte source limit.`,
      'too_large'
    );
  }

  return {
    path,
    content,
    bytes,
    sha: headers.get('etag')?.replace(/"/g, '') || '',
  };
}

export async function fetchPublicIssue(
  owner: string,
  repo: string,
  issueNumber: number,
  options: PublicGitHubOptions = {}
): Promise<PublicIssue> {
  if (!Number.isSafeInteger(issueNumber) || issueNumber <= 0) {
    throw new PublicRepositoryError('Issue number is not valid.', 'invalid_issue_url');
  }

  const { data } = await publicRequest<{
    number: number;
    title: string;
    body: string | null;
    state: string;
    labels: Array<{ name: string }>;
    user: { login: string };
    created_at: string;
    updated_at: string;
    comments: number;
    html_url: string;
  }>(`/repos/${owner}/${repo}/issues/${issueNumber}`, options);

  // GitHub serves pull requests from the issues endpoint; importing a PR as an
  // issue would silently change what is being investigated.
  if (data.html_url.includes('/pull/')) {
    throw new PublicRepositoryError(
      'The URL points at a pull request, not an issue.',
      'invalid_issue_url'
    );
  }

  return {
    number: data.number,
    title: data.title,
    body: data.body || '',
    state: data.state,
    labels: (data.labels || []).map((label) => label.name),
    author: data.user?.login || '',
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    commentsCount: data.comments ?? 0,
    htmlUrl: data.html_url,
  };
}

/**
 * Lists issues for a public repository so the user can pick one without
 * pasting a URL. Pull requests are filtered out: GitHub serves both from the
 * issues endpoint, and investigating a PR as an issue changes the question.
 */
export async function fetchPublicIssues(
  owner: string,
  repo: string,
  options: PublicGitHubOptions = {},
  filters: { state?: 'open' | 'closed' | 'all'; perPage?: number } = {}
): Promise<PublicIssueSummary[]> {
  validateOwnerRepo(owner, repo);

  const state = filters.state === 'closed' || filters.state === 'all' ? filters.state : 'open';
  const perPage = Math.min(Math.max(Math.trunc(filters.perPage ?? 30), 1), 50);

  const { data } = await publicRequest<
    Array<{
      number: number;
      title: string;
      state: string;
      labels: Array<{ name: string }> | null;
      user: { login: string } | null;
      created_at: string;
      updated_at: string;
      comments: number | null;
      html_url: string;
      pull_request?: unknown;
    }>
  >(
    `/repos/${owner}/${repo}/issues?state=${state}&sort=updated&direction=desc&per_page=${perPage}`,
    options
  );

  return (data || [])
    .filter((issue) => !issue.pull_request)
    .map((issue) => ({
      number: issue.number,
      title: issue.title,
      state: issue.state,
      labels: (issue.labels || []).map((label) => label.name),
      author: issue.user?.login || '',
      commentsCount: issue.comments ?? 0,
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
      htmlUrl: issue.html_url,
    }));
}

export async function fetchPublicIssueComments(
  owner: string,
  repo: string,
  issueNumber: number,
  options: PublicGitHubOptions = {}
): Promise<PublicIssueComment[]> {
  const { data } = await publicRequest<
    Array<{
      id: number;
      user: { login: string } | null;
      body: string | null;
      created_at: string;
      updated_at: string;
      html_url: string;
    }>
  >(`/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=50`, options);

  return (data || []).map((comment) => ({
    id: comment.id,
    author: comment.user?.login || '',
    body: comment.body || '',
    createdAt: comment.created_at,
    updatedAt: comment.updated_at,
    htmlUrl: comment.html_url,
  }));
}
