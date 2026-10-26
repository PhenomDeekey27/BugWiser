// Clone and compare instructions for a BugWiser fix.
//
// Everything here is derived from data BugWiser already records on `analyses`:
// repository_full_name, repository_branch, repository_commit (the pinned base),
// created_branch, commit_sha and pull_request_url. Nothing is invented.
//
// Two rules shape the output:
//   * A command never contains a credential. Private repositories get plain
//     HTTPS URLs plus a note that the cloning account needs read access.
//   * The fix branch is never assumed to exist in the original repository. When
//     a pull request records a head repository that differs from the base (a
//     fork), the clone commands point at the fork instead.
//
// The planner is pure and the two GitHub readers take an injectable fetch, so
// both can be exercised without a network.

const GITHUB_API_BASE = 'https://api.github.com';
const FULL_SHA = /^[0-9a-f]{40}$/i;
const REPOSITORY_PATTERN = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/;
// `:` and `/` appear in clone URLs; quoting them would only add noise.
const SAFE_SHELL_ARG = /^[A-Za-z0-9._/@:=+-]+$/;

export const CLONE_LIMITS = {
  /** GitHub truncates compare payloads; mirror that so the UI can say so. */
  maxCompareFiles: 200,
} as const;

export interface RepositoryIdentity {
  owner: string;
  repo: string;
  fullName: string;
}

export type FixBranchState =
  | {
      state: 'available';
      branch: string;
      commitSha: string | null;
      /** Head repository. Differs from the base when the fix lives on a fork. */
      repositoryFullName: string | null;
    }
  | {
      state: 'unverified';
      branch: string;
      reason: string;
      repositoryFullName: string | null;
    }
  | { state: 'missing'; reason: string }
  | { state: 'not_created'; reason: string };

export interface CloneTarget {
  kind: 'original' | 'fixed';
  repositoryFullName: string;
  repositoryUrl: string;
  cloneUrl: string;
  branch: string | null;
  commit: string | null;
  directory: string;
  commands: string[];
  /** Public repositories only: an archive needs no auth, private ones do. */
  archiveUrl: string | null;
}

export interface ClonePlan {
  original: CloneTarget;
  fixed: CloneTarget | null;
  fixedState: FixBranchState['state'];
  fixedReason: string | null;
  fixIsFork: boolean;
  fixRepositoryFullName: string | null;
  baseBranch: string | null;
  /** Pinned base commit, or null when the analysis predates commit pinning. */
  baseCommit: string | null;
  fixCommit: string | null;
  isPrivate: boolean;
  compare: {
    commands: string[];
    /** Whether the compare endpoint can serve this pair (same repository). */
    serverSide: boolean;
    githubUrl: string | null;
    note: string;
  };
  warnings: string[];
}

export type ClonePlanErrorCode = 'invalid_repository';

export type ClonePlanResult =
  | { ok: true; plan: ClonePlan }
  | { ok: false; code: ClonePlanErrorCode; message: string };

export interface ClonePlanInput {
  repositoryFullName: string | null;
  /** Recorded HTML URL; only used when the full name is unusable. */
  repositoryUrl?: string | null;
  baseBranch?: string | null;
  baseCommit?: string | null;
  /** Whether the recorded base branch still exists, when it was checked. */
  baseBranchExists?: boolean | null;
  fix: FixBranchState;
  isPrivate: boolean;
}

export function normalizeFullSha(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return FULL_SHA.test(trimmed) ? trimmed.toLowerCase() : null;
}

export function parseRepositoryFullName(
  value: string | null | undefined
): RepositoryIdentity | null {
  if (typeof value !== 'string') return null;
  const match = REPOSITORY_PATTERN.exec(value.trim());
  if (!match) return null;
  return { owner: match[1], repo: match[2], fullName: `${match[1]}/${match[2]}` };
}

