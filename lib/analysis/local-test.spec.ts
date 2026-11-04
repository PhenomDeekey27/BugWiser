import assert from 'node:assert/strict';
import {
  buildLocalTestPlan,
  buildPatchFile,
  normalizeSha,
  type LocalTestInput,
} from './local-test.ts';

const { test, run } = (() => {
  const tests: Array<{ name: string; fn: () => void | Promise<void> }> = [];
  return {
    test(name: string, fn: () => void | Promise<void>) {
      tests.push({ name, fn });
    },
    async run() {
      let passed = 0;
      for (const t of tests) {
        try {
          await t.fn();
          passed++;
          console.log(`ok  - ${t.name}`);
        } catch (err) {
          console.log(`FAIL- ${t.name}`);
          console.log(err instanceof Error ? err.stack : String(err));
        }
      }
      console.log(`${passed}/${tests.length} tests passed`);
      if (passed !== tests.length) process.exitCode = 1;
    },
  };
})();

const baseSha = 'c'.repeat(40);
const fixSha = 'd'.repeat(40);

const fileA = {
  path: 'src/a.ts',
  diff: '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,2 @@\n context\n-old\n+new',
};
const fileB = {
  path: 'src/b.ts',
  diff: '--- a/src/b.ts\n+++ b/src/b.ts\n@@ -3,1 +3,1 @@\n-old b\n+new b',
};

function input(overrides: Partial<LocalTestInput> = {}): LocalTestInput {
  return {
    repositoryFullName: 'acme/widgets',
    baseBranch: 'main',
    baseCommit: baseSha,
    stagedFiles: [fileA, fileB],
    verification: { commands: [{ name: 'unit tests', command: 'npm test' }] },
    ...overrides,
  };
}

// ── patch mode ───────────────────────────────────────────────────────────────

test('clones the base branch, pins the commit, then applies the patch', () => {
  const plan = buildLocalTestPlan(input());
  assert.equal(plan.available, true);
  if (!plan.available) return;

  assert.equal(plan.mode, 'patch');
  assert.equal(plan.repositoryFullName, 'acme/widgets');
  assert.deepEqual(plan.cloneCommands, [
    'git clone --branch main https://github.com/acme/widgets.git bugwiser-test',
    'cd bugwiser-test',
    `git checkout ${baseSha}`,
  ]);
  assert.deepEqual(plan.applyCommands, [
    'git apply --check ../bugwiser-fix.patch',
    'git apply ../bugwiser-fix.patch',
  ]);
  assert.deepEqual(plan.testCommands, [{ name: 'unit tests', command: 'npm test' }]);
  assert.equal(plan.fixBranch, null);
});

test('renders every staged file into one downloadable patch', () => {
  const plan = buildLocalTestPlan(input());
  assert.equal(plan.available, true);
  if (!plan.available) return;
  assert.ok(plan.patchFile);
  assert.equal(plan.patchFile?.name, 'bugwiser-fix.patch');
  assert.equal(plan.patchFile?.fileCount, 2);
  assert.equal(
    plan.patchFile?.content,
    `${fileA.diff}\n${fileB.diff}\n`
  );
  assert.ok(plan.patchFile?.content.endsWith('\n'), 'a patch must end with a newline');
  assert.ok(plan.patchFile?.content.includes('--- a/src/a.ts'));
  assert.ok(plan.patchFile?.content.includes('--- a/src/b.ts'));
});

test('buildPatchFile ignores empty diffs and reports nothing to apply', () => {
  assert.equal(buildPatchFile([]), null);
  assert.equal(buildPatchFile([{ path: 'x', diff: '   ' }]), null);

  const plan = buildLocalTestPlan(input({ stagedFiles: [{ path: 'x', diff: '' }] }));
  assert.equal(plan.available, false);
  if (plan.available) return;
  assert.match(plan.reason, /Apply the fix in the workspace first/);
});

