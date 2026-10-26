import assert from 'node:assert/strict';
import {
  DEFAULT_FILTER_LIMITS,
  RepositoryTooLargeError,
  filterTreeEntries,
  isSecretFilePath,
} from './filter.ts';

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

const language = (path: string): string => (path.endsWith('.ts') ? 'TypeScript' : 'Unknown');

const entry = (path: string, size = 10) => ({
  path,
  mode: '100644',
  type: 'blob',
  size,
  sha: 'a'.repeat(40),
});

test('excludes dependencies, generated output and binaries', () => {
  const filtered = filterTreeEntries(
    [
      entry('src/index.ts'),
      entry('node_modules/pkg/index.js'),
      entry('dist/bundle.js'),
      entry('public/logo.png'),
      entry('.git/config'),
      entry('README.md'),
    ],
    language
  );
  const active = filtered.filter((file) => !file.isIgnored).map((file) => file.path);
  assert.deepEqual(active.sort(), ['README.md', 'src/index.ts']);
});

test('excludes secret-bearing files but keeps templates', () => {
  assert.equal(isSecretFilePath('.env'), true);
  assert.equal(isSecretFilePath('.env.local'), true);
  assert.equal(isSecretFilePath('config/id_rsa'), true);
  assert.equal(isSecretFilePath('certs/server.pem'), true);
  assert.equal(isSecretFilePath('.env.example'), false);
  assert.equal(isSecretFilePath('docs/key.md'), false);
});

test('excludes oversized files with an explicit reason', () => {
  const filtered = filterTreeEntries(
    [entry('src/small.ts', 100), entry('src/huge.ts', 5000)],
    language,
    { maxFileSizeBytes: 1024 }
  );
  const huge = filtered.find((file) => file.path === 'src/huge.ts');
  assert.equal(huge?.isIgnored, true);
  assert.equal(huge?.exclusionReason, 'oversized');
  assert.equal(filtered.find((file) => file.path === 'src/small.ts')?.isIgnored, false);
});

test('fails the index when the active file budget is exceeded', () => {
  const entries = Array.from({ length: 5 }, (_, index) => entry(`src/file-${index}.ts`));
  try {
    filterTreeEntries(entries, language, { maxActiveFiles: 3 });
    assert.fail('expected RepositoryTooLargeError');
  } catch (err) {
    assert.ok(err instanceof RepositoryTooLargeError);
    assert.equal(err.activeFiles, 5);
    assert.equal(err.limit, 3);
  }
});

test('default limits are explicit', () => {
  assert.equal(DEFAULT_FILTER_LIMITS.maxFileSizeBytes, 1024 * 1024);
  assert.ok(DEFAULT_FILTER_LIMITS.maxActiveFiles >= 10_000);
});

run();
