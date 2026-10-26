import assert from 'node:assert/strict';
import {
  PublicRepositoryError,
  fetchPublicBranches,
  fetchPublicFileAtCommit,
  fetchPublicIssue,
  fetchPublicIssues,
  fetchPublicRepository,
  fetchPublicTreeAtCommit,
  isValidGitRef,
  normalizeCommitSha,
  parseGitHubIssueUrl,
  parsePublicRepositoryUrl,
  resolvePublicRef,
  type PublicGitHubOptions,
} from './public.ts';

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

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof PublicRepositoryError, `expected PublicRepositoryError, got ${String(err)}`);
    assert.equal(err.code, code);
    return;
  }
  assert.fail(`expected ${code}, but nothing was thrown`);
}

function mockFetch(
  responses: Array<Response | ((url: string) => Response)>
): { fetchImpl: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  let index = 0;
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    const next = responses[index++];
    if (!next) throw new Error(`unexpected fetch ${url}`);
    return typeof next === 'function' ? next(url) : next;
  }) as typeof fetch;
  return { fetchImpl, urls };
}

const sha = 'a'.repeat(40);

// ── URL parsing ──────────────────────────────────────────────────────────────

test('accepts canonical repository URL', () => {
  const parsed = parsePublicRepositoryUrl('https://github.com/sindresorhus/ky');
  assert.deepEqual(parsed, {
    owner: 'sindresorhus',
    repo: 'ky',
    fullName: 'sindresorhus/ky',
    htmlUrl: 'https://github.com/sindresorhus/ky',
    ref: null,
  });
});

test('accepts .git suffix and trailing slash', () => {
  assert.equal(
    parsePublicRepositoryUrl('https://github.com/owner/repo.git/').repo,
    'repo'
  );
});

test('accepts owner/repo shorthand', () => {
  assert.equal(parsePublicRepositoryUrl('vercel/next.js').fullName, 'vercel/next.js');
});

test('accepts a tree URL and preserves slashes in the ref', () => {
  const parsed = parsePublicRepositoryUrl(
    'https://github.com/owner/repo/tree/feature/nested-work'
  );
  assert.equal(parsed.ref, 'feature/nested-work');
});

test('accepts git@github.com clone URLs', () => {
  const parsed = parsePublicRepositoryUrl('git@github.com:owner/repo.git');
  assert.equal(parsed.fullName, 'owner/repo');
});

test('rejects non-GitHub hosts', () => {
  expectCode(() => parsePublicRepositoryUrl('https://gitlab.com/owner/repo'), 'unsupported_host');
  expectCode(() => parsePublicRepositoryUrl('https://github.com.evil.test/owner/repo'), 'unsupported_host');
});

test('rejects credentials, ports, query strings and fragments', () => {
  expectCode(
    () => parsePublicRepositoryUrl('https://user:pass@github.com/owner/repo'),
    'invalid_url'
  );
  expectCode(() => parsePublicRepositoryUrl('https://github.com:8443/owner/repo'), 'invalid_url');
  expectCode(() => parsePublicRepositoryUrl('https://github.com/owner/repo?tab=readme'), 'invalid_url');
  expectCode(() => parsePublicRepositoryUrl('https://github.com/owner/repo#readme'), 'invalid_url');
});

test('rejects malformed and non-repository paths', () => {
  expectCode(() => parsePublicRepositoryUrl(''), 'invalid_url');
  expectCode(() => parsePublicRepositoryUrl('https://github.com'), 'invalid_url');
  expectCode(() => parsePublicRepositoryUrl('https://github.com/owner'), 'invalid_url');
  expectCode(
    () => parsePublicRepositoryUrl('https://github.com/owner/repo/issues/12'),
    'invalid_url'
  );
  expectCode(() => parsePublicRepositoryUrl('owner/../repo'), 'invalid_url');
  expectCode(() => parsePublicRepositoryUrl('https://github.com/owner//repo'), 'invalid_url');
});

test('rejects an invalid branch in a tree URL', () => {
  expectCode(
    () => parsePublicRepositoryUrl('https://github.com/owner/repo/tree/bad..ref'),
    'invalid_ref'
  );
});

test('parses issue URLs and shorthand', () => {
  const full = parseGitHubIssueUrl('https://github.com/owner/repo/issues/42');
  assert.equal(full.number, 42);
  assert.equal(full.fullName, 'owner/repo');

  const short = parseGitHubIssueUrl('owner/repo#7');
  assert.equal(short.number, 7);
});

test('rejects pull requests, other hosts and malformed issue URLs', () => {
  expectCode(
    () => parseGitHubIssueUrl('https://github.com/owner/repo/pull/42'),
    'invalid_issue_url'
  );
  expectCode(
    () => parseGitHubIssueUrl('https://gitlab.com/owner/repo/issues/42'),
    'unsupported_host'
  );
  expectCode(() => parseGitHubIssueUrl('https://github.com/owner/repo/issues/0'), 'invalid_issue_url');
  expectCode(() => parseGitHubIssueUrl('not a url'), 'invalid_issue_url');
});

