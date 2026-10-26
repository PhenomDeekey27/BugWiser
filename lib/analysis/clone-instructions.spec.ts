import assert from 'node:assert/strict';
import {
  buildClonePlan,
  loadCloneContext,
  loadCompareFiles,
  parsePullRequestUrl,
  type ClonePlanInput,
} from './clone-instructions.ts';

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

const baseSha = 'a'.repeat(40);
const fixSha = 'b'.repeat(40);

function input(overrides: Partial<ClonePlanInput> = {}): ClonePlanInput {
  return {
    repositoryFullName: 'acme/widgets',
    baseBranch: 'main',
    baseCommit: baseSha,
    baseBranchExists: true,
    isPrivate: false,
    fix: {
      state: 'available',
      branch: 'BugWiser/fix/issue-42-ab12cd',
      commitSha: fixSha,
      repositoryFullName: 'acme/widgets',
    },
    ...overrides,
  };
}

function mockFetch(routes: Record<string, { status: number; body?: unknown }>): {
  fetchImpl: typeof fetch;
  urls: string[];
} {
  const urls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    const match = Object.keys(routes).find((pattern) => url.includes(pattern));
    if (!match) {
      throw new Error(`unexpected fetch ${url}`);
    }
    const { status, body } = routes[match];
    return new Response(body === undefined ? '' : JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fetchImpl, urls };
}

// ── plan: original and fixed commands ───────────────────────────────────────

test('pins the original to the recorded base commit and clones the fix branch', () => {
  const result = buildClonePlan(input());
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const { plan } = result;
  assert.equal(plan.original.repositoryFullName, 'acme/widgets');
  assert.equal(plan.original.cloneUrl, 'https://github.com/acme/widgets.git');
  assert.equal(plan.original.branch, 'main');
  assert.equal(plan.original.commit, baseSha);
  assert.deepEqual(plan.original.commands, [
    'git clone --branch main https://github.com/acme/widgets.git bugwiser-original',
    'cd bugwiser-original',
    `git checkout ${baseSha}`,
  ]);

  assert.ok(plan.fixed);
  assert.equal(plan.fixed?.repositoryFullName, 'acme/widgets');
  assert.equal(plan.fixed?.branch, 'BugWiser/fix/issue-42-ab12cd');
  assert.equal(plan.fixed?.commit, fixSha);
  assert.deepEqual(plan.fixed?.commands, [
    'git clone --branch BugWiser/fix/issue-42-ab12cd https://github.com/acme/widgets.git bugwiser-fixed',
    'cd bugwiser-fixed',
    `git checkout ${fixSha}`,
  ]);

  assert.equal(plan.fixIsFork, false);
  assert.equal(plan.compare.serverSide, true);
  assert.deepEqual(plan.compare.commands, [
    'git clone https://github.com/acme/widgets.git bugwiser-compare',
    'cd bugwiser-compare',
    'git fetch origin BugWiser/fix/issue-42-ab12cd',
    `git diff ${baseSha} FETCH_HEAD`,
    `git log --oneline ${baseSha}..FETCH_HEAD`,
  ]);
  assert.deepEqual(plan.warnings, []);
});

