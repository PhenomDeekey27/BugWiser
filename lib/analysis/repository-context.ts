// Grounded repository context derived from files that were actually indexed.
//
// Nothing here guesses project structure: manifests, test files and symbols are
// only reported when the corresponding file exists in the snapshot. Test
// commands are inferred from real manifest contents (for example a `test`
// script in package.json) and are marked `not_run` because BugWiser does not
// host an execution sandbox.

export interface IndexedFileLike {
  path: string;
  size?: number;
  language?: string;
  isIgnored?: boolean;
}

export interface ManifestFile {
  path: string;
  content: string;
}

export interface SymbolRef {
  file: string;
  name: string;
  kind: 'function' | 'class' | 'method' | 'interface' | 'type' | 'constant' | 'export';
  line: number;
}

export interface VerificationCommand {
  name: string;
  command: string;
  source: string;
  required: boolean;
}

export interface VerificationPlan {
  commands: VerificationCommand[];
  status: 'not_run';
  reason: string;
  regressionTests: string[];
}

export interface RepositoryContext {
  packageManager: string | null;
  manifests: string[];
  configFiles: string[];
  testFiles: string[];
  languages: string[];
  symbols: SymbolRef[];
  verification: VerificationPlan;
  limits: {
    symbolsTruncated: boolean;
    maxSymbols: number;
  };
}

const MANIFEST_NAMES = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'tsconfig.json',
  'jsconfig.json',
  'pyproject.toml',
  'requirements.txt',
  'setup.py',
  'Pipfile',
  'poetry.lock',
  'Cargo.toml',
  'Cargo.lock',
  'go.mod',
  'go.sum',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'Gemfile',
  'Gemfile.lock',
  'composer.json',
  'Makefile',
  'CMakeLists.txt',
]);

const CONFIG_NAMES = new Set([
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  'vite.config.ts',
  'vite.config.js',
  'vitest.config.ts',
  'vitest.config.js',
  'jest.config.js',
  'jest.config.ts',
  'tsconfig.json',
  'eslint.config.js',
  'eslint.config.mjs',
  '.eslintrc.json',
  'pytest.ini',
  'tox.ini',
  'rustfmt.toml',
]);

const MAX_SYMBOLS = 2_000;
const MAX_SYMBOLS_PER_FILE = 200;

function filename(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1];
}

