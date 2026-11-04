import assert from 'node:assert/strict';
import type { ApplyFixError, Patch, PatchHunk } from '../../types/index.ts';
import { applyPatchToGitHub } from './apply-patch.ts';
import { encodeGitHubContent } from '../github/write.ts';

const { test, suite, run } = (() => {
  const tests: Array<{ name: string; fn: () => void | Promise<void> }> = [];
  return {
    suite(_name: string, fn: () => void) {
      fn();
    },
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

// ── Stubbed GitHub API ──────────────────────────────────────────────────────
const BASE_SHA = 'a'.repeat(40);
const COMMIT_SHA = 'b'.repeat(40);

interface Recorded {
  createdBranches: Array<{ name: string; sha: string }>;
  deletedBranches: string[];
  commits: Array<{ message: string; tree: string; parents: string[] }>;
  written: Array<{ path: string; content: string }>;
  refUpdates: Array<{ ref: string; sha: string; force: boolean }>;
  pullRequests: Array<{ head: string; base: string; title: string; body: string }>;
}

interface StubOptions {
  files?: Record<string, string>;
  pulledFiles?: Record<string, string>;
  existingPullRequests?: Array<{ number: number; html_url: string; state: string }>;
  pullRequestError?: string;
}

interface Stub {
  record: Recorded;
  restore: () => void;
}

function stubGitHub(options: StubOptions = {}): Stub {
  const files = new Map<string, string>(Object.entries(options.files ?? {}));
  const branchHeads = new Map<string, string>([['main', BASE_SHA]]);
  const commits = new Map<string, { tree: string; parents: string[] }>([
    [BASE_SHA, { tree: 'tree-base', parents: [] }],
  ]);
  const existingPrs = [...(options.existingPullRequests ?? [])];
  const record: Recorded = {
    createdBranches: [],
    deletedBranches: [],
    commits: [],
    written: [],
    refUpdates: [],
    pullRequests: [],
  };
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method || 'GET').toUpperCase();
    const segments = url.pathname.split('/').filter(Boolean); // repos/<owner>/<repo>/...
    const tail = segments.slice(3);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const json = (payload: unknown, status = 200) =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
      });

    if (tail.length === 0) {
      return json({ full_name: `${segments[1]}/${segments[2]}`, default_branch: 'main', permissions: { push: true } });
    }

    if (tail[0] === 'branches') {
      const name = decodeURIComponent(tail.slice(1).join('/'));
      const sha = branchHeads.get(name);
      if (!sha) return json({ message: 'Not Found' }, 404);
      return json({ name, commit: { sha }, protected: false });
    }

    if (tail[0] === 'git' && tail[1] === 'commits') {
      if (method === 'POST') {
        record.commits.push({
          message: body.message,
          tree: body.tree,
          parents: Array.isArray(body.parents) ? body.parents : [],
        });
        commits.set(COMMIT_SHA, {
          tree: body.tree,
          parents: Array.isArray(body.parents) ? body.parents : [],
        });
        return json({ sha: COMMIT_SHA, message: body.message, tree: { sha: body.tree } }, 201);
      }
      const sha = tail[2];
      const commit = commits.get(sha);
      if (!commit) return json({ message: 'Not Found' }, 404);
      return json({ sha, message: 'existing', tree: { sha: commit.tree }, parents: commit.parents });
    }

    if (tail[0] === 'git' && tail[1] === 'trees') {
      for (const entry of body.tree ?? []) {
        record.written.push({ path: entry.path, content: entry.content });
        files.set(entry.path, entry.content);
      }
      return json({ sha: 'tree-new', tree: body.tree ?? [] });
    }

    if (tail[0] === 'git' && tail[1] === 'refs') {
      if (method === 'POST') {
        const name = String(body.ref).replace(/^refs\/heads\//, '');
        record.createdBranches.push({ name, sha: body.sha });
        branchHeads.set(name, body.sha);
        return json({ ref: body.ref, object: { sha: body.sha } }, 201);
      }
      if (method === 'DELETE') {
        const name = decodeURIComponent(tail.slice(3).join('/'));
        record.deletedBranches.push(name);
        branchHeads.delete(name);
        return new Response(null, { status: 204 });
      }
      if (method === 'PATCH') {
        const name = decodeURIComponent(tail.slice(3).join('/'));
        record.refUpdates.push({ ref: name, sha: body.sha, force: body.force === true });
        branchHeads.set(name, body.sha);
        return json({ ref: name, object: { sha: body.sha } });
      }
      return json({ message: `Unhandled ${method} refs` }, 500);
    }

    if (tail[0] === 'contents') {
      const path = decodeURIComponent(tail.slice(1).join('/'));
      const source = files.get(path);
      if (method === 'GET') {
        if (source === undefined) return json({ message: 'Not Found' }, 404);
        return json({
          name: path.split('/').pop(),
          path,
          sha: `sha-${path}`,
          content: encodeGitHubContent(source),
          encoding: 'base64',
        });
      }
      record.written.push({ path, content: Buffer.from(body.content, 'base64').toString('utf8') });
      files.set(path, record.written[record.written.length - 1].content);
      return json({ sha: `committed-${path}` });
    }

    if (tail[0] === 'pulls') {
      if (method === 'GET') {
        const head = url.searchParams.get('head') ?? '';
        const base = url.searchParams.get('base') ?? '';
        return json(
          existingPrs.filter(
            (pr) =>
              pr.state === 'open' &&
              ((pr as { head?: string }).head === undefined ||
                (pr as { head?: string }).head === head) &&
              ((pr as { base?: string }).base === undefined ||
                (pr as { base?: string }).base === base)
          )
        );
      }
      if (options.pullRequestError) {
        return json({ message: options.pullRequestError }, 422);
      }
      record.pullRequests.push({
        head: body.head,
        base: body.base,
        title: body.title,
        body: body.body,
      });
      return json(
        {
          number: record.pullRequests.length,
          html_url: `https://github.com/${segments[1]}/${segments[2]}/pull/${record.pullRequests.length}`,
          state: 'open',
          title: body.title,
          body: body.body,
          created_at: '2026-01-01T00:00:00Z',
        },
        201
      );
    }

    return json({ message: `Unhandled ${method} ${url.pathname}` }, 500);
  }) as typeof fetch;

  return {
    record,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

const CTX = {
  token: 't',
  owner: 'owner',
  repo: 'repo',
  analysisId: 'analysis-1',
  issueNumber: 7,
  baseBranch: 'main',
  baseSha: BASE_SHA,
};

const SOURCE = 'function f() {\n  return 1;\n}\n';
const FIXED = 'function f() {\n  return 1;\n  console.log(1);\n}\n';

function patchFor(path: string, hunks: PatchHunk[]): Patch {
  return {
    summary: 'Log the return value for easier debugging.',
    files: [{ path, additions: 1, deletions: 0, hunks }],
  };
}

/** `ApplyFixResult.success` is a plain boolean, so the union needs explicit narrowing. */
function failureOf(result: { success: boolean } | ApplyFixError): ApplyFixError {
  if (result.success) throw new Error('expected the apply to fail');
  return result as ApplyFixError;
}

function hunk(lines: Array<{ type: 'context' | 'removed' | 'added'; content: string }>): PatchHunk {
  return {
    oldStart: 1,
    oldLines: 1,
    newStart: 1,
    newLines: 1,
    lines: lines.map((line, index) => ({
      number: index + 1,
      content: line.content,
      isHighlighted: line.type !== 'context',
      type: line.type,
    })),
  };
}

// ── applyPatchToGitHub ──────────────────────────────────────────────────────
suite('applyPatchToGitHub', () => {
  test('commits the approved staged file once, with the pinned commit as parent', async () => {
    const stub = stubGitHub({ files: { 'src/a.js': SOURCE } });
    try {
      const result = await applyPatchToGitHub({
        ...CTX,
        patch: patchFor('src/a.js', []),
        stagedFiles: [{ path: 'src/a.js', baseContent: SOURCE, content: FIXED }],
      });

      assert.equal(result.success, true);
      if (!result.success) return;
      assert.match(result.branch, /^bugwiser\/fix-issue-7-/);
      assert.equal(result.commitSha, COMMIT_SHA);
      assert.equal(result.defaultBranch, 'main');
      assert.deepEqual(result.filesChanged, ['src/a.js']);

      assert.deepEqual(stub.record.createdBranches, [{ name: result.branch, sha: BASE_SHA }]);
      assert.equal(stub.record.commits.length, 1);
      assert.deepEqual(stub.record.commits[0].parents, [BASE_SHA]);
      assert.equal(stub.record.commits[0].tree, 'tree-new');
      assert.match(stub.record.commits[0].message, /^fix: resolve issue #7/);
      assert.deepEqual(stub.record.written, [{ path: 'src/a.js', content: FIXED }]);
      assert.deepEqual(stub.record.refUpdates, [
        { ref: result.branch, sha: COMMIT_SHA, force: false },
      ]);
    } finally {
      stub.restore();
    }
  });

  test('opens a pull request only when it is explicitly requested', async () => {
    const stub = stubGitHub({ files: { 'src/a.js': SOURCE } });
    try {
      const result = await applyPatchToGitHub({
        ...CTX,
        patch: patchFor('src/a.js', []),
        stagedFiles: [{ path: 'src/a.js', baseContent: SOURCE, content: FIXED }],
        openPullRequest: true,
        issueUrl: 'https://github.com/owner/repo/issues/7',
      });

      assert.equal(result.success, true);
      if (!result.success) return;
      assert.equal(stub.record.pullRequests.length, 1);
      assert.equal(stub.record.pullRequests[0].head, result.branch);
      assert.equal(stub.record.pullRequests[0].base, 'main');
      assert.match(stub.record.pullRequests[0].body, /Fixes \[#7\]/);
      assert.equal(result.fixStatus, 'pr_created');
    } finally {
      stub.restore();
    }
  });

  test('a fork pushes its own branch and targets the upstream repositories with owner:branch', async () => {
    const stub = stubGitHub({ files: { 'src/a.js': SOURCE } });
    try {
      const result = await applyPatchToGitHub({
        ...CTX,
        owner: 'forkOwner',
        repo: 'repo',
        headOwner: 'forkOwner',
        pullRequestOwner: 'owner',
        pullRequestRepo: 'repo',
        upstreamFullName: 'owner/repo',
        patch: patchFor('src/a.js', []),
        stagedFiles: [{ path: 'src/a.js', baseContent: SOURCE, content: FIXED }],
        openPullRequest: true,
      });

      assert.equal(result.success, true);
      if (!result.success) return;
      assert.equal(result.usedFork, true);
      assert.equal(result.repositoryFullName, 'forkOwner/repo');
      assert.equal(stub.record.pullRequests.length, 1);
      assert.equal(stub.record.pullRequests[0].head, `forkOwner:${result.branch}`);
      assert.equal(stub.record.pullRequests[0].base, 'main');
    } finally {
      stub.restore();
    }
  });

  test('an existing open pull request is reused, never duplicated', async () => {
    const stub = stubGitHub({
      files: { 'src/a.js': SOURCE },
      existingPullRequests: [
        { number: 12, html_url: 'https://github.com/owner/repo/pull/12', state: 'open' },
      ],
    });
    try {
      const result = await applyPatchToGitHub({
        ...CTX,
        patch: patchFor('src/a.js', []),
        stagedFiles: [{ path: 'src/a.js', baseContent: SOURCE, content: FIXED }],
        openPullRequest: true,
      });

      assert.equal(result.success, true);
      if (!result.success) return;
      assert.equal(result.pullRequestUrl, 'https://github.com/owner/repo/pull/12');
      assert.equal(result.pullRequestNumber, 12);
      assert.equal(stub.record.pullRequests.length, 0);
    } finally {
      stub.restore();
    }
  });

  test('a failed pull request keeps the branch and commit and reports pr_failed', async () => {
    const stub = stubGitHub({
      files: { 'src/a.js': SOURCE },
      pullRequestError: 'Validation Failed',
    });
    try {
      const result = await applyPatchToGitHub({
        ...CTX,
        patch: patchFor('src/a.js', []),
        stagedFiles: [{ path: 'src/a.js', baseContent: SOURCE, content: FIXED }],
        openPullRequest: true,
      });

      assert.equal(result.success, true);
      if (!result.success) return;
      assert.equal(result.fixStatus, 'pr_failed');
      assert.equal(result.pullRequestUrl, undefined);
      assert.match(result.pullRequestError ?? '', /Validation Failed/);
      assert.equal(result.commitSha, COMMIT_SHA);
      assert.deepEqual(stub.record.deletedBranches, []);
    } finally {
      stub.restore();
    }
  });

  test('a staged file whose branch content already changed is a conflict, not an overwrite', async () => {
    const stub = stubGitHub({ files: { 'src/a.js': 'someone else wrote this\n' } });
    try {
      const result = await applyPatchToGitHub({
        ...CTX,
        patch: patchFor('src/a.js', []),
        stagedFiles: [{ path: 'src/a.js', baseContent: SOURCE, content: FIXED }],
      });

      const failure = failureOf(result);
      assert.equal(failure.code, 'patch_validation_failed');
      assert.match(failure.error, /changed since analysis/);
      assert.equal(stub.record.commits.length, 0);
      assert.deepEqual(stub.record.deletedBranches, stub.record.createdBranches.map((b) => b.name));
    } finally {
      stub.restore();
    }
  });

  test('a retry finds the approved content already committed and does not commit twice', async () => {
    const stub = stubGitHub({ files: { 'src/a.js': FIXED } });
    try {
      const result = await applyPatchToGitHub({
        ...CTX,
        patch: patchFor('src/a.js', []),
        stagedFiles: [{ path: 'src/a.js', baseContent: SOURCE, content: FIXED }],
      });

      assert.equal(result.success, true);
      if (!result.success) return;
      assert.equal(stub.record.commits.length, 0);
      assert.equal(stub.record.refUpdates.length, 0);
      assert.deepEqual(result.filesChanged, ['src/a.js']);
    } finally {
      stub.restore();
    }
  });

  test('standalone hunk application still works and preserves non-ASCII content', async () => {
    const source = '// café 世界\nfunction greet() {\n  return "欢迎";\n}\n';
    const stub = stubGitHub({ files: { 'src/greet.js': source } });
    try {
      const result = await applyPatchToGitHub({
        ...CTX,
        patch: patchFor('src/greet.js', [
          hunk([
            { type: 'context', content: 'function greet() {' },
            { type: 'context', content: '  return "欢迎";' },
            { type: 'added', content: '  // 注释' },
          ]),
        ]),
      });

      assert.equal(result.success, true);
      assert.equal(stub.record.written.length, 1);
      assert.equal(
        stub.record.written[0].content,
        '// café 世界\nfunction greet() {\n  return "欢迎";\n  // 注释\n}\n'
      );
    } finally {
      stub.restore();
    }
  });

  test('stale hunk content fails honestly, commits nothing and removes the new branch', async () => {
    const stub = stubGitHub({ files: { 'src/a.js': 'function f() {\n  return 2;\n}\n' } });
    try {
      const result = await applyPatchToGitHub({
        ...CTX,
        patch: patchFor('src/a.js', [
          hunk([
            { type: 'context', content: '  return 1;' },
            { type: 'added', content: '  console.log(1);' },
          ]),
        ]),
      });

      const failure = failureOf(result);
      assert.match(failure.error, /No files could be applied/);
      assert.equal(failure.code, 'patch_validation_failed');
      assert.equal(stub.record.commits.length, 0);
      assert.deepEqual(stub.record.deletedBranches, stub.record.createdBranches.map((b) => b.name));
    } finally {
      stub.restore();
    }
  });

  test('a patch with no changes never leaves a branch behind', async () => {
    const stub = stubGitHub({ files: { 'src/a.js': 'const a = 1;\n' } });
    try {
      const result = await applyPatchToGitHub({
        ...CTX,
        patch: patchFor('src/a.js', [hunk([{ type: 'context', content: 'const a = 1;' }])]),
      });

      const failure = failureOf(result);
      assert.match(failure.error, /no changes/);
      assert.equal(stub.record.commits.length, 0);
      assert.equal(stub.record.createdBranches.length, 1);
      assert.deepEqual(stub.record.deletedBranches, stub.record.createdBranches.map((b) => b.name));
    } finally {
      stub.restore();
    }
  });
});

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