test('uses the fork clone URL when the fix branch is not on the original repository', () => {
  const result = buildClonePlan(
    input({
      fix: {
        state: 'available',
        branch: 'fix/issue-42',
        commitSha: fixSha,
        repositoryFullName: 'contributor/widgets',
      },
    })
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const { plan } = result;
  assert.equal(plan.fixIsFork, true);
  assert.equal(plan.fixRepositoryFullName, 'contributor/widgets');
  assert.equal(plan.original.cloneUrl, 'https://github.com/acme/widgets.git');
  assert.equal(plan.fixed?.cloneUrl, 'https://github.com/contributor/widgets.git');
  assert.ok(
    plan.fixed?.commands[0].includes('https://github.com/contributor/widgets.git'),
    'the fixed clone must use the fork URL'
  );
  assert.ok(
    !plan.fixed?.commands[0].includes('acme/widgets'),
    'the fixed clone must not point at the original repository'
  );
  assert.equal(plan.compare.serverSide, false, 'cross-repository compare uses git commands');
  assert.equal(plan.compare.commands[2], 'git remote add bugwiser-fix https://github.com/contributor/widgets.git');
  assert.equal(plan.compare.commands[3], 'git fetch bugwiser-fix fix/issue-42');
  assert.ok(plan.warnings.some((warning) => warning.includes('fork')));
});

test('reports a missing fix branch instead of generating a command for it', () => {
  const result = buildClonePlan(
    input({
      fix: { state: 'missing', reason: 'The recorded fix branch "BugWiser/fix/x" was not found.' },
    })
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.plan.fixed, null);
  assert.equal(result.plan.fixedState, 'missing');
  assert.equal(result.plan.fixedReason, 'The recorded fix branch "BugWiser/fix/x" was not found.');
  assert.equal(result.plan.compare.commands.length, 0);
  assert.ok(result.plan.original.commands.length > 0, 'the original is still cloneable');
  assert.ok(result.plan.warnings.some((warning) => warning.includes('not found')));
});

test('does not offer a fixed clone before a branch exists', () => {
  const result = buildClonePlan(
    input({
      fix: { state: 'not_created', reason: 'No fix branch has been created for this analysis yet.' },
    })
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.plan.fixed, null);
  assert.equal(result.plan.fixedState, 'not_created');
  assert.match(result.plan.compare.note, /fix branch/i);
});

test('keeps credentials out of commands and archive links for private repositories', () => {
  const result = buildClonePlan(input({ isPrivate: true }));
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const commands = [...result.plan.original.commands, ...(result.plan.fixed?.commands ?? [])];
  const joined = commands.join('\n');
  assert.ok(!/x-access-token|token|ghp_|Bearer/i.test(joined), 'no credential may appear');
  assert.ok(joined.includes('https://github.com/acme/widgets.git'));
  assert.equal(result.plan.original.archiveUrl, null);
  assert.equal(result.plan.fixed?.archiveUrl, null);
  assert.ok(result.plan.warnings.some((warning) => warning.includes('private')));
});

test('offers source archives for public repositories', () => {
  const result = buildClonePlan(input());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(
    result.plan.original.archiveUrl,
    `https://github.com/acme/widgets/archive/${baseSha}.tar.gz`
  );
  assert.equal(
    result.plan.fixed?.archiveUrl,
    `https://github.com/acme/widgets/archive/${fixSha}.tar.gz`
  );
});

// ── plan: commit metadata ────────────────────────────────────────────────────

test('refuses to pin an original clone when the base commit is missing', () => {
  const result = buildClonePlan(input({ baseCommit: null }));
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.plan.baseCommit, null);
  assert.ok(!result.plan.original.commands.some((command) => command.startsWith('git checkout')));
  assert.ok(result.plan.warnings.some((warning) => warning.includes('No pinned base commit')));
  assert.equal(result.plan.compare.serverSide, false);
});

test('rejects a shortened or non-SHA base commit and a bad fix SHA', () => {
  const short = buildClonePlan(input({ baseCommit: 'abc1234' }));
  assert.equal(short.ok, true);
  if (!short.ok) return;
  assert.equal(short.plan.baseCommit, null, 'a short SHA must not be treated as pinned');
  assert.ok(short.plan.warnings.some((warning) => warning.includes('No pinned base commit')));

  const badFix = buildClonePlan(
    input({
      fix: {
        state: 'available',
        branch: 'fix/issue-42',
        commitSha: 'main',
        repositoryFullName: 'acme/widgets',
      },
    })
  );
  assert.equal(badFix.ok, true);
  if (!badFix.ok) return;
  assert.equal(badFix.plan.fixCommit, null);
  assert.ok(!badFix.plan.fixed?.commands.some((command) => command.startsWith('git checkout')));
  assert.equal(badFix.plan.compare.serverSide, false);
});