/** Extracts owner/repo/number from any pull request URL GitHub returns. */
export function parsePullRequestUrl(
  value: string | null | undefined
): (RepositoryIdentity & { number: number }) | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') return null;
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 4 || parts[2] !== 'pull') return null;
  const identity = parseRepositoryFullName(`${parts[0]}/${parts[1]}`);
  const number = Number(parts[3]);
  if (!identity || !Number.isSafeInteger(number) || number <= 0) return null;
  return { ...identity, number };
}

function shellArg(value: string): string {
  if (SAFE_SHELL_ARG.test(value)) return value;
  const escaped = value.replace(/(["\\])/g, '\\$1').replace(/`/g, '\\`').replace(/\$/g, '\\$');
  return `"${escaped}"`;
}

function cloneUrl(identity: RepositoryIdentity): string {
  return `https://github.com/${identity.fullName}.git`;
}

function htmlUrl(identity: RepositoryIdentity): string {
  return `https://github.com/${identity.fullName}`;
}

function archiveUrl(identity: RepositoryIdentity, commit: string | null, branch: string | null): string | null {
  if (commit) return `https://github.com/${identity.fullName}/archive/${commit}.tar.gz`;
  if (branch) {
    const encoded = branch.split('/').map(encodeURIComponent).join('/');
    return `https://github.com/${identity.fullName}/archive/refs/heads/${encoded}.tar.gz`;
  }
  return null;
}

function buildOriginalTarget(
  identity: RepositoryIdentity,
  input: ClonePlanInput,
  baseCommit: string | null
): CloneTarget {
  const branch = input.baseBranch?.trim() || null;
  // Only ask git for the branch when it was confirmed to exist: `--branch` on a
  // deleted branch fails the whole clone, and the pinned commit is still
  // reachable without it.
  const branchFlag = branch && input.baseBranchExists === true ? ` --branch ${shellArg(branch)}` : '';
  const commands = [
    `git clone${branchFlag} ${shellArg(cloneUrl(identity))} bugwiser-original`,
    'cd bugwiser-original',
  ];
  if (baseCommit) commands.push(`git checkout ${baseCommit}`);

  return {
    kind: 'original',
    repositoryFullName: identity.fullName,
    repositoryUrl: htmlUrl(identity),
    cloneUrl: cloneUrl(identity),
    branch,
    commit: baseCommit,
    directory: 'bugwiser-original',
    commands,
    archiveUrl: input.isPrivate ? null : archiveUrl(identity, baseCommit, branch),
  };
}

function buildFixedTarget(
  identity: RepositoryIdentity,
  fix: Extract<FixBranchState, { state: 'available' | 'unverified' }>,
  isPrivate: boolean
): CloneTarget {
  const commit = fix.state === 'available' ? normalizeFullSha(fix.commitSha) : null;
  const commands = [
    `git clone --branch ${shellArg(fix.branch)} ${shellArg(cloneUrl(identity))} bugwiser-fixed`,
    'cd bugwiser-fixed',
  ];
  if (commit) commands.push(`git checkout ${commit}`);

  return {
    kind: 'fixed',
    repositoryFullName: identity.fullName,
    repositoryUrl: htmlUrl(identity),
    cloneUrl: cloneUrl(identity),
    branch: fix.branch,
    commit,
    directory: 'bugwiser-fixed',
    commands,
    archiveUrl: isPrivate ? null : archiveUrl(identity, commit, fix.branch),
  };
}

function buildCompare(
  baseIdentity: RepositoryIdentity,
  input: ClonePlanInput,
  baseCommit: string | null,
  fix: Extract<FixBranchState, { state: 'available' | 'unverified' }>,
  fixIdentity: RepositoryIdentity,
  isFork: boolean
): ClonePlan['compare'] {
  if (!baseCommit) {
    return {
      commands: [],
      serverSide: false,
      githubUrl: null,
      note:
        'This analysis has no pinned base commit, so a commit-to-commit comparison cannot be built. Re-run the investigation to record one.',
    };
  }

  const fixCommit = fix.state === 'available' ? normalizeFullSha(fix.commitSha) : null;
  const commands = [`git clone ${shellArg(cloneUrl(baseIdentity))} bugwiser-compare`, 'cd bugwiser-compare'];

  if (isFork) {
    commands.push(`git remote add bugwiser-fix ${shellArg(cloneUrl(fixIdentity))}`);
    commands.push(`git fetch bugwiser-fix ${shellArg(fix.branch)}`);
  } else {
    commands.push(`git fetch origin ${shellArg(fix.branch)}`);
  }
  commands.push(`git diff ${baseCommit} FETCH_HEAD`);
  commands.push(`git log --oneline ${baseCommit}..FETCH_HEAD`);

  const encodedBranch = fix.branch.split('/').map(encodeURIComponent).join('/');
  const githubUrl = isFork
    ? `${htmlUrl(baseIdentity)}/compare/${baseCommit}...${encodeURIComponent(fixIdentity.owner)}:${encodedBranch}`
    : `${htmlUrl(baseIdentity)}/compare/${baseCommit}...${encodedBranch}`;

  let note: string;
  if (!fixCommit) {
    note = `The original is pinned to ${baseCommit}. The fix branch head could not be resolved, so the comparison runs against the branch tip fetched as FETCH_HEAD.`;
  } else if (fixCommit === baseCommit) {
    note = `The fix branch is still at the recorded base commit ${baseCommit}: there is nothing to compare.`;
  } else {
    const branchLabel = input.baseBranch?.trim() || 'the base branch';
    note = `The original is pinned to ${baseCommit}${
      input.baseBranch ? ` on ${branchLabel}` : ''
    }. The fix head is ${fixCommit}. The fix branch was cut from the pinned commit, so the comparison leaves out anything pushed to ${branchLabel} after the investigation started.`;
  }

  return {
    commands,
    serverSide: !isFork && Boolean(fixCommit),
    githubUrl,
    note,
  };
}

export function buildClonePlan(input: ClonePlanInput): ClonePlanResult {
  const identity =
    parseRepositoryFullName(input.repositoryFullName) ??
    parseRepositoryFullName(input.repositoryUrl ?? null);

  if (!identity) {
    return {
      ok: false,
      code: 'invalid_repository',
      message:
        'This analysis does not record a usable GitHub repository, so no clone command can be generated.',
    };
  }

  const baseCommit = normalizeFullSha(input.baseCommit);
  const warnings: string[] = [];

  if (!baseCommit) {
    warnings.push(
      'No pinned base commit is recorded for this analysis. The original clone stops at the branch tip, so it may not match what BugWiser investigated.'
    );
  }
  if (input.baseBranch && input.baseBranchExists === false) {
    warnings.push(
      `The recorded base branch "${input.baseBranch}" no longer exists, so the clone command omits --branch and relies on the pinned commit.`
    );
  }
  if (input.isPrivate) {
    warnings.push(
      'This repository is private. The commands use plain HTTPS and contain no credentials; the account running them needs read access (for example after gh auth login).'
    );
  }

  const original = buildOriginalTarget(identity, input, baseCommit);

  let fixed: CloneTarget | null = null;
  let fixIsFork = false;
  let fixRepositoryFullName: string | null = null;
  let fixedReason: string | null = null;

  if (input.fix.state === 'available' || input.fix.state === 'unverified') {
    const fixIdentity =
      parseRepositoryFullName(input.fix.repositoryFullName) ?? identity;
    fixIsFork = fixIdentity.fullName !== identity.fullName;
    fixRepositoryFullName = fixIdentity.fullName;
    fixed = buildFixedTarget(fixIdentity, input.fix, input.isPrivate);

    if (fixIsFork) {
      warnings.push(
        `The fix branch lives on ${fixIdentity.fullName}, not on ${identity.fullName}. Clone it from the fork; the original repository does not contain this branch.`
      );
    }
    if (input.fix.state === 'unverified') {
      warnings.push(input.fix.reason);
      fixedReason = input.fix.reason;
    }
  } else {
    fixedReason = input.fix.reason;
    if (input.fix.state === 'missing') {
      warnings.push(input.fix.reason);
    }
  }

  const fixForCompare =
    input.fix.state === 'available' || input.fix.state === 'unverified' ? input.fix : null;
  const compare = fixForCompare
    ? buildCompare(
        identity,
        input,
        baseCommit,
        fixForCompare,
        parseRepositoryFullName(fixRepositoryFullName) ?? identity,
        fixIsFork
      )
    : {
        commands: [],
        serverSide: false,
        githubUrl: null,
        note:
          fixedReason ??
          'A comparison needs a fix branch. Create one first, then clone both versions.',
      };

  if (!fixed && input.fix.state === 'not_created') {
    warnings.push(input.fix.reason);
  }

  return {
    ok: true,
    plan: {
      original,
      fixed,
      fixedState: input.fix.state,
      fixedReason,
      fixIsFork,
      fixRepositoryFullName,
      baseBranch: input.baseBranch?.trim() || null,
      baseCommit,
      fixCommit: fixed?.commit ?? null,
      isPrivate: input.isPrivate,
      compare,
      warnings,
    },
  };
}

// ── GitHub reads ─────────────────────────────────────────────────────────────

interface ApiResponse {
  status: number;
  data: unknown;
}

async function apiRequest(
  fetchImpl: typeof fetch,
  apiBase: string,
  path: string,
  token: string | null
): Promise<ApiResponse> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'BugWiser',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetchImpl(`${apiBase}${path}`, { headers, cache: 'no-store' });
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  return { status: response.status, data };
}

function encodeBranch(branch: string): string {
  return branch.split('/').map(encodeURIComponent).join('/');
}

export interface CloneContext {
  repository: { fullName: string; isPrivate: boolean; defaultBranch: string | null };
  /** null when the branch could not be checked (rate limit, permission). */
  baseBranchExists: boolean | null;
  fix: FixBranchState;
}

export interface CloneContextInput {
  repositoryFullName: string;
  baseBranch?: string | null;
  fixBranch?: string | null;
  pullRequestUrl?: string | null;
  /** Known public repository: skip the metadata call. */
  knownPublic?: boolean;
  token?: string | null;
  fetchImpl?: typeof fetch;
  apiBase?: string;
}

/**
 * Reads what the plan needs from GitHub: repository visibility, whether the base
 * branch still exists, and where the fix branch currently lives (PR head first,
 * because that is the only record that can point at a fork).
 */
export async function loadCloneContext(input: CloneContextInput): Promise<CloneContext> {
  const identity = parseRepositoryFullName(input.repositoryFullName);
  if (!identity) {
    throw new Error('The analysis does not record a valid GitHub repository.');
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const apiBase = input.apiBase ?? GITHUB_API_BASE;
  const token = input.token ?? null;

  let isPrivate = input.knownPublic ? false : true;
  let defaultBranch: string | null = null;

  if (!input.knownPublic) {
    try {
      const repo = await apiRequest(fetchImpl, apiBase, `/repos/${identity.fullName}`, token);
      if (repo.status === 200 && repo.data && typeof repo.data === 'object') {
        const data = repo.data as { private?: boolean; default_branch?: string };
        isPrivate = Boolean(data.private);
        defaultBranch = data.default_branch || null;
      }
    } catch {
      // Unreadable metadata: stay conservative and treat the repository as
      // private so no archive link is offered.
    }
  }

  let baseBranchExists: boolean | null = null;
  const baseBranch = input.baseBranch?.trim() || null;
  if (baseBranch) {
    try {
      const branch = await apiRequest(
        fetchImpl,
        apiBase,
        `/repos/${identity.fullName}/branches/${encodeBranch(baseBranch)}`,
        token
      );
      if (branch.status === 200) baseBranchExists = true;
      else if (branch.status === 404) baseBranchExists = false;
    } catch {
      baseBranchExists = null;
    }
  }

  const fix = await resolveFixBranch({
    identity,
    fixBranch: input.fixBranch?.trim() || null,
    pullRequestUrl: input.pullRequestUrl ?? null,
    token,
    fetchImpl,
    apiBase,
  });

  return {
    repository: { fullName: identity.fullName, isPrivate, defaultBranch },
    baseBranchExists,
    fix,
  };
}

async function resolveFixBranch(input: {
  identity: RepositoryIdentity;
  fixBranch: string | null;
  pullRequestUrl: string | null;
  token: string | null;
  fetchImpl: typeof fetch;
  apiBase: string;
}): Promise<FixBranchState> {
  if (!input.fixBranch) {
    return {
      state: 'not_created',
      reason:
        'No fix branch has been created for this analysis yet. Push the staged patch to create one.',
    };
  }

  // A pull request is the only record that can say the branch lives on a fork.
  const pull = parsePullRequestUrl(input.pullRequestUrl);
  if (pull) {
    try {
      const response = await apiRequest(
        input.fetchImpl,
        input.apiBase,
        `/repos/${pull.fullName}/pulls/${pull.number}`,
        input.token
      );
      if (response.status === 200 && response.data && typeof response.data === 'object') {
        const data = response.data as {
          head?: { ref?: string; sha?: string; repo?: { full_name?: string } | null };
        };
        const headRef = data.head?.ref;
        const headRepo = parseRepositoryFullName(data.head?.repo?.full_name);
        if (headRef && headRepo && headRepo.fullName !== input.identity.fullName) {
          // The branch is on a fork. Confirm it still exists there: a closed
          // pull request keeps its head ref long after the branch is deleted,
          // and a clone of a missing branch fails for the user.
          const forkBranch = await apiRequest(
            input.fetchImpl,
            input.apiBase,
            `/repos/${headRepo.fullName}/branches/${encodeBranch(headRef)}`,
            input.token
          );
          if (forkBranch.status === 200 && forkBranch.data && typeof forkBranch.data === 'object') {
            const branchData = forkBranch.data as { commit?: { sha?: string } };
            return {
              state: 'available',
              branch: headRef,
              commitSha: normalizeFullSha(branchData.commit?.sha) ?? normalizeFullSha(data.head?.sha),
              repositoryFullName: headRepo.fullName,
            };
          }
          if (forkBranch.status === 404) {
            return {
              state: 'missing',
              reason: `The pull request head branch "${headRef}" no longer exists on ${headRepo.fullName}, so cloning the fix would fail.`,
            };
          }
          return {
            state: 'unverified',
            branch: headRef,
            reason: `GitHub returned ${forkBranch.status} while checking "${headRef}" on ${headRepo.fullName}, so the fork branch could not be confirmed.`,
            repositoryFullName: headRepo.fullName,
          };
        }
        if (headRef) {
          return {
            state: 'available',
            branch: headRef,
            commitSha: normalizeFullSha(data.head?.sha),
            repositoryFullName: headRepo?.fullName ?? input.identity.fullName,
          };
        }
      }
    } catch {
      // Fall through to the branch check below.
    }
  }

  try {
    const response = await apiRequest(
      input.fetchImpl,
      input.apiBase,
      `/repos/${input.identity.fullName}/branches/${encodeBranch(input.fixBranch)}`,
      input.token
    );

    if (response.status === 200 && response.data && typeof response.data === 'object') {
      const data = response.data as { commit?: { sha?: string } };
      return {
        state: 'available',
        branch: input.fixBranch,
        commitSha: normalizeFullSha(data.commit?.sha),
        repositoryFullName: input.identity.fullName,
      };
    }

    if (response.status === 404) {
      return {
        state: 'missing',
        reason: `The recorded fix branch "${input.fixBranch}" was not found on ${input.identity.fullName}. It may have been deleted or renamed, so cloning it would fail.`,
      };
    }

    return {
      state: 'unverified',
      branch: input.fixBranch,
      reason: `GitHub returned ${response.status} while checking "${input.fixBranch}", so the branch could not be confirmed. The command below uses the recorded name and may fail.`,
      repositoryFullName: input.identity.fullName,
    };
  } catch (error) {
    return {
      state: 'unverified',
      branch: input.fixBranch,
      reason: `The fix branch could not be checked (${
        error instanceof Error ? error.message : 'network error'
      }). The command below uses the recorded name and may fail.`,
      repositoryFullName: input.identity.fullName,
    };
  }
}

export interface CompareFileRecord {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  patch: string | null;
}

export interface CompareResult {
  baseCommit: string;
  headCommit: string;
  status: string;
  aheadBy: number;
  behindBy: number;
  totalCommits: number;
  files: CompareFileRecord[];
  truncated: boolean;
  compareUrl: string;
}

export type CompareOutcome =
  | { ok: true; result: CompareResult }
  | { ok: false; code: 'missing_commit' | 'not_found' | 'api_error'; message: string };

export interface CompareInput {
  repositoryFullName: string;
  baseCommit: string | null;
  headCommit: string | null;
  token?: string | null;
  fetchImpl?: typeof fetch;
  apiBase?: string;
}

/** Reads the authoritative base...head diff for two commits in one repository. */
export async function loadCompareFiles(input: CompareInput): Promise<CompareOutcome> {
  const identity = parseRepositoryFullName(input.repositoryFullName);
  const base = normalizeFullSha(input.baseCommit);
  const head = normalizeFullSha(input.headCommit);

  if (!identity) {
    return { ok: false, code: 'missing_commit', message: 'The repository could not be resolved.' };
  }
  if (!base || !head) {
    return {
      ok: false,
      code: 'missing_commit',
      message: 'Both the base commit and the fix commit must be known to compare them.',
    };
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const apiBase = input.apiBase ?? GITHUB_API_BASE;

  let response: ApiResponse;
  try {
    response = await apiRequest(
      fetchImpl,
      apiBase,
      `/repos/${identity.fullName}/compare/${base}...${head}`,
      input.token ?? null
    );
  } catch (error) {
    return {
      ok: false,
      code: 'api_error',
      message: `GitHub could not be reached: ${error instanceof Error ? error.message : 'network error'}.`,
    };
  }

  if (response.status === 404) {
    return {
      ok: false,
      code: 'not_found',
      message: 'One of the commits is no longer reachable in this repository.',
    };
  }
  if (response.status !== 200) {
    return {
      ok: false,
      code: 'api_error',
      message:
        response.status === 401 || response.status === 403
          ? 'GitHub refused the comparison. For a private repository the viewer needs read access.'
          : `GitHub returned ${response.status} while comparing the commits.`,
    };
  }

  const data = (response.data ?? {}) as {
    status?: string;
    ahead_by?: number;
    behind_by?: number;
    total_commits?: number;
    files?: Array<{
      filename?: string;
      status?: string;
      additions?: number;
      deletions?: number;
      patch?: string;
    }>;
  };

  const files = (data.files ?? [])
    .filter((file) => typeof file.filename === 'string' && file.filename.length > 0)
    .map((file) => ({
      path: file.filename as string,
      status: file.status || 'modified',
      additions: file.additions ?? 0,
      deletions: file.deletions ?? 0,
      patch: typeof file.patch === 'string' ? file.patch : null,
    }));

  return {
    ok: true,
    result: {
      baseCommit: base,
      headCommit: head,
      status: data.status || 'identical',
      aheadBy: data.ahead_by ?? 0,
      behindBy: data.behind_by ?? 0,
      totalCommits: data.total_commits ?? 0,
      files: files.slice(0, CLONE_LIMITS.maxCompareFiles),
      truncated: files.length > CLONE_LIMITS.maxCompareFiles,
      compareUrl: `${htmlUrl(identity)}/compare/${base}...${head}`,
    },
  };
}
