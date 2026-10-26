import assert from 'node:assert/strict';
import { renderUnifiedDiff, stagePatchInWorkspace } from './workspace-core.ts';

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

const sha = 'b'.repeat(40);
const source = ['function add(a, b) {', '  return a + b;', '}', '', 'module.exports = { add };'].join('\n');

const patch = {
  summary: 'Fix addition',
  files: [
    {
      path: 'src/add.js',
      additions: 1,
      deletions: 1,
      hunks: [
        {
          oldStart: 2,
          oldLines: 1,
          newStart: 2,
          newLines: 1,
          lines: [
            { type: 'removed' as const, content: '  return a + b;' },
            { type: 'added' as const, content: '  return a * b;' },
          ],
        },
      ],
    },
  ],
};

const inputs = {
  patch,
  sources: [{ path: 'src/add.js', content: source }],
  analysisCommitSha: sha,
  baseCommitSha: sha,
};

test('stages a patch against the pinned snapshot', () => {
  const result = stagePatchInWorkspace(inputs);
  assert.ok(result.ok);
  assert.equal(result.files.length, 1);
  assert.match(result.files[0].content, /return a \* b/);
  assert.equal(result.files[0].baseContent, source);
  assert.equal(result.files[0].status, 'modified');
});

test('renders a unified diff for the staged file', () => {
  const diff = renderUnifiedDiff('src/add.js', patch.files[0]);
  assert.match(diff, /^--- a\/src\/add\.js/m);
  assert.match(diff, /^\+\+\+ b\/src\/add\.js/m);
  assert.match(diff, /^@@ -2,1 \+2,1 @@/m);
  assert.match(diff, /^-  return a \+ b;/m);
  assert.match(diff, /^\+  return a \* b;/m);
});

test('refuses a commit mismatch', () => {
  const result = stagePatchInWorkspace({ ...inputs, baseCommitSha: 'c'.repeat(40) });
  assert.ok(!result.ok);
  assert.equal(result.code, 'commit_mismatch');
});

test('refuses an analysis that is not pinned to a commit', () => {
  const result = stagePatchInWorkspace({ ...inputs, analysisCommitSha: null });
  assert.ok(!result.ok);
  assert.equal(result.code, 'invalid_base_commit');
});

test('refuses files that were not retrieved for the analysis', () => {
  const result = stagePatchInWorkspace({ ...inputs, sources: [] });
  assert.ok(!result.ok);
  assert.equal(result.code, 'file_not_in_snapshot');
});

test('refuses paths outside the repository', () => {
  const traversal = {
    summary: 'bad',
    files: [
      {
        path: '../outside.js',
        hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: [{ type: 'added' as const, content: 'x' }] }],
      },
    ],
  };
  const result = stagePatchInWorkspace({ ...inputs, patch: traversal });
  assert.ok(!result.ok);
  assert.equal(result.code, 'unsafe_path');
});

test('refuses secret-bearing files', () => {
  const secret = {
    summary: 'bad',
    files: [
      {
        path: '.env',
        hunks: [{ oldStart: 2, oldLines: 0, newStart: 2, newLines: 1, lines: [{ type: 'added' as const, content: 'KEY=1' }] }],
      },
    ],
  };
  const result = stagePatchInWorkspace({
    ...inputs,
    patch: secret,
    sources: [{ path: '.env', content: 'A=1\n' }],
  });
  assert.ok(!result.ok);
  assert.equal(result.code, 'secret_file');
});

test('reports a hunk that does not apply', () => {
  const bad = {
    summary: 'bad',
    files: [
      {
        path: 'src/add.js',
        hunks: [
          {
            oldStart: 2,
            oldLines: 1,
            newStart: 2,
            newLines: 1,
            lines: [
              { type: 'removed' as const, content: '  return a - b;' },
              { type: 'added' as const, content: '  return a * b;' },
            ],
          },
        ],
      },
    ],
  };
  const result = stagePatchInWorkspace({ ...inputs, patch: bad });
  assert.ok(!result.ok);
  assert.equal(result.code, 'hunk_failed');
});

test('rejects a patch with no real changes', () => {
  const empty = { summary: 'noop', files: [] };
  const result = stagePatchInWorkspace({ ...inputs, patch: empty });
  assert.ok(!result.ok);
  assert.equal(result.code, 'no_files');
});

test('enforces the workspace file limit', () => {
  const many = {
    summary: 'many',
    files: Array.from({ length: 3 }, (_, index) => ({
      path: `src/f${index}.js`,
      hunks: [
        {
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          lines: [
            { type: 'removed' as const, content: 'const x = 1;' },
            { type: 'added' as const, content: 'const x = 2;' },
          ],
        },
      ],
    })),
  };
  const result = stagePatchInWorkspace({
    ...inputs,
    patch: many,
    sources: Array.from({ length: 3 }, (_, index) => ({ path: `src/f${index}.js`, content: 'const x = 1;' })),
    maxFiles: 2,
  });
  assert.ok(!result.ok);
  assert.equal(result.code, 'too_many_files');
});

run();