test('omits --branch when the recorded base branch no longer exists', () => {
  const result = buildClonePlan(input({ baseBranchExists: false }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(
    result.plan.original.commands[0],
    'git clone https://github.com/acme/widgets.git bugwiser-original'
  );
  assert.ok(result.plan.warnings.some((warning) => warning.includes('no longer exists')));
});

test('fails clearly when the analysis records no usable repository', () => {
  const result = buildClonePlan(input({ repositoryFullName: null }));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, 'invalid_repository');
});

test('notes that an identical fix head has nothing to compare', () => {
  const result = buildClonePlan(
    input({
      fix: {
        state: 'available',
        branch: 'fix/issue-42',
        commitSha: baseSha,
        repositoryFullName: 'acme/widgets',
      },
    })
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.plan.compare.note, /nothing to compare/);
});

// ── pull request URL parsing ────────────────────────────────────────────────

test('parses pull request URLs and rejects anything else', () => {
  assert.deepEqual(parsePullRequestUrl('https://github.com/acme/widgets/pull/17'), {
    owner: 'acme',
    repo: 'widgets',
    fullName: 'acme/widgets',
    number: 17,
  });
  assert.equal(parsePullRequestUrl('https://github.com/acme/widgets/pull/abc'), null);
  assert.equal(parsePullRequestUrl('https://github.com/acme/widgets/issues/17'), null);
  assert.equal(parsePullRequestUrl('https://gitlab.com/acme/widgets/pull/17'), null);
  assert.equal(parsePullRequestUrl(null), null);
});

// ── GitHub reads ────────────────────────────────────────────────────────────

test('resolve the fix branch from a fork-hosted pull request head', async () => {
  const { fetchImpl, urls } = mockFetch({
    '/repos/acme/widgets/pulls/17': {
      status: 200,
      body: {
        head: {
          ref: 'fix/issue-42',
          sha: fixSha,
          repo: { full_name: 'contributor/widgets' },
        },
      },
    },
    '/repos/contributor/widgets/branches/fix/issue-42': {
      status: 200,
      body: { commit: { sha: fixSha } },
    },
    '/repos/acme/widgets/branches/main': { status: 200, body: {} },
  });

  const context = await loadCloneContext({
    repositoryFullName: 'acme/widgets',
    baseBranch: 'main',
    fixBranch: 'BugWiser/fix/issue-42-ab12cd',
    pullRequestUrl: 'https://github.com/acme/widgets/pull/17',
    knownPublic: true,
    fetchImpl,
  });

  assert.equal(context.fix.state, 'available');
  if (context.fix.state !== 'available') return;
  assert.equal(context.fix.branch, 'fix/issue-42');
  assert.equal(context.fix.commitSha, fixSha);
  assert.equal(context.fix.repositoryFullName, 'contributor/widgets');
  assert.equal(context.baseBranchExists, true);
  assert.equal(context.repository.isPrivate, false);
  assert.ok(urls.some((url) => url.includes('/pulls/17')));
  assert.ok(
    urls.some((url) => url.includes('/repos/contributor/widgets/branches/fix/issue-42')),
    'a fork head must be confirmed on the fork, not assumed'
  );
});

test('reports a deleted fork branch even though the pull request still lists it', async () => {
  const { fetchImpl } = mockFetch({
    '/repos/acme/widgets/pulls/17': {
      status: 200,
      body: {
        head: {
          ref: 'fix/issue-42',
          sha: fixSha,
          repo: { full_name: 'contributor/widgets' },
        },
      },
    },
    '/repos/contributor/widgets/branches/fix/issue-42': { status: 404 },
    '/repos/acme/widgets/branches/main': { status: 200, body: {} },
  });

  const context = await loadCloneContext({
    repositoryFullName: 'acme/widgets',
    baseBranch: 'main',
    fixBranch: 'fix/issue-42',
    pullRequestUrl: 'https://github.com/acme/widgets/pull/17',
    knownPublic: true,
    fetchImpl,
  });

  assert.equal(context.fix.state, 'missing');
  if (context.fix.state !== 'missing') return;
  assert.match(context.fix.reason, /contributor\/widgets/);
  assert.match(context.fix.reason, /no longer exists/);
});

test('falls back to the fix branch when the pull request cannot be read', async () => {
  const { fetchImpl } = mockFetch({
    '/repos/acme/widgets/pulls/17': { status: 404 },
    '/repos/acme/widgets/branches/main': { status: 200, body: {} },
    '/repos/acme/widgets/branches/BugWiser/fix/issue-42-ab12cd': {
      status: 200,
      body: { commit: { sha: fixSha } },
    },
  });

  const context = await loadCloneContext({
    repositoryFullName: 'acme/widgets',
    baseBranch: 'main',
    fixBranch: 'BugWiser/fix/issue-42-ab12cd',
    pullRequestUrl: 'https://github.com/acme/widgets/pull/17',
    knownPublic: true,
    fetchImpl,
  });

  assert.equal(context.fix.state, 'available');
  if (context.fix.state !== 'available') return;
  assert.equal(context.fix.repositoryFullName, 'acme/widgets');
  assert.equal(context.fix.branch, 'BugWiser/fix/issue-42-ab12cd');
});

test('reports a deleted fix branch as missing', async () => {
  const { fetchImpl } = mockFetch({
    '/branches/main': { status: 200, body: {} },
    '/branches/BugWiser/fix/gone': { status: 404 },
  });

  const context = await loadCloneContext({
    repositoryFullName: 'acme/widgets',
    baseBranch: 'main',
    fixBranch: 'BugWiser/fix/gone',
    knownPublic: true,
    fetchImpl,
  });

  assert.equal(context.fix.state, 'missing');
  if (context.fix.state !== 'missing') return;
  assert.match(context.fix.reason, /was not found/);
  assert.match(context.fix.reason, /acme\/widgets/);
});

test('marks the fix branch unverified when GitHub refuses the check', async () => {
  const { fetchImpl } = mockFetch({
    '/branches/main': { status: 403 },
    '/branches/fix/issue-42': { status: 403 },
  });

  const context = await loadCloneContext({
    repositoryFullName: 'acme/widgets',
    baseBranch: 'main',
    fixBranch: 'fix/issue-42',
    knownPublic: true,
    fetchImpl,
  });

  assert.equal(context.fix.state, 'unverified');
  assert.equal(context.baseBranchExists, null);
  if (context.fix.state !== 'unverified') return;
  assert.match(context.fix.reason, /403/);
});

test('reads repository visibility when it is not already known to be public', async () => {
  const { fetchImpl } = mockFetch({
    '/repos/acme/widgets/branches': { status: 200, body: { commit: { sha: fixSha } } },
    '/repos/acme/widgets/branches/main': { status: 200, body: {} },
    '/repos/acme/widgets': { status: 200, body: { private: true, default_branch: 'main' } },
  });

  const context = await loadCloneContext({
    repositoryFullName: 'acme/widgets',
    baseBranch: 'main',
    fixBranch: 'fix/issue-42',
    fetchImpl,
  });

  assert.equal(context.repository.isPrivate, true);
  assert.equal(context.repository.defaultBranch, 'main');
});

test('never puts the token in a command even when authenticated reads are used', async () => {
  const { fetchImpl, urls } = mockFetch({
    '/branches/main': { status: 200, body: {} },
    '/branches/fix/issue-42': { status: 200, body: { commit: { sha: fixSha } } },
  });

  const context = await loadCloneContext({
    repositoryFullName: 'acme/widgets',
    baseBranch: 'main',
    fixBranch: 'fix/issue-42',
    knownPublic: true,
    token: 'secret-token-value',
    fetchImpl,
  });

  const plan = buildClonePlan({
    repositoryFullName: 'acme/widgets',
    baseBranch: 'main',
    baseCommit: baseSha,
    baseBranchExists: context.baseBranchExists,
    fix: context.fix,
    isPrivate: context.repository.isPrivate,
  });
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  const joined = [...plan.plan.original.commands, ...(plan.plan.fixed?.commands ?? [])].join('\n');
  assert.ok(!joined.includes('secret-token-value'));
  assert.ok(urls.length > 0);
});

// ── compare reads ───────────────────────────────────────────────────────────

test('maps a same-repository comparison into file records', async () => {
  const { fetchImpl, urls } = mockFetch({
    [`/compare/${baseSha}...${fixSha}`]: {
      status: 200,
      body: {
        status: 'ahead',
        ahead_by: 2,
        behind_by: 0,
        total_commits: 2,
        files: [
          { filename: 'src/a.ts', status: 'modified', additions: 3, deletions: 1, patch: '@@ -1 +1 @@' },
          { filename: 'src/b.ts', status: 'added', additions: 5, deletions: 0 },
        ],
      },
    },
  });

  const outcome = await loadCompareFiles({
    repositoryFullName: 'acme/widgets',
    baseCommit: baseSha,
    headCommit: fixSha,
    fetchImpl,
  });

  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.result.aheadBy, 2);
  assert.equal(outcome.result.files.length, 2);
  assert.equal(outcome.result.files[0].path, 'src/a.ts');
  assert.equal(outcome.result.files[1].patch, null);
  assert.equal(outcome.result.truncated, false);
  assert.ok(urls[0].includes(`/compare/${baseSha}...${fixSha}`));
});

test('reports compare failures without inventing a diff', async () => {
  const missingSha = await loadCompareFiles({
    repositoryFullName: 'acme/widgets',
    baseCommit: baseSha,
    headCommit: null,
    fetchImpl: mockFetch({}).fetchImpl,
  });
  assert.equal(missingSha.ok, false);
  if (missingSha.ok) return;
  assert.equal(missingSha.code, 'missing_commit');

  const gone = await loadCompareFiles({
    repositoryFullName: 'acme/widgets',
    baseCommit: baseSha,
    headCommit: fixSha,
    fetchImpl: mockFetch({ '/compare/': { status: 404 } }).fetchImpl,
  });
  assert.equal(gone.ok, false);
  if (gone.ok) return;
  assert.equal(gone.code, 'not_found');

  const denied = await loadCompareFiles({
    repositoryFullName: 'acme/widgets',
    baseCommit: baseSha,
    headCommit: fixSha,
    fetchImpl: mockFetch({ '/compare/': { status: 403 } }).fetchImpl,
  });
  assert.equal(denied.ok, false);
  if (denied.ok) return;
  assert.equal(denied.code, 'api_error');
  assert.match(denied.message, /read access/);
});

await run();
