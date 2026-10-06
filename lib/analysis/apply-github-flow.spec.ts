import assert from 'node:assert/strict';
import type { ApplyFixError, PatchHunk } from '@/types';
import { applyPatchToGitHub } from './apply-patch.ts';
import { encodeGitHubContent } from '@/lib/github/write';

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
interface Recorded {
  createdBranches: string[];
  deletedBranches: string[];
  commits: Array<{ path: string; content: string; branch: string }>;
  pulls: Array<{ head: string; base: string }>;
}

interface Stub {
  record: Recorded;
  restore: () => void;
}

function stubGitHub(files: Record<string, string>): Stub {
  const record: Recorded = {
    createdBranches: [],
    deletedBranches: [],
    commits: [],
    pulls: [],
  };
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method || 'GET').toUpperCase();
    const segments = url.pathname.split('/').filter(Boolean); // repos/<owner>/<repo>/...
    const tail = segments.slice(3);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

    if (tail.length === 0) {
      return json({ default_branch: 'main' });
    }

    if (tail[0] === 'branches') {
      const name = decodeURIComponent(tail.slice(1).join('/'));
      if (name === 'main') return json({ name: 'main', commit: { sha: 'base-sha' } });
      return json({ message: 'Not Found' }, 404);
    }

    if (tail[0] === 'git' && tail[1] === 'refs') {
      if (method === 'DELETE') {
        record.deletedBranches.push(decodeURIComponent(tail.slice(3).join('/')));
        return new Response(null, { status: 204 });
      }
      const body = JSON.parse(String(init?.body)) as { ref: string };
      const branch = body.ref.replace(/^refs\/heads\//, '');
      record.createdBranches.push(branch);
      return json({ ref: body.ref, object: { sha: 'new-sha' } });
    }

    if (tail[0] === 'contents') {
      const path = decodeURIComponent(tail.slice(1).join('/'));
      if (method === 'GET') {
        const source = files[path];
        if (source === undefined) return json({ message: 'Not Found' }, 404);
        return json({ name: path.split('/').pop(), path, sha: `sha-${path}`, content: encodeGitHubContent(source), encoding: 'base64' });
      }
      const body = JSON.parse(String(init?.body)) as { content: string; branch: string };
      const bytes = Uint8Array.from(atob(body.content), (c) => c.charCodeAt(0));
      record.commits.push({ path, content: new TextDecoder().decode(bytes), branch: body.branch });
      return json({ sha: `committed-${path}` });
    }

    if (tail[0] === 'pulls') {
      const body = JSON.parse(String(init?.body)) as { head: string; base: string };
      record.pulls.push({ head: body.head, base: body.base });
      return json({ number: 1, html_url: `https://github.com/owner/repo/pull/1` }, 201);
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

const CTX = { token: 't', owner: 'owner', repo: 'repo', analysisId: 'analysis-1', issueNumber: 7 };

/** `ApplyFixResult.success` is a plain boolean, so the union needs an explicit narrowing step. */
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
  test('creates a branch, commits the applied file and opens a pull request', async () => {
    const source = 'function f() {\n  return 1;\n}\n';
    const stub = stubGitHub({ 'src/a.js': source });
    try {
      const result = await applyPatchToGitHub({
        ...CTX,
        patch: {
          summary: 'Log the return value for easier debugging.',
          files: [
            {
              path: 'src/a.js',
              additions: 1,
              deletions: 0,
              hunks: [
                hunk([
                  { type: 'context', content: '  return 1;' },
                  { type: 'added', content: '  console.log(1);' },
                ]),
              ],
            },
          ],
        },
      });

      assert.equal(result.success, true);
      if (!result.success) return;
      assert.match(result.branch, /^BugWiser\/fix\/issue-7-/);
      assert.deepEqual(result.filesChanged, ['src/a.js']);
      assert.equal(result.defaultBranch, 'main');
      assert.equal(result.pullRequestUrl, 'https://github.com/owner/repo/pull/1');

      assert.equal(stub.record.createdBranches.length, 1);
      assert.equal(stub.record.commits.length, 1);
      assert.equal(stub.record.commits[0].path, 'src/a.js');
      assert.equal(stub.record.commits[0].branch, result.branch);
      assert.equal(stub.record.commits[0].content, 'function f() {\n  return 1;\n  console.log(1);\n}\n');
      assert.deepEqual(stub.record.pulls, [{ head: result.branch, base: 'main' }]);
      assert.deepEqual(stub.record.deletedBranches, []);
    } finally {
      stub.restore();
    }
  });

  test('stale content fails with an honest error, commits nothing and removes the branch', async () => {
    const stub = stubGitHub({ 'src/a.js': 'function f() {\n  return 2;\n}\n' });
    try {
      const result = await applyPatchToGitHub({
        ...CTX,
        patch: {
          summary: 'Log the return value for easier debugging.',
          files: [
            {
              path: 'src/a.js',
              additions: 1,
              deletions: 0,
              hunks: [
                hunk([
                  { type: 'context', content: '  return 1;' },
                  { type: 'added', content: '  console.log(1);' },
                ]),
              ],
            },
          ],
        },
      });

      const failure = failureOf(result);
      assert.match(failure.error, /No files could be applied/);
      assert.match(failure.error, /Expected content not found/);
      assert.match(failure.error, /The file may have changed since analysis/);
      assert.equal(failure.code, 'patch_validation_failed');

      assert.equal(stub.record.commits.length, 0);
      assert.equal(stub.record.createdBranches.length, 1);
      assert.deepEqual(stub.record.deletedBranches, stub.record.createdBranches);
      assert.deepEqual(stub.record.pulls, []);
    } finally {
      stub.restore();
    }
  });

  test('a patch with no changes never leaves a branch behind', async () => {
    const stub = stubGitHub({ 'src/a.js': 'const a = 1;\n' });
    try {
      const result = await applyPatchToGitHub({
        ...CTX,
        patch: {
          summary: 'Nothing to change in this file after all.',
          files: [{ path: 'src/a.js', additions: 0, deletions: 0, hunks: [hunk([{ type: 'context', content: 'const a = 1;' }])] }],
        },
      });

      const failure = failureOf(result);
      assert.match(failure.error, /no changes/);
      assert.equal(stub.record.commits.length, 0);
      assert.equal(stub.record.createdBranches.length, 1);
      assert.deepEqual(stub.record.deletedBranches, stub.record.createdBranches);
    } finally {
      stub.restore();
    }
  });

  test('reports a missing file without committing anything', async () => {
    const stub = stubGitHub({});
    try {
      const result = await applyPatchToGitHub({
        ...CTX,
        patch: {
          summary: 'Update a file the repository does not contain.',
          files: [
            {
              path: 'src/missing.js',
              additions: 1,
              deletions: 0,
              hunks: [hunk([{ type: 'context', content: 'const a = 1;' }, { type: 'added', content: 'const b = 2;' }])],
            },
          ],
        },
      });

      const failure = failureOf(result);
      assert.match(failure.error, /src\/missing\.js: File not found on branch/);
      assert.equal(stub.record.commits.length, 0);
      assert.deepEqual(stub.record.deletedBranches, stub.record.createdBranches);
    } finally {
      stub.restore();
    }
  });

  test('non-ASCII context survives get → apply → commit byte for byte', async () => {
    const source = '// caf\u00e9 \u4e16\u754c\nfunction greet() {\n  return "\u6b22\u8fce";\n}\n';
    const stub = stubGitHub({ 'src/greet.js': source });
    try {
      const result = await applyPatchToGitHub({
        ...CTX,
        patch: {
          summary: 'Return an ASCII greeting alongside the localized one.',
          files: [
            {
              path: 'src/greet.js',
              additions: 1,
              deletions: 0,
              hunks: [
                hunk([
                  { type: 'context', content: 'function greet() {' },
                  { type: 'context', content: '  return "\u6b22\u8fce";' },
                  { type: 'added', content: '  // \u6ce8\u91ca' },
                ]),
              ],
            },
          ],
        },
      });

      assert.equal(result.success, true);
      if (!result.success) return;
      assert.equal(stub.record.commits.length, 1);
      assert.equal(
        stub.record.commits[0].content,
        '// caf\u00e9 \u4e16\u754c\nfunction greet() {\n  return "\u6b22\u8fce";\n  // \u6ce8\u91ca\n}\n'
      );
    } finally {
      stub.restore();
    }
  });
});

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