// ── Ref and SHA validation ───────────────────────────────────────────────────

test('validates git branch names', () => {
  assert.equal(isValidGitRef('main'), true);
  assert.equal(isValidGitRef('release/2.0'), true);
  assert.equal(isValidGitRef('feature/nested-work'), true);
  assert.equal(isValidGitRef(''), false);
  assert.equal(isValidGitRef('-main'), false);
  assert.equal(isValidGitRef('bad..ref'), false);
  assert.equal(isValidGitRef('bad ref'), false);
  assert.equal(isValidGitRef('bad~ref'), false);
  assert.equal(isValidGitRef('release.lock'), false);
  assert.equal(isValidGitRef('release/'), false);
});

test('normalizes full commit SHAs only', () => {
  assert.equal(normalizeCommitSha(sha), sha);
  assert.equal(normalizeCommitSha(sha.toUpperCase()), sha);
  assert.equal(normalizeCommitSha('abc123'), null);
  assert.equal(normalizeCommitSha(`${sha}0`), null);
});

// ── API behaviour (injected fetch) ───────────────────────────────────────────

const repoPayload = {
  id: 1,
  full_name: 'owner/repo',
  name: 'repo',
  owner: { login: 'owner' },
  default_branch: 'main',
  description: 'demo',
  language: 'TypeScript',
  stargazers_count: 3,
  forks_count: 1,
  private: false,
  html_url: 'https://github.com/owner/repo',
  pushed_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
};

test('reads public repository metadata without an Authorization header', async () => {
  let seen: Headers | null = null;
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    seen = new Headers(init?.headers);
    return new Response(JSON.stringify(repoPayload), { status: 200 });
  }) as typeof fetch;

  const repo = await fetchPublicRepository('owner', 'repo', { fetchImpl });
  assert.equal(repo.fullName, 'owner/repo');
  assert.equal(repo.defaultBranch, 'main');
  assert.equal((seen as Headers | null)?.get('authorization'), null);
});

test('rejects a private repository', async () => {
  const { fetchImpl } = mockFetch([
    new Response(JSON.stringify({ ...repoPayload, private: true }), { status: 200 }),
  ]);
  try {
    await fetchPublicRepository('owner', 'repo', { fetchImpl });
    assert.fail('expected private_repository');
  } catch (err) {
    assert.ok(err instanceof PublicRepositoryError);
    assert.equal(err.code, 'private_repository');
  }
});

test('maps a 404 to not_found without leaking response text', async () => {
  const { fetchImpl } = mockFetch([
    new Response('{"message":"Not Found"}', { status: 404 }),
  ]);
  try {
    await fetchPublicRepository('owner', 'repo', { fetchImpl });
    assert.fail('expected not_found');
  } catch (err) {
    assert.ok(err instanceof PublicRepositoryError);
    assert.equal(err.code, 'not_found');
    assert.ok(!err.message.includes('Not Found"'));
  }
});

test('maps an exhausted rate limit to rate_limited with a delay', async () => {
  const { fetchImpl } = mockFetch([
    new Response('{}', {
      status: 403,
      headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '0', 'retry-after': '30' },
    }),
  ]);
  try {
    await fetchPublicRepository('owner', 'repo', { fetchImpl });
    assert.fail('expected rate_limited');
  } catch (err) {
    assert.ok(err instanceof PublicRepositoryError);
    assert.equal(err.code, 'rate_limited');
    assert.equal(err.retryAfterSeconds, 30);
  }
});

test('lists branches and stops paginating on a short page', async () => {
  const { fetchImpl, urls } = mockFetch([
    new Response(
      JSON.stringify([{ name: 'main', commit: { sha }, protected: true }]),
      { status: 200 }
    ),
  ]);
  const branches = await fetchPublicBranches('owner', 'repo', { fetchImpl });
  assert.equal(branches.length, 1);
  assert.equal(branches[0].name, 'main');
  assert.equal(branches[0].protected, true);
  assert.equal(urls.length, 1);
});

test('resolves a branch to a commit SHA', async () => {
  const { fetchImpl, urls } = mockFetch([
    new Response(
      JSON.stringify({
        sha,
        html_url: 'https://github.com/owner/repo/commit/' + sha,
        commit: { message: 'initial', committer: { date: '2026-01-01T00:00:00Z' } },
      }),
      { status: 200 }
    ),
  ]);
  const resolved = await resolvePublicRef('owner', 'repo', 'release/2.0', { fetchImpl });
  assert.equal(resolved.commitSha, sha);
  assert.equal(resolved.ref, 'release/2.0');
  assert.ok(urls[0].includes('release%2F2.0'));
});

