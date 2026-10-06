import assert from 'node:assert/strict';
import { parsePatchResponse, validatePatch } from './patch.ts';

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

const VALID_PATCH = {
  summary: 'Return the discounted total before adding shipping.',
  files: [
    {
      path: 'src/services/pricingService.js',
      hunks: [
        {
          oldStart: 24,
          oldLines: 2,
          newStart: 24,
          newLines: 3,
          lines: [
            { type: 'context', content: 'function calculateTotal(a, b, c) {' },
            { type: 'removed', content: '  return a - b + c;' },
            { type: 'added', content: '  const net = a - b;' },
            { type: 'added', content: '  return net + c;' },
            { type: 'context', content: '}' },
          ],
        },
      ],
    },
  ],
};

function parse(json: string) {
  return parsePatchResponse(json);
}

// ── parsePatchResponse ──────────────────────────────────────────────────────
suite('parsePatchResponse', () => {
  test('parses bare JSON', () => {
    const result = parse(JSON.stringify(VALID_PATCH));
    assert.equal(result.files.length, 1);
    assert.equal(result.files[0].path, 'src/services/pricingService.js');
    assert.equal(result.summary, VALID_PATCH.summary);
  });

  test('parses a single markdown-fenced JSON response', () => {
    const result = parse('```json\n' + JSON.stringify(VALID_PATCH) + '\n```');
    assert.equal(result.files.length, 1);
    assert.equal(result.summary, VALID_PATCH.summary);
  });

  test('returns no files for prose that is not JSON', () => {
    const result = parse('I could not find a safe way to change that file.');
    assert.deepEqual(result.files, []);
    assert.equal(result.summary, 'Failed to parse AI response');
  });

  test('defaults a missing summary', () => {
    const result = parse(JSON.stringify({ files: [] }));
    assert.equal(result.summary, 'No summary');
    assert.deepEqual(result.files, []);
  });

  test('expands packed line content and derives additions/deletions', () => {
    const result = parse(
      JSON.stringify({
        summary: 'Adds two lines to the response builder module.',
        files: [
          {
            path: 'src/a.js',
            hunks: [
              {
                oldStart: 1,
                oldLines: 1,
                newStart: 1,
                newLines: 3,
                lines: [
                  { type: 'context', content: 'function f() {\n' },
                  { type: 'removed', content: '  return 1;\n' },
                  { type: 'added', content: '  const a = 1;\n  return a;\n' },
                ],
              },
            ],
          },
        ],
      })
    );

    const file = result.files[0];
    assert.equal(file.additions, 2);
    assert.equal(file.deletions, 1);
    assert.deepEqual(
      file.hunks[0].lines.map((line) => line.content),
      ['function f() {', '  return 1;', '  const a = 1;', '  return a;']
    );
  });

  test('treats a non-array files field as no files', () => {
    const result = parse(JSON.stringify({ summary: 'Nothing to change here.', files: 'nope' }));
    assert.deepEqual(result.files, []);
  });
});

// ── validatePatch ───────────────────────────────────────────────────────────
suite('validatePatch', () => {
  test('accepts a well-formed patch', () => {
    assert.deepEqual(validatePatch(parse(JSON.stringify(VALID_PATCH))), { valid: true });
  });

  test('rejects a summary that is too short', () => {
    const result = validatePatch({ summary: 'fix', files: [] });
    assert.deepEqual(result, { valid: false, error: 'Summary too short' });
  });

  test('rejects a non-array files field', () => {
    const result = validatePatch({ summary: 'A long enough summary', files: 'x' } as never);
    assert.deepEqual(result, { valid: false, error: 'Invalid files array' });
  });

  test('rejects no files unless the summary says no change is possible', () => {
    const noChange = validatePatch({
      summary: 'No changes are required to resolve this issue.',
      files: [],
    });
    assert.deepEqual(noChange, { valid: true });

    const unexplained = validatePatch({ summary: 'I looked at the code closely.', files: [] });
    assert.deepEqual(unexplained, { valid: false, error: 'No files in patch' });
  });

  test('rejects a file without a path', () => {
    const patch = JSON.parse(JSON.stringify(VALID_PATCH));
    patch.files[0].path = '';
    assert.deepEqual(validatePatch(parse(JSON.stringify(patch))), {
      valid: false,
      error: 'Invalid file path',
    });
  });

  test('rejects a file without hunks', () => {
    const patch = JSON.parse(JSON.stringify(VALID_PATCH));
    patch.files[0].hunks = [];
    assert.deepEqual(validatePatch(parse(JSON.stringify(patch))), {
      valid: false,
      error: 'No hunks in file src/services/pricingService.js',
    });
  });

  test('rejects non-numeric line numbers', () => {
    const patch = JSON.parse(JSON.stringify(VALID_PATCH));
    patch.files[0].hunks[0].oldStart = 'x';
    assert.equal(validatePatch(parse(JSON.stringify(patch))).error, 'Invalid old line numbers in src/services/pricingService.js');

    const other = JSON.parse(JSON.stringify(VALID_PATCH));
    other.files[0].hunks[0].newLines = 'x';
    assert.equal(validatePatch(parse(JSON.stringify(other))).error, 'Invalid new line numbers in src/services/pricingService.js');
  });

  test('rejects a hunk with no lines', () => {
    const patch = JSON.parse(JSON.stringify(VALID_PATCH));
    patch.files[0].hunks[0].lines = [];
    assert.equal(validatePatch(parse(JSON.stringify(patch))).error, 'No lines in hunk of src/services/pricingService.js');
  });

  test('rejects an invalid line type', () => {
    const patch = JSON.parse(JSON.stringify(VALID_PATCH));
    patch.files[0].hunks[0].lines[0].type = 'weird';
    assert.equal(validatePatch(parse(JSON.stringify(patch))).error, 'Invalid line type in src/services/pricingService.js');
  });

  test('rejects non-string line content', () => {
    const patch = JSON.parse(JSON.stringify(VALID_PATCH));
    patch.files[0].hunks[0].lines[0].content = 42;
    assert.equal(validatePatch(parse(JSON.stringify(patch))).error, 'Invalid line content in src/services/pricingService.js');
  });
});

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
