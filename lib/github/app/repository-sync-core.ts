// Pure repository-synchronization logic. No Supabase, GitHub, or environment
// imports so it can be unit-tested directly.
//
// The route and the sync writer both use these helpers: that keeps the
// "installation exists but no repositories" state distinct from "the sync
// failed", which the UI must never render as a plain empty list.

export interface InstallationRepositoryInput {
  id: number;
  full_name: string;
  owner: { login: string };
  name: string;
  private: boolean;
  default_branch?: string | null;
  html_url?: string | null;
  pushed_at?: string | null;
}

export interface InstallationRepositoryRow {
  installation_id: number;
  repo_id: number;
  full_name: string;
  owner: string;
  name: string;
  private: boolean;
  default_branch: string | null;
  html_url: string | null;
  pushed_at: string | null;
  updated_at: string;
}

/** Builds the upsert rows for one installation's selected repositories. */
export function buildInstallationRepositoryRows(
  installationId: number,
  repositories: InstallationRepositoryInput[],
  updatedAt: string
): InstallationRepositoryRow[] {
  return repositories
    .filter((repo) => Number.isSafeInteger(repo.id) && repo.id > 0 && repo.full_name.includes('/'))
    .map((repo) => ({
      installation_id: installationId,
      repo_id: repo.id,
      full_name: repo.full_name,
      owner: repo.owner.login,
      name: repo.name,
      private: repo.private === true,
      default_branch: repo.default_branch || null,
      html_url: repo.html_url || null,
      pushed_at: repo.pushed_at || null,
      updated_at: updatedAt,
    }));
}

/**
 * Repository access can be removed on GitHub. These ids are stored but no
 * longer selected, so the next listing must not show them.
 */
export function findRemovedRepositoryIds(
  storedIds: number[],
  currentIds: number[]
): number[] {
  const current = new Set(currentIds.filter((id) => Number.isSafeInteger(id)));
  return storedIds
    .filter((id) => Number.isSafeInteger(id) && !current.has(id));
}

export interface RepositoryListStateInput {
  installationCount: number;
  repositoryCount: number;
  /** Per-installation sync failures plus a failed installation enumeration. */
  syncFailureCount: number;
}

export interface RepositoryListState {
  /** No installation is linked to this user yet. */
  requiresInstallation: boolean;
  /** An installation is linked, but it has no selected repositories. */
  requiresRepositorySelection: boolean;
  /** Nothing is visible because synchronization failed: return an error. */
  failWithSyncError: boolean;
}

export function describeRepositoryListState(
  input: RepositoryListStateInput
): RepositoryListState {
  const installationCount = Math.max(0, Math.floor(input.installationCount));
  const repositoryCount = Math.max(0, Math.floor(input.repositoryCount));
  const syncFailureCount = Math.max(0, Math.floor(input.syncFailureCount));

  const failWithSyncError = repositoryCount === 0 && syncFailureCount > 0;
  const requiresInstallation = installationCount === 0 && !failWithSyncError;
  const requiresRepositorySelection =
    installationCount > 0 && repositoryCount === 0 && !failWithSyncError;

  return { requiresInstallation, requiresRepositorySelection, failWithSyncError };
}
