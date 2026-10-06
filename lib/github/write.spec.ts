import assert from 'node:assert/strict';
import { decodeGitHubContent, encodeGitHubContent } from './write.ts';

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

const SAMPLES = [
  'plain ascii',
  'caf\u00e9 na\u00efve',
  '\u4e16\u754c \u6d4b\u8bd5',
  '\ud83d\ude80 emoji \ud83e\udde9',
  'mixed: \u00e9\u4e16\ud83d\ude80 trailing',
  'line one\nline two\n',
];

suite('GitHub content encoding', () => {
  test('round-trips every sample', () => {
    for (const sample of SAMPLES) {
      assert.equal(decodeGitHubContent(encodeGitHubContent(sample)), sample, `round-trip failed for ${JSON.stringify(sample)}`);
    }
  });

  test('emits pure base64 that never throws on non-ASCII input', () => {
    for (const sample of SAMPLES) {
      const encoded = encodeGitHubContent(sample);
      assert.match(encoded, /^[A-Za-z0-9+/]*={0,2}$/);
      // A Latin-1 `btoa` implementation would either throw or corrupt here.
      assert.ok(!/[^\x00-\x7f]/.test(encoded));
    }
  });

  test('decodes base64 wrapped across lines', () => {
    const text = '\u6f22\u5b57 \u30c6\u30b9\u30c8 with accents \u00e9\u00e8';
    const wrapped = encodeGitHubContent(text).replace(/(.{16})/g, '$1\n');
    assert.ok(wrapped.includes('\n'));
    assert.equal(decodeGitHubContent(wrapped), text);
  });

  test('decodes base64 that GitHub padded with a trailing newline', () => {
    const text = 'module.exports = { \u00e0\u00e9\u00ee };';
    assert.equal(decodeGitHubContent(`${encodeGitHubContent(text)}\n`), text);
  });
});

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