function extension(path: string): string {
  const name = filename(path);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

export function isTestFilePath(path: string): boolean {
  const name = filename(path);
  return (
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(name) ||
    /_test\.go$/.test(name) ||
    /^test_.*\.py$/.test(name) ||
    /^.*_test\.py$/.test(name) ||
    /Test\.(java|kt)$/.test(name) ||
    /(^|\/)(__tests__|tests?|spec)\//.test(path)
  );
}

function detectPackageManager(paths: Set<string>): string | null {
  if (paths.has('pnpm-lock.yaml')) return 'pnpm';
  if (paths.has('yarn.lock')) return 'yarn';
  if (paths.has('bun.lockb')) return 'bun';
  if (paths.has('package-lock.json')) return 'npm';
  if (paths.has('package.json')) return 'npm';
  if (paths.has('poetry.lock')) return 'poetry';
  if (paths.has('Pipfile')) return 'pipenv';
  if (paths.has('requirements.txt') || paths.has('pyproject.toml')) return 'pip';
  if (paths.has('Cargo.toml')) return 'cargo';
  if (paths.has('go.mod')) return 'go';
  if (paths.has('pnpm-workspace.yaml')) return 'pnpm';
  return null;
}

function packageManagerRun(packageManager: string | null, script: string): string {
  switch (packageManager) {
    case 'pnpm':
      return `pnpm run ${script}`;
    case 'yarn':
      return `yarn ${script}`;
    case 'bun':
      return `bun run ${script}`;
    default:
      return `npm run ${script}`;
  }
}

function readPackageScripts(manifest: ManifestFile | undefined): Record<string, string> {
  if (!manifest) return {};
  try {
    const parsed = JSON.parse(manifest.content) as { scripts?: Record<string, unknown> };
    if (!parsed.scripts || typeof parsed.scripts !== 'object') return {};
    const scripts: Record<string, string> = {};
    for (const [name, value] of Object.entries(parsed.scripts)) {
      if (typeof value === 'string' && value.trim()) scripts[name] = value;
    }
    return scripts;
  } catch {
    return {};
  }
}

function hasDependency(manifest: ManifestFile | undefined, dependency: string): boolean {
  if (!manifest) return false;
  try {
    const parsed = JSON.parse(manifest.content) as {
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
      scripts?: Record<string, unknown>;
    };
    return Boolean(
      parsed.dependencies?.[dependency] ||
        parsed.devDependencies?.[dependency] ||
        Object.values(parsed.scripts || {}).some(
          (value) => typeof value === 'string' && value.includes(dependency)
        )
    );
  } catch {
    return false;
  }
}

/**
 * Builds a verification plan from manifests that exist in the snapshot.
 * Only commands supported by evidence in the repository are emitted.
 */
export function inferVerificationCommands(
  indexed: IndexedFileLike[],
  manifests: ManifestFile[]
): VerificationPlan {
  const paths = new Set(indexed.map((file) => file.path));
  const manifestByName = new Map<string, ManifestFile>();
  for (const manifest of manifests) manifestByName.set(manifest.path, manifest);

  const packageManager = detectPackageManager(paths);
  const commands: VerificationCommand[] = [];
  const add = (
    name: string,
    command: string,
    source: string,
    required = true
  ): void => {
    if (!commands.some((existing) => existing.command === command)) {
      commands.push({ name, command, source, required });
    }
  };

  const packageJson = manifestByName.get('package.json');
  const scripts = readPackageScripts(packageJson);

  if (scripts.test) {
    add('unit tests', packageManagerRun(packageManager, 'test'), 'package.json scripts.test');
  } else if (hasDependency(packageJson, 'vitest')) {
    add('unit tests', packageManagerRun(packageManager, 'test'), 'vitest dependency');
  }
  if (scripts.typecheck) {
    add('typecheck', packageManagerRun(packageManager, 'typecheck'), 'package.json scripts.typecheck');
  } else if (paths.has('tsconfig.json')) {
    add('typecheck', 'npx tsc --noEmit', 'tsconfig.json');
  }
  if (scripts.lint) {
    add('lint', packageManagerRun(packageManager, 'lint'), 'package.json scripts.lint', false);
  }
  if (scripts.build) {
    add('build', packageManagerRun(packageManager, 'build'), 'package.json scripts.build', false);
  }

  if (paths.has('pyproject.toml') || paths.has('pytest.ini') || paths.has('tox.ini')) {
    add('unit tests', 'pytest', 'python test configuration');
  } else if (
    paths.has('requirements.txt') &&
    (manifestByName.get('requirements.txt')?.content || '').toLowerCase().includes('pytest')
  ) {
    add('unit tests', 'pytest', 'requirements.txt includes pytest');
  }

  if (paths.has('go.mod')) {
    add('unit tests', 'go test ./...', 'go.mod');
  }
  if (paths.has('Cargo.toml')) {
    add('unit tests', 'cargo test', 'Cargo.toml');
  }
  if (paths.has('pom.xml')) {
    add('unit tests', 'mvn test', 'pom.xml');
  }
  if (paths.has('gradlew') || paths.has('gradlew.bat')) {
    add('unit tests', './gradlew test', 'Gradle wrapper');
  }
  if (paths.has('Makefile')) {
    const makefile = manifestByName.get('Makefile')?.content || '';
    if (/^test\s*:/m.test(makefile)) {
      add('unit tests', 'make test', 'Makefile test target');
    }
  }

  const regressionTests = indexed
    .filter((file) => !file.isIgnored && isTestFilePath(file.path))
    .map((file) => file.path)
    .slice(0, 200);

  return {
    commands,
    status: 'not_run',
    reason:
      commands.length > 0
        ? 'BugWiser has no isolated execution sandbox configured, so these commands were detected but not run.'
        : 'No supported test command could be detected from the repository manifests.',
    regressionTests,
  };
}

const SYMBOL_PATTERNS: Record<string, RegExp[]> = {
  ts: [
    /^\s*export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
    /^\s*export\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
    /^\s*export\s+(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/,
    /^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/,
    /^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
    /^\s*class\s+([A-Za-z_$][\w$]*)/,
  ],
  py: [
    /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/,
    /^\s*class\s+([A-Za-z_]\w*)/,
  ],
  go: [
    /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/,
    /^type\s+([A-Za-z_]\w*)\s+(?:struct|interface)/,
  ],
  rust: [
    /^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/,
    /^\s*(?:pub\s+)?(?:struct|enum|trait)\s+([A-Za-z_]\w*)/,
  ],
  java: [
    /^\s*(?:public|protected|private)?\s*(?:static\s+)?(?:final\s+)?class\s+([A-Za-z_]\w*)/,
    /^\s*(?:public|protected|private)\s+(?:static\s+)?[\w<>[\]]+\s+([A-Za-z_]\w*)\s*\(/,
  ],
};

function symbolLanguage(path: string): string | null {
  const ext = extension(path);
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts'].includes(ext)) return 'ts';
  if (ext === 'py') return 'py';
  if (ext === 'go') return 'go';
  if (ext === 'rs') return 'rust';
  if (ext === 'java' || ext === 'kt') return 'java';
  return null;
}

function classify(kindLine: string): SymbolRef['kind'] {
  if (/\bclass\b/.test(kindLine)) return 'class';
  if (/\binterface\b/.test(kindLine)) return 'interface';
  if (/\btype\b/.test(kindLine)) return 'type';
  if (/\b(?:const|let|var)\b/.test(kindLine)) return 'constant';
  if (/\bfn\b|\bfunction\b|\bdef\b/.test(kindLine)) return 'function';
  if (/\b(?:struct|enum|trait)\b/.test(kindLine)) return 'type';
  return 'function';
}

/**
 * Extracts a bounded symbol list from real source content. Regex-based on
 * purpose: it is a navigation aid, not a type-checked index, and the file+line
 * it reports is verified against the snapshot.
 */
export function extractSymbols(file: string, content: string): SymbolRef[] {
  const language = symbolLanguage(file);
  if (!language) return [];

  const patterns = SYMBOL_PATTERNS[language] || [];
  const symbols: SymbolRef[] = [];
  const lines = content.split('\n');

  for (let index = 0; index < lines.length && symbols.length < MAX_SYMBOLS_PER_FILE; index++) {
    const line = lines[index];
    if (line.length > 500) continue;
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (!match?.[1]) continue;
      symbols.push({
        file,
        name: match[1],
        kind: classify(line),
        line: index + 1,
      });
      break;
    }
  }

  return symbols;
}

export function buildRepositoryContext(
  indexed: IndexedFileLike[],
  manifests: ManifestFile[],
  sourceFiles: ManifestFile[],
  maxSymbols = MAX_SYMBOLS
): RepositoryContext {
  const active = indexed.filter((file) => !file.isIgnored);
  const paths = new Set(indexed.map((file) => file.path));

  const manifestPaths = active
    .map((file) => file.path)
    .filter((path) => MANIFEST_NAMES.has(filename(path)))
    .slice(0, 100);

  const configFiles = active
    .map((file) => file.path)
    .filter((path) => CONFIG_NAMES.has(filename(path)))
    .slice(0, 100);

  const testFiles = active
    .map((file) => file.path)
    .filter((path) => isTestFilePath(path))
    .slice(0, 200);

  const NON_SOURCE_LANGUAGES = new Set([
    'Unknown',
    'JSON',
    'YAML',
    'TOML',
    'Markdown',
    'XML',
    'Text',
    'CSV',
    'HTML',
    'CSS',
    'SCSS',
    'SVG',
  ]);

  const languages = [...new Set(active.map((file) => file.language || 'Unknown'))].filter(
    (language) => !NON_SOURCE_LANGUAGES.has(language)
  );

  const symbols: SymbolRef[] = [];
  let symbolsTruncated = false;
  for (const file of sourceFiles) {
    const found = extractSymbols(file.path, file.content);
    for (const symbol of found) {
      if (symbols.length >= maxSymbols) {
        symbolsTruncated = true;
        break;
      }
      symbols.push(symbol);
    }
    if (symbolsTruncated) break;
  }

  return {
    packageManager: detectPackageManager(paths),
    manifests: manifestPaths,
    configFiles,
    testFiles,
    languages,
    symbols,
    verification: inferVerificationCommands(indexed, manifests),
    limits: { symbolsTruncated, maxSymbols },
  };
}

/** Manifests worth fetching from the snapshot to build the context. */
export const CONTEXT_MANIFEST_FILES = [
  'package.json',
  'requirements.txt',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'pom.xml',
  'Makefile',
  'pnpm-lock.yaml',
  'yarn.lock',
  'package-lock.json',
] as const;

export function manifestPathsToFetch(indexed: IndexedFileLike[]): string[] {
  const wanted = new Set<string>(CONTEXT_MANIFEST_FILES);
  const found: string[] = [];
  for (const file of indexed) {
    if (wanted.has(filename(file.path)) && !file.isIgnored) {
      found.push(file.path);
    }
  }
  return found.slice(0, 12);
}