test('refuses a local patch test without a pinned base commit', () => {
  const plan = buildLocalTestPlan(input({ baseCommit: null }));
  assert.equal(plan.available, false);
  if (plan.available) return;
  assert.match(plan.reason, /not pinned to a base commit/);
});

test('notes that no test command is known instead of inventing one', () => {
  const plan = buildLocalTestPlan(input({ verification: null }));
  assert.equal(plan.available, true);
  if (!plan.available) return;
  assert.deepEqual(plan.testCommands, []);
  assert.ok(plan.notes.some((note) => note.includes("project's own test command")));
});

test('keeps credentials out of the commands and says when read access is needed', () => {
  const plan = buildLocalTestPlan(input());
  assert.equal(plan.available, true);
  if (!plan.available) return;

  const joined = [...plan.cloneCommands, ...plan.applyCommands].join('\n');
  assert.ok(!/x-access-token|ghp_|Bearer|token=/i.test(joined));
  assert.ok(joined.includes('https://github.com/acme/widgets.git'));
  assert.ok(plan.notes.some((note) => note.includes('no credentials')));
  assert.ok(plan.notes.some((note) => note.includes('private')));
});

test('omits --branch when no base branch is recorded', () => {
  const plan = buildLocalTestPlan(input({ baseBranch: null }));
  assert.equal(plan.available, true);
  if (!plan.available) return;
  assert.equal(
    plan.cloneCommands[0],
    'git clone https://github.com/acme/widgets.git bugwiser-test'
  );
});

// ── branch mode ──────────────────────────────────────────────────────────────

test('checks out the pushed fix commit instead of re-applying the patch', () => {
  const plan = buildLocalTestPlan(
    input({ stagedFiles: null, fix: { branch: 'BugWiser/fix/issue-42-ab12cd', commitSha: fixSha } })
  );
  assert.equal(plan.available, true);
  if (!plan.available) return;

  assert.equal(plan.mode, 'branch');
  assert.equal(plan.patchFile, null);
  assert.deepEqual(plan.applyCommands, [
    'git fetch origin BugWiser/fix/issue-42-ab12cd',
    `git checkout ${fixSha}`,
  ]);
  assert.equal(plan.fixBranch, 'BugWiser/fix/issue-42-ab12cd');
  assert.equal(plan.fixCommit, fixSha);
  assert.ok(plan.notes.some((note) => note.includes('detached')));
});

test('creates a local branch when the fix commit is not recorded', () => {
  const plan = buildLocalTestPlan(
    input({ stagedFiles: null, fix: { branch: 'fix/issue-42', commitSha: null } })
  );
  assert.equal(plan.available, true);
  if (!plan.available) return;
  assert.deepEqual(plan.applyCommands, [
    'git fetch origin fix/issue-42',
    'git checkout -b bugwiser-test FETCH_HEAD',
  ]);
  assert.equal(plan.fixCommit, null);
});

test('a pushed fix is testable even without staged files', () => {
  const plan = buildLocalTestPlan(input({ stagedFiles: null, fix: { branch: 'fix/x', commitSha: fixSha } }));
  assert.equal(plan.available, true);
});

test('reports no local test when neither a patch nor a branch exists', () => {
  const plan = buildLocalTestPlan(input({ stagedFiles: null, fix: null }));
  assert.equal(plan.available, false);
  if (plan.available) return;
  assert.match(plan.reason, /Apply the fix in the workspace first/);
});

test('rejects an unusable repository name', () => {
  const plan = buildLocalTestPlan(input({ repositoryFullName: 'not a repo' }));
  assert.equal(plan.available, false);
  if (plan.available) return;
  assert.match(plan.reason, /usable GitHub repository/);
});

test('normalizeSha only accepts a full commit id', () => {
  assert.equal(normalizeSha(baseSha), baseSha);
  assert.equal(normalizeSha(baseSha.toUpperCase()), baseSha);
  assert.equal(normalizeSha('abc1234'), null);
  assert.equal(normalizeSha('main'), null);
  assert.equal(normalizeSha(null), null);
});

await run();
