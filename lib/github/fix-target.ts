// Where does an approved fix get pushed, and where does its pull request go?
//
// Reading a public repository never required write access; writing always does.
// The former GitHub App design pushed with an installation token, so the App's
// own permission hid the difference. With the user's OAuth token the difference
// is real, and a read-only contributor must fork.
//
// Rules implemented here, and nowhere else:
//
//   * push to the upstream repository only when GitHub reports push permission
//     for this token, or when the caller explicitly forces `upstream` and GitHub
//     confirms it;
//   * otherwise use the user's existing fork when it is a fork of this upstream,
//     creating one only when there is no usable fork;
//   * base the fix branch on the exact commit the analysis was pinned to; a
//     stale fork is fast-forwarded from upstream first, and when that is not
//     possible the fix is based on the fork's branch head and marked inexact so
//     the patch content checks (not guesswork) decide whether it still applies;
//   * never push to a repository the user cannot write to, and never claim
//     success for a fork that was not verified.
//
// Pure decisions are exported separately so the policy can be tested without a
// network.

import { GitHubError } from './errors.ts';
import { parseRepositoryFullName } from './repository-name.ts';
import {
  commitExists,
  createFork,
  getBranch,
  getRepositoryInfo,
  mergeUpstream,
} from './write.ts';

export type FixTargetMode = 'auto' | 'upstream' | 'fork';

export interface UpstreamRepository {
  owner: string;
  repo: string;
  fullName: string;
  defaultBranch: string;
  canPush: boolean;
  permissionsKnown: boolean;
  private: boolean;
}

export interface FixTarget {
  /** `upstream` = the original repository; `fork` = the user's copy. */
  kind: 'upstream' | 'fork';
  owner: string;
  repo: string;
  fullName: string;
  upstreamOwner: string;
  upstreamRepo: string;
  upstreamFullName: string;
  /** GitHub login that owns the token (the fork owner when a fork is used). */
  login: string;
  /** Where the branch is created and pushed. */
  pushRepoFullName: string;
  /** Where the pull request is opened (always the upstream repository). */
  pullRequestRepoFullName: string;
  baseBranch: string;
  /** Commit the fix branch starts from. */
  baseCommitSha: string;
  /** False when the pinned commit was unavailable and the branch head was used. */
  baseCommitExact: boolean;
  notes: string[];
}

const COMMIT_PATTERN = /^[0-9a-f]{40}$/;

/**
 * Pure target policy. `auto` prefers the upstream repository only when GitHub
 * says this token may push; everything else forks.
 */
export function chooseTargetKind(input: {
  mode: FixTargetMode;
  canPush: boolean;
  permissionsKnown: boolean;
}): 'upstream' | 'fork' {
  if (input.mode === 'upstream') return 'upstream';
  if (input.mode === 'fork') return 'fork';
  if (!input.permissionsKnown) {
    // GitHub withheld `permissions`; attempt the upstream write and let GitHub
    // be the authority rather than forking for no reason.
    return 'upstream';
  }
  return input.canPush ? 'upstream' : 'fork';
}

/** `owner:branch` for a fork PR head; a bare branch for the same repository. */
export function pullRequestHead(owner: string, branch: string, headOwner?: string | null): string {
  const branchOwner = (headOwner || owner).toLowerCase();
  return branchOwner === owner.toLowerCase() ? branch : `${headOwner}:${branch}`;
}

function requireName(fullName: string): { owner: string; repo: string; fullName: string } {
  const parsed = parseRepositoryFullName(fullName);
  if (!parsed.ok) {
    throw new GitHubError('Analysis has an invalid repository name.', 'not_found', { status: 400 });
  }
  return { owner: parsed.owner, repo: parsed.repo, fullName: parsed.fullName };
}

export async function resolveUpstream(
  token: string,
  repositoryFullName: string
): Promise<UpstreamRepository> {
  const parsed = requireName(repositoryFullName);
  const info = await getRepositoryInfo(token, parsed.owner, parsed.repo);
  return {
    owner: info.owner,
    repo: info.name,
    fullName: info.fullName,
    defaultBranch: info.defaultBranch,
    canPush: info.permissions.push === true || info.permissions.admin === true,
    permissionsKnown: info.permissions.push !== undefined || info.permissions.admin !== undefined,
    private: false,
  };
}

/**
 * Resolves the repository to push to and the exact base commit to start from.
 *
 * Throws `GitHubError` with an actionable message when the user has no usable
 * destination (`fork_unavailable` never happens as a code, `forbidden` is used
 * so the route can return 403 without inventing a permission).
 */