test('rejects a truncated tree as too large', async () => {
  const { fetchImpl } = mockFetch([
    new Response(JSON.stringify({ sha, tree: [], truncated: true }), { status: 200 }),
  ]);
  try {
    await fetchPublicTreeAtCommit('owner', 'repo', sha, { fetchImpl });
    assert.fail('expected too_large');
  } catch (err) {
    assert.ok(err instanceof PublicRepositoryError);
    assert.equal(err.code, 'too_large');
  }
});

test('reads a raw file at the pinned commit', async () => {
  const { fetchImpl, urls } = mockFetch([new Response('export const x = 1;\n', { status: 200 })]);
  const file = await fetchPublicFileAtCommit('owner', 'repo', 'src/a.ts', sha, { fetchImpl });
  assert.equal(file.content, 'export const x = 1;\n');
  assert.ok(urls[0].includes(`ref=${sha}`));
});

test('rejects oversized files and traversal paths', async () => {
  const { fetchImpl } = mockFetch([new Response('x'.repeat(64), { status: 200 })]);
  try {
    await fetchPublicFileAtCommit('owner', 'repo', 'src/a.ts', sha, {
      fetchImpl,
      limits: { maxFileBytes: 16 },
    });
    assert.fail('expected too_large');
  } catch (err) {
    assert.ok(err instanceof PublicRepositoryError);
    assert.equal(err.code, 'too_large');
  }

  const traversal = mockFetch([]);
  try {
    await fetchPublicFileAtCommit('owner', 'repo', '../../etc/passwd', sha, {
      fetchImpl: traversal.fetchImpl,
    });
    assert.fail('expected path rejection');
  } catch (err) {
    assert.ok(err instanceof PublicRepositoryError);
    assert.equal(err.code, 'api_error');
  }
});

test('reads an issue and rejects pull request URLs served by the issues endpoint', async () => {
  const issuePayload = {
    number: 5,
    title: 'Bug',
    body: 'body',
    state: 'open',
    labels: [{ name: 'bug' }],
    user: { login: 'alice' },
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    comments: 2,
    html_url: 'https://github.com/owner/repo/issues/5',
  };
  const { fetchImpl } = mockFetch([
    new Response(JSON.stringify(issuePayload), { status: 200 }),
  ]);
  const issue = await fetchPublicIssue('owner', 'repo', 5, { fetchImpl });
  assert.equal(issue.title, 'Bug');
  assert.deepEqual(issue.labels, ['bug']);

  const pr = mockFetch([
    new Response(
      JSON.stringify({ ...issuePayload, html_url: 'https://github.com/owner/repo/pull/5' }),
      { status: 200 }
    ),
  ]);
  try {
    await fetchPublicIssue('owner', 'repo', 5, { fetchImpl: pr.fetchImpl });
    assert.fail('expected invalid_issue_url');
  } catch (err) {
    assert.ok(err instanceof PublicRepositoryError);
    assert.equal(err.code, 'invalid_issue_url');
  }
});

test('lists issues, filters pull requests and maps fields', async () => {
  const { fetchImpl, urls } = mockFetch([
    new Response(
      JSON.stringify([
        {
          number: 12,
          title: 'Crash on malformed cookie',
          state: 'open',
          labels: [{ name: 'bug' }],
          user: { login: 'alice' },
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-02T00:00:00Z',
          comments: 4,
          html_url: 'https://github.com/owner/repo/issues/12',
        },
        {
          number: 13,
          title: 'A pull request, not an issue',
          state: 'open',
          labels: [],
          user: { login: 'bob' },
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-02T00:00:00Z',
          comments: 0,
          html_url: 'https://github.com/owner/repo/pull/13',
          pull_request: { url: 'https://api.github.com/repos/owner/repo/pulls/13' },
        },
      ]),
      { status: 200 }
    ),
  ]);

  const issues = await fetchPublicIssues('owner', 'repo', { fetchImpl });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].number, 12);
  assert.deepEqual(issues[0].labels, ['bug']);
  assert.equal(issues[0].commentsCount, 4);
  assert.equal(issues[0].author, 'alice');
  assert.ok(urls[0].includes('/repos/owner/repo/issues?state=open'));
  assert.ok(urls[0].includes('per_page=30'));
});

test('rejects an invalid repository when listing issues', async () => {
  const { fetchImpl } = mockFetch([]);
  try {
    await fetchPublicIssues('../owner', 'repo', { fetchImpl });
    assert.fail('expected invalid_url');
  } catch (err) {
    assert.ok(err instanceof PublicRepositoryError);
    assert.equal(err.code, 'invalid_url');
  }
});

test('passes a deployment read token when configured', async () => {
  let headers: Headers | null = null;
  const options: PublicGitHubOptions = {
    token: 'deployment-token',
    fetchImpl: (async (_input: RequestInfo | URL, init?: RequestInit) => {
      headers = new Headers(init?.headers);
      return new Response(JSON.stringify(repoPayload), { status: 200 });
    }) as typeof fetch,
  };
  await fetchPublicRepository('owner', 'repo', options);
  assert.equal((headers as Headers | null)?.get('authorization'), 'Bearer deployment-token');
});

run();
