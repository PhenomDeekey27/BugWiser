import assert from 'node:assert/strict';
import {
  buildRepositoryContext,
  extractSymbols,
  inferVerificationCommands,
  isTestFilePath,
  manifestPathsToFetch,
} from './repository-context.ts';

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

const indexed = [
  { path: 'package.json', isIgnored: false, language: 'JSON' },
  { path: 'pnpm-lock.yaml', isIgnored: false, language: 'YAML' },
  { path: 'tsconfig.json', isIgnored: false, language: 'JSON' },
  { path: 'src/index.ts', isIgnored: false, language: 'TypeScript' },
  { path: 'src/index.test.ts', isIgnored: false, language: 'TypeScript' },
  { path: 'node_modules/x/index.js', isIgnored: true, language: 'JavaScript' },
];

const packageJson = JSON.stringify({
  scripts: { test: 'vitest run', typecheck: 'tsc --noEmit', build: 'next build' },
  devDependencies: { vitest: '^1.0.0' },
});

test('detects the package manager from lockfiles', () => {
  const context = buildRepositoryContext(indexed, [{ path: 'package.json', content: packageJson }], []);
  assert.equal(context.packageManager, 'pnpm');
});

test('infers only commands supported by the manifests', () => {
  const plan = inferVerificationCommands(indexed, [
    { path: 'package.json', content: packageJson },
  ]);
  assert.deepEqual(
    plan.commands.map((command) => command.command),
    ['pnpm run test', 'pnpm run typecheck', 'pnpm run build']
  );
  assert.equal(plan.status, 'not_run');
  assert.match(plan.reason, /not run/);
});

test('does not invent a test command when no test script exists', () => {
  const plan = inferVerificationCommands(indexed, [
    { path: 'package.json', content: JSON.stringify({ scripts: { build: 'next build' } }) },
  ]);
  assert.ok(!plan.commands.some((command) => command.name === 'unit tests'));
});

test('detects language-native test commands', () => {
  const goPlan = inferVerificationCommands([{ path: 'go.mod' }], [{ path: 'go.mod', content: 'module x' }]);
  assert.deepEqual(goPlan.commands.map((command) => command.command), ['go test ./...']);

  const rustPlan = inferVerificationCommands(
    [{ path: 'Cargo.toml' }],
    [{ path: 'Cargo.toml', content: '[package]' }]
  );
  assert.deepEqual(rustPlan.commands.map((command) => command.command), ['cargo test']);
});

test('recognises common test file conventions', () => {
  assert.equal(isTestFilePath('src/a.test.ts'), true);
  assert.equal(isTestFilePath('src/__tests__/a.ts'), true);
  assert.equal(isTestFilePath('pkg/service_test.go'), true);
  assert.equal(isTestFilePath('tests/test_api.py'), true);
  assert.equal(isTestFilePath('src/CartTest.java'), true);
  assert.equal(isTestFilePath('src/cart.ts'), false);
});

test('extracts symbols with real file and line positions', () => {
  const symbols = extractSymbols(
    'src/math.ts',
    ['export function add(a: number, b: number) {', '  return a + b;', '}', '', 'export const zero = 0;'].join('\n')
  );
  assert.deepEqual(symbols, [
    { file: 'src/math.ts', name: 'add', kind: 'function', line: 1 },
    { file: 'src/math.ts', name: 'zero', kind: 'constant', line: 5 },
  ]);
});

test('extracts Python and Go symbols', () => {
  assert.deepEqual(extractSymbols('app/main.py', 'def run():\n    pass\nclass App:\n    pass'), [
    { file: 'app/main.py', name: 'run', kind: 'function', line: 1 },
    { file: 'app/main.py', name: 'App', kind: 'class', line: 3 },
  ]);
  assert.deepEqual(extractSymbols('main.go', 'func main() {\n}\ntype Server struct {\n}'), [
    { file: 'main.go', name: 'main', kind: 'function', line: 1 },
    { file: 'main.go', name: 'Server', kind: 'type', line: 3 },
  ]);
});

test('builds a context that only names files present in the snapshot', () => {
  const context = buildRepositoryContext(
    indexed,
    [{ path: 'package.json', content: packageJson }],
    [{ path: 'src/index.ts', content: 'export function main() {}\n' }]
  );
  assert.deepEqual(context.testFiles, ['src/index.test.ts']);
  assert.ok(context.manifests.includes('package.json'));
  assert.ok(context.configFiles.includes('tsconfig.json'));
  assert.deepEqual(context.languages, ['TypeScript']);
  assert.equal(context.symbols[0].name, 'main');
  assert.equal(context.limits.symbolsTruncated, false);
});

test('truncates the symbol index at the configured bound', () => {
  const content = Array.from({ length: 10 }, (_, index) => `export function fn${index}() {}`).join('\n');
  const context = buildRepositoryContext(indexed, [], [{ path: 'src/many.ts', content }], 3);
  assert.equal(context.symbols.length, 3);
  assert.equal(context.limits.symbolsTruncated, true);
});

test('selects manifest paths from indexed metadata only', () => {
  const paths = manifestPathsToFetch([
    { path: 'packages/a/package.json', isIgnored: false },
    { path: 'node_modules/b/package.json', isIgnored: true },
    { path: 'go.mod', isIgnored: false },
  ]);
  assert.deepEqual(paths, ['packages/a/package.json', 'go.mod']);
});

run();
