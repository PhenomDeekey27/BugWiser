import assert from 'node:assert/strict';
import type { PatchHunk } from '@/types';
import { buildDiffLineRows } from './diffLineRows.ts';

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

// Patch artifacts from the model carry no per-line display fields, so the spec
// supplies the same shape the persisted artifact has.
type RawLine = { type: string; content: string };
function hunk(input: { oldStart?: number; newStart?: number; lines: RawLine[] }): PatchHunk {
  return input as unknown as PatchHunk;
}

suite('buildDiffLineRows', () => {
  test('gives every row a unique key', () => {
    const rows = buildDiffLineRows(
      hunk({
        oldStart: 10,
        newStart: 10,
        lines: [
          { type: 'context', content: 'function f() {' },
          { type: 'removed', content: '  return 1;' },
          { type: 'added', content: '  return 2;' },
          { type: 'context', content: '}' },
        ],
      })
    );
    const keys = rows.map((row) => row.key);
    assert.equal(new Set(keys).size, keys.length);
    assert.ok(keys.every((key) => typeof key === 'string' && key.length > 0));
  });

  test('derives keys from the old/new numbering, not the array index', () => {
    const rows = buildDiffLineRows(
      hunk({
        oldStart: 10,
        newStart: 10,
        lines: [
          { type: 'context', content: 'a' },
          { type: 'removed', content: 'b' },
          { type: 'added', content: 'B' },
          { type: 'context', content: 'c' },
        ],
      })
    );
    assert.deepEqual(
      rows.map((row) => [row.key, row.number, row.type]),
      [
        ['old:10', 10, 'context'],
        ['old:11', 11, 'removed'],
        ['new:11', 11, 'added'],
        ['old:12', 12, 'context'],
      ]
    );
  });

  test('is stable across re-renders', () => {
    const input = hunk({
      oldStart: 3,
      newStart: 3,
      lines: [
        { type: 'context', content: 'const a = 1;' },
        { type: 'added', content: 'const b = 2;' },
      ],
    });
    assert.deepEqual(buildDiffLineRows(input), buildDiffLineRows(input));
  });

  test('expands packed model content into one row per physical line', () => {
    const rows = buildDiffLineRows(
      hunk({
        oldStart: 5,
        newStart: 5,
        lines: [
          { type: 'removed', content: 'old one;\nold two;\n' },
          { type: 'added', content: 'new one;\nnew two;\n' },
        ],
      })
    );
    assert.deepEqual(
      rows.map((row) => [row.key, row.content]),
      [
        ['old:5', 'old one;'],
        ['old:6', 'old two;'],
        ['new:5', 'new one;'],
        ['new:6', 'new two;'],
      ]
    );
    assert.equal(new Set(rows.map((row) => row.key)).size, rows.length);
  });

  test('falls back to line 1 when the hunk header is missing or bogus', () => {
    const rows = buildDiffLineRows(
      hunk({
        lines: [
          { type: 'context', content: 'a' },
          { type: 'added', content: 'b' },
        ],
      })
    );
    // The context line consumes old:1 AND new:1, so the added line that
    // follows is new:2 — exactly how it appears in the patched file.
    assert.deepEqual(rows.map((row) => row.key), ['old:1', 'new:2']);
  });
});

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
