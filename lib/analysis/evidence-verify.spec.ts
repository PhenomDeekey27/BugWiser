import assert from 'node:assert/strict';
import { verifyAffectedFiles, verifyEvidenceClaims } from './evidence-verify.ts';

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

const source = ['function add(a, b) {', '  return a + b;', '}', '', 'module.exports = { add };'].join(
  '\n'
);

const sources = new Map([['src/add.js', source]]);
const known = ['src/add.js', 'src/other.js'];

test('verifies a claim whose snippet matches the referenced lines', () => {
  const report = verifyEvidenceClaims(
    [{ file: 'src/add.js', lineStart: 1, lineEnd: 3, code: 'function add(a, b) {\n  return a + b;' }],
    sources,
    known
  );
  assert.equal(report.summary.verified, 1);
  assert.equal(report.verified[0].verification.status, 'verified');
  assert.equal(report.summary.status, 'verified');
});

test('rejects a file that is not in the repository at all', () => {
  const report = verifyEvidenceClaims(
    [{ file: 'src/invented.js', lineStart: 1, lineEnd: 2, code: 'nope' }],
    sources,
    known
  );
  assert.equal(report.summary.rejected, 1);
  assert.equal(report.rejected[0].verification.status, 'rejected');
  assert.match(report.rejected[0].verification.reason, /not part of the indexed/);
});

test('marks a real but unfetched file as unverified instead of rejected', () => {
  const report = verifyEvidenceClaims(
    [{ file: 'src/other.js', lineStart: 1, lineEnd: 1, code: 'x' }],
    sources,
    known
  );
  assert.equal(report.summary.unverified, 1);
  assert.match(report.unverified[0].verification.reason, /not retrieved/);
});

test('rejects out-of-bounds line ranges', () => {
  const report = verifyEvidenceClaims(
    [{ file: 'src/add.js', lineStart: 40, lineEnd: 42, code: 'function add(a, b) {' }],
    sources,
    known
  );
  assert.equal(report.summary.rejected, 1);
  assert.match(report.rejected[0].verification.reason, /outside the file bounds/);
});

test('reports a corrected range when the snippet exists elsewhere', () => {
  const report = verifyEvidenceClaims(
    [{ file: 'src/add.js', lineStart: 10, lineEnd: 12, code: 'module.exports = { add };' }],
    sources,
    known
  );
  assert.equal(report.summary.rejected, 1);
  assert.deepEqual(report.rejected[0].verification.correctedRange, {
    lineStart: 5,
    lineEnd: 5,
  });
});

test('rejects an invented snippet inside a real file', () => {
  const report = verifyEvidenceClaims(
    [{ file: 'src/add.js', lineStart: 1, lineEnd: 3, code: 'return a * b;' }],
    sources,
    known
  );
  assert.equal(report.summary.rejected, 1);
  assert.match(report.rejected[0].verification.reason, /not found anywhere/);
});

test('rejects traversal paths', () => {
  const report = verifyEvidenceClaims(
    [{ file: '../secrets/.env', lineStart: 1, lineEnd: 1, code: 'KEY=1' }],
    sources,
    known
  );
  assert.equal(report.summary.rejected, 1);
  assert.match(report.rejected[0].verification.reason, /repository-relative/);
});

test('a mixed report is partial, not verified', () => {
  const report = verifyEvidenceClaims(
    [
      { file: 'src/add.js', lineStart: 1, lineEnd: 3, code: 'function add(a, b) {' },
      { file: 'src/invented.js', lineStart: 1, lineEnd: 1, code: 'x' },
    ],
    sources,
    known
  );
  assert.equal(report.summary.status, 'partial');
  assert.equal(report.summary.verified, 1);
  assert.equal(report.summary.rejected, 1);
});

test('filters affected files down to the known snapshot', () => {
  const result = verifyAffectedFiles(['src/add.js', 'src/invented.js', 'src/add.js'], known);
  assert.deepEqual(result.files, ['src/add.js']);
  assert.deepEqual(result.unknownFiles, ['src/invented.js']);
});

run();
