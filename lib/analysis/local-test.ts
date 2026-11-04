// Local reproduction instructions: clone the repository at the recorded base
// commit and apply the proposed fix so the developer can run the project's own
// tests before anything is pushed to GitHub.
//
// Two modes, because the fix exists in two different forms:
//
//   patch  - the fix was applied in the isolated workspace but never pushed.
//            The patch is rendered from the staged files and applied with
//            `git apply`, so nothing depends on a remote branch.
//   branch - the fix was pushed. The branch (or its exact commit) is fetched
//            and checked out, which is byte-identical to what was pushed.
//
// Neither mode invents a test command: the repository's verification plan is
// used when one was generated, and otherwise the plan says plainly that no test
// command is known.

const FULL_SHA = /^[0-9a-f]{40}$/i;
const REPOSITORY_PATTERN = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/;
const SAFE_SHELL_ARG = /^[A-Za-z0-9._/@:=+-]+$/;

export interface LocalTestStagedFile {
  path: string;
  diff: string;
}

export interface LocalTestVerificationCommand {
  name: string;
  command: string;
}

export type LocalTestMode = 'patch' | 'branch';

export interface LocalTestPlan {
  available: true;
  mode: LocalTestMode;
  repositoryFullName: string;
  baseBranch: string | null;
  baseCommit: string | null;
  fixBranch: string | null;
  fixCommit: string | null;
  /** The directory the commands clone into. */
  directory: string;
  cloneCommands: string[];
  /** Rendered `.patch` content, patch mode only. */
  patchFile: { name: string; content: string; fileCount: number } | null;
  applyCommands: string[];
  testCommands: LocalTestVerificationCommand[];
  notes: string[];
}

export type LocalTestPlanResult =
  | LocalTestPlan
  | { available: false; reason: string };

export interface LocalTestInput {
  repositoryFullName: string | null;
  baseBranch?: string | null;
  baseCommit?: string | null;
  /** Set once the fix was pushed. */
  fix?: { branch: string | null; commitSha: string | null } | null;
  /** Staged workspace files, when the fix was applied locally. */
  stagedFiles?: LocalTestStagedFile[] | null;
  verification?: { commands?: LocalTestVerificationCommand[] | null } | null;
}

function shellArg(value: string): string {
  if (SAFE_SHELL_ARG.test(value)) return value;
  return `"${value.replace(/(["\\])/g, '\\$1').replace(/`/g, '\\`').replace(/\$/g, '\\$')}"`;
}

export function normalizeSha(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return FULL_SHA.test(trimmed) ? trimmed.toLowerCase() : null;
}

/** Joins staged per-file diffs into one patch `git apply` can read. */
export function buildPatchFile(files: LocalTestStagedFile[]): string | null {
  const usable = (files || []).filter(
    (file) => file && typeof file.diff === 'string' && file.diff.trim().length > 0
  );
  if (usable.length === 0) return null;
  return `${usable.map((file) => file.diff.replace(/\s+$/, '')).join('\n')}\n`;
}

export function buildLocalTestPlan(input: LocalTestInput): LocalTestPlanResult {
  const match = REPOSITORY_PATTERN.exec((input.repositoryFullName || '').trim());
  if (!match) {
    return {
      available: false,
      reason: 'This analysis does not record a usable GitHub repository, so it cannot be cloned.',
    };
  }

  const fullName = `${match[1]}/${match[2]}`;
  const cloneUrl = `https://github.com/${fullName}.git`;
  const baseBranch = input.baseBranch?.trim() || null;
  const baseCommit = normalizeSha(input.baseCommit);
  const fixBranch = input.fix?.branch?.trim() || null;
  const fixCommit = normalizeSha(input.fix?.commitSha);
  const directory = 'bugwiser-test';
  const notes: string[] = [];

  const testCommands = (input.verification?.commands || [])
    .filter((command) => command && typeof command.command === 'string' && command.command.trim())
    .map((command) => ({ name: command.name || 'check', command: command.command.trim() }));

  // Privacy is not known here: the clone endpoint resolves it live for the
  // clone panel, and a public installation analysis would otherwise be
  // mislabelled. The note is accurate either way and never carries a secret.
  notes.push(
    'These commands contain no credentials. If the repository is private, the account running them needs read access (for example after gh auth login).'
  );

  if (fixBranch) {
    if (baseCommit) {
      notes.push(
        `The branch is fetched from origin and checked out at its current head. To compare against the investigated snapshot, diff it with ${baseCommit}.`
      );
    }
    const cloneCommands = [`git clone ${shellArg(cloneUrl)} ${directory}`, `cd ${directory}`];
    const applyCommands = [
      `git fetch origin ${shellArg(fixBranch)}`,
      fixCommit
        ? `git checkout ${fixCommit}`
        : `git checkout -b ${directory} FETCH_HEAD`,
    ];
    if (fixCommit) {
      notes.push(
        `The checkout uses the recorded commit ${fixCommit}, so the local tree matches what BugWiser pushed even if the branch moves later.`
      );
    }
    notes.push('The checkout is detached when a commit is used; create a branch to keep any local changes.');

    if (testCommands.length === 0) {
      notes.push(
        'No verification plan was generated for this repository, so no test command is included. Run the project\'s own test command.'
      );
    }

    return {
      available: true,
      mode: 'branch',
      repositoryFullName: fullName,
      baseBranch,
      baseCommit,
      fixBranch,
      fixCommit,
      directory,
      cloneCommands,
      patchFile: null,
      applyCommands,
      testCommands,
      notes,
    };
  }

  const patchContent = buildPatchFile(input.stagedFiles || []);
  if (!patchContent) {
    return {
      available: false,
      reason:
        'Apply the fix in the workspace first (or push the fix branch), so there is something to test locally.',
    };
  }
  if (!baseCommit) {
    return {
      available: false,
      reason:
        'This analysis is not pinned to a base commit, so a local clone cannot be matched to the snapshot the patch was generated from.',
    };
  }

  const patchName = 'bugwiser-fix.patch';
  const cloneCommands = [
    baseBranch
      ? `git clone --branch ${shellArg(baseBranch)} ${shellArg(cloneUrl)} ${directory}`
      : `git clone ${shellArg(cloneUrl)} ${directory}`,
    `cd ${directory}`,
    `git checkout ${baseCommit}`,
  ];

  notes.push(
    `Download ${patchName} from this page and save it next to the clone directory (the parent of ${directory}), so ../${patchName} resolves.`
  );
  notes.push('`git apply --check` must pass before `git apply`; a failed check means the patch does not match this snapshot and nothing was changed.');
  notes.push('The patch is applied to the working tree only: no commit, no branch, no GitHub write.');
  if (testCommands.length === 0) {
    notes.push(
      'No verification plan was generated for this repository, so no test command is included. Run the project\'s own test command.'
    );
  }

  return {
    available: true,
    mode: 'patch',
    repositoryFullName: fullName,
    baseBranch,
    baseCommit,
    fixBranch: null,
    fixCommit: null,
    directory,
    cloneCommands,
    patchFile: {
      name: patchName,
      content: patchContent,
      fileCount: (input.stagedFiles || []).length,
    },
    applyCommands: [`git apply --check ../${patchName}`, `git apply ../${patchName}`],
    testCommands,
    notes,
  };
}