export async function resolveFixTarget(input: {
  token: string;
  login: string;
  upstreamFullName: string;
  preferredBranch?: string | null;
  pinnedCommitSha?: string | null;
  mode?: FixTargetMode;
}): Promise<FixTarget> {
  const upstream = await resolveUpstream(input.token, input.upstreamFullName);
  const notes: string[] = [];
  const kind = chooseTargetKind({
    mode: input.mode || 'auto',
    canPush: upstream.canPush,
    permissionsKnown: upstream.permissionsKnown,
  });

  if (kind === 'upstream') {
    if (upstream.permissionsKnown && !upstream.canPush && (input.mode || 'auto') !== 'upstream') {
      // chooseTargetKind cannot produce this, but keep the guard explicit: a
      // push attempt to a repository we already know is read-only is never sent.
      throw new GitHubError(
        'Your GitHub account does not have write access to this repository.',
        'forbidden',
        { status: 403 }
      );
    }

    const baseBranch = input.preferredBranch || upstream.defaultBranch;
    const verified = await resolveBaseCommit(
      input.token,
      upstream.owner,
      upstream.repo,
      baseBranch,
      upstream.defaultBranch,
      input.pinnedCommitSha
    );

    return {
      kind: 'upstream',
      owner: upstream.owner,
      repo: upstream.repo,
      fullName: upstream.fullName,
      upstreamOwner: upstream.owner,
      upstreamRepo: upstream.repo,
      upstreamFullName: upstream.fullName,
      login: input.login,
      pushRepoFullName: upstream.fullName,
      pullRequestRepoFullName: upstream.fullName,
      baseBranch: verified.branch,
      baseCommitSha: verified.sha,
      baseCommitExact: verified.exact,
      notes,
    };
  }

  if ((input.mode || 'auto') === 'fork' && upstream.canPush) {
    notes.push('A fork was requested even though this account can push to the upstream repository.');
  }

  const fork = await resolveFork(input.token, input.login, upstream, notes);
  const baseBranch = input.preferredBranch || upstream.defaultBranch;
  const verified = await resolveBaseCommit(
    input.token,
    fork.owner,
    fork.name,
    baseBranch,
    fork.defaultBranch,
    input.pinnedCommitSha,
    {
      upstreamOwner: upstream.owner,
      upstreamRepo: upstream.repo,
      upstreamBranch: baseBranch,
    }
  );

  return {
    kind: 'fork',
    owner: fork.owner,
    repo: fork.name,
    fullName: fork.fullName,
    upstreamOwner: upstream.owner,
    upstreamRepo: upstream.repo,
    upstreamFullName: upstream.fullName,
    login: input.login,
    pushRepoFullName: fork.fullName,
    pullRequestRepoFullName: upstream.fullName,
    baseBranch: verified.branch,
    baseCommitSha: verified.sha,
    baseCommitExact: verified.exact,
    notes,
  };
}

async function resolveFork(
  token: string,
  login: string,
  upstream: UpstreamRepository,
  notes: string[]
): Promise<{ owner: string; name: string; fullName: string; defaultBranch: string }> {
  if (!login) {
    throw new GitHubError(
      'Sign in with GitHub before creating a fork for this fix.',
      'auth_rejected',
      { status: 401 }
    );
  }

  let existing: Awaited<ReturnType<typeof getRepositoryInfo>> | null = null;
  try {
    existing = await getRepositoryInfo(token, login, upstream.repo);
  } catch (error) {
    if (!(error instanceof GitHubError) || error.code !== 'not_found') throw error;
  }

  if (existing) {
    if (existing.fullName.toLowerCase() === upstream.fullName.toLowerCase()) {
      // The account owns the upstream repository themselves; the upstream path
      // should have been used. Reaching here means a forced fork request.
      throw new GitHubError(
        'This repository is yours, so there is no fork to create. Push the branch to it directly.',
        'forbidden',
        { status: 409 }
      );
    }
    if (existing.fork && existing.parentFullName?.toLowerCase() === upstream.fullName.toLowerCase()) {
      notes.push(`Reused the existing fork ${existing.fullName}.`);
      return {
        owner: existing.owner,
        name: existing.name,
        fullName: existing.fullName,
        defaultBranch: existing.defaultBranch,
      };
    }

    throw new GitHubError(
      `You already own ${existing.fullName}, which is not a fork of ${upstream.fullName}. ` +
        'GitHub cannot create a second fork with the same name; rename or delete that repository, ' +
        'or request write access to the original repository.',
      'forbidden',
      { status: 409 }
    );
  }

  const created = await createFork(token, upstream.owner, upstream.repo);
  notes.push(`Created the fork ${created.fullName}.`);

  const info = await getRepositoryInfo(token, created.owner, created.name);
  return {
    owner: info.owner,
    name: info.name,
    fullName: info.fullName,
    defaultBranch: info.defaultBranch,
  };
}

async function resolveBaseCommit(
  token: string,
  owner: string,
  repo: string,
  preferredBranch: string,
  defaultBranch: string,
  pinnedCommitSha?: string | null,
  upstream?: { upstreamOwner: string; upstreamRepo: string; upstreamBranch: string }
): Promise<{ branch: string; sha: string; exact: boolean }> {
  const requested = await getBranch(token, owner, repo, preferredBranch);
  const fallback =
    requested || preferredBranch === defaultBranch
      ? null
      : await getBranch(token, owner, repo, defaultBranch);
  const branch = requested ? preferredBranch : fallback ? defaultBranch : null;
  const head = requested || fallback;

  if (!branch || !head) {
    throw new GitHubError(
      `The base branch "${preferredBranch}" does not exist on ${owner}/${repo}.`,
      'not_found',
      { status: 409 }
    );
  }

  const pinned =
    typeof pinnedCommitSha === 'string' && COMMIT_PATTERN.test(pinnedCommitSha.toLowerCase())
      ? pinnedCommitSha.toLowerCase()
      : null;

  if (!pinned) {
    return { branch, sha: head.sha, exact: false };
  }

  if (await commitExists(token, owner, repo, pinned)) {
    return { branch, sha: pinned, exact: true };
  }

  // A fork can be behind upstream. Fast-forward it to the analysed branch, then
  // re-check the pinned commit before giving up on exactness.
  if (upstream) {
    const merged = await mergeUpstream(token, owner, repo, upstream.upstreamBranch);
    if (merged.ok && (await commitExists(token, owner, repo, pinned))) {
      return { branch, sha: pinned, exact: true };
    }
  }

  return { branch, sha: head.sha, exact: false };
}
