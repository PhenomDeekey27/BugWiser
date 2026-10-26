const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.next',
  '.nuxt',
  '.vercel',
  '.netlify',
  'dist',
  'build',
  'out',
  'coverage',
  '.nyc_output',
  'vendor',
  '.cache',
  '.parcel-cache',
  'tmp',
  'temp',
  '.tmp',
  '.temp',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.tox',
  'venv',
  '.venv',
  'env',
  '.env',
  'target',
  '.gradle',
  '.idea',
  '.vscode',
  '.vs',
  'thumbs.db',
  '.DS_Store',
  'bower_components',
  '.sass-cache',
  'pkg',
  'bin',
  'obj',
  '.terraform',
  '.vagrant',
  'elm-stuff',
  '.spago',
  'node_modules',
]);

const IGNORED_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'ico',
  'bmp',
  'tiff',
  'tif',
  'mp4',
  'mov',
  'avi',
  'mkv',
  'webm',
  'mp3',
  'wav',
  'ogg',
  'flac',
  'zip',
  'tar',
  'gz',
  'bz2',
  'xz',
  '7z',
  'rar',
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'woff',
  'woff2',
  'ttf',
  'eot',
  'otf',
  'sqlite',
  'db',
  'lock',
]);

const ALWAYS_KEEP_FILES = new Set([
  'package.json',
  'tsconfig.json',
  'tsconfig.build.json',
  'jsconfig.json',
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  'vite.config.js',
  'vite.config.mjs',
  'vite.config.ts',
  'webpack.config.js',
  'webpack.config.ts',
  'rollup.config.js',
  'rollup.config.mjs',
  'rollup.config.ts',
  'esbuild.config.js',
  'tailwind.config.js',
  'tailwind.config.ts',
  'postcss.config.js',
  'postcss.config.mjs',
  'postcss.config.ts',
  'babel.config.js',
  '.babelrc',
  'jest.config.js',
  'jest.config.ts',
  'vitest.config.ts',
  'vitest.config.js',
  '.eslintrc.js',
  '.eslintrc.json',
  'eslint.config.js',
  'eslint.config.mjs',
  '.prettierrc',
  '.prettierrc.json',
  'prettier.config.js',
  '.editorconfig',
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'Makefile',
  'CMakeLists.txt',
  'README.md',
  'README.rst',
  'README.txt',
  'LICENSE',
  'LICENSE.md',
  'LICENSE.txt',
  'CONTRIBUTING.md',
  'CHANGELOG.md',
  'requirements.txt',
  'pyproject.toml',
  'setup.py',
  'setup.cfg',
  'Pipfile',
  'poetry.lock',
  'Cargo.toml',
  'go.mod',
  'go.sum',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'Gemfile',
  'Gemfile.lock',
  '.env.example',
  '.env.template',
  '.gitignore',
  '.gitattributes',
  'Procfile',
  'vercel.json',
  'netlify.toml',
  'renovate.json',
  '.github/dependabot.yml',
]);

const SECRET_FILENAMES = new Set([
  '.env',
  '.env.local',
  '.env.development',
  '.env.production',
  '.env.test',
  '.npmrc',
  '.pypirc',
  '.netrc',
  '.htpasswd',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'credentials',
  'credentials.json',
  'secrets.json',
  'secrets.yml',
  'secrets.yaml',
]);

const SECRET_EXTENSIONS = new Set(['pem', 'key', 'p12', 'pfx', 'jks', 'keystore']);

/** Files whose contents must never be treated as indexable source. */
export function isSecretFilePath(path: string): boolean {
  const filename = getFilename(path).toLowerCase();
  // Templates are safe and useful context; they contain no real values.
  if (filename.endsWith('.example') || filename.endsWith('.template') || filename.endsWith('.sample')) {
    return false;
  }
  if (SECRET_FILENAMES.has(filename)) return true;
  if (filename.startsWith('.env.')) return true;
  return SECRET_EXTENSIONS.has(getExtension(filename));
}

export interface TreeEntry {
  path: string;
  mode: string;
  type: string;
  size?: number;
  sha: string;
}

export interface FilteredFile {
  path: string;
  type: 'file' | 'blob';
  size: number;
  sha: string;
  language: string;
  isIgnored: boolean;
  /** Why the file was excluded; only present on ignored entries. */
  exclusionReason?: 'directory' | 'extension' | 'secret' | 'oversized';
}

export interface FilterOptions {
  /** Files above this size are never treated as source. */
  maxFileSizeBytes?: number;
  /**
   * Maximum number of non-ignored files. Exceeding it fails the whole index
   * rather than silently analysing a partial repository.
   */
  maxActiveFiles?: number;
}

export const DEFAULT_FILTER_LIMITS = {
  maxFileSizeBytes: 1024 * 1024,
  maxActiveFiles: 40_000,
} as const;

export class RepositoryTooLargeError extends Error {
  activeFiles: number;
  limit: number;

  constructor(activeFiles: number, limit: number) {
    super(
      `Repository has ${activeFiles.toLocaleString()} indexable files, above the ${limit.toLocaleString()} file limit.`
    );
    this.name = 'RepositoryTooLargeError';
    this.activeFiles = activeFiles;
    this.limit = limit;
  }
}

function getFilename(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1];
}

function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1) return '';
  return filename.slice(lastDot + 1).toLowerCase();
}

function isIgnoredDirectory(path: string): boolean {
  const parts = path.split('/');
  return parts.some((part) => IGNORED_DIRECTORIES.has(part));
}

function isIgnoredFile(filename: string, ext: string): boolean {
  if (ALWAYS_KEEP_FILES.has(filename)) return false;
  if (IGNORED_EXTENSIONS.has(ext)) return true;
  if (filename.endsWith('.min.js') || filename.endsWith('.min.css')) return true;
  if (filename.endsWith('.map')) return true;
  if (filename.endsWith('.lock') && filename !== 'Pipfile.lock') return true;
  return false;
}

export function filterTreeEntries(
  entries: TreeEntry[],
  detectLanguageFn: (path: string) => string,
  options: FilterOptions = {}
): FilteredFile[] {
  const maxFileSizeBytes = options.maxFileSizeBytes ?? DEFAULT_FILTER_LIMITS.maxFileSizeBytes;
  const maxActiveFiles = options.maxActiveFiles ?? DEFAULT_FILTER_LIMITS.maxActiveFiles;

  const filtered = entries
    .filter((entry) => entry.type === 'blob')
    .map((entry): FilteredFile => {
      const filename = getFilename(entry.path);
      const ext = getExtension(filename);
      const size = entry.size || 0;

      let exclusionReason: FilteredFile['exclusionReason'];
      if (isIgnoredDirectory(entry.path)) {
        exclusionReason = 'directory';
      } else if (isIgnoredFile(filename, ext)) {
        exclusionReason = 'extension';
      } else if (isSecretFilePath(entry.path)) {
        exclusionReason = 'secret';
      } else if (size > maxFileSizeBytes) {
        exclusionReason = 'oversized';
      }

      return {
        path: entry.path,
        type: 'file' as const,
        size,
        sha: entry.sha,
        language: detectLanguageFn(entry.path),
        isIgnored: exclusionReason !== undefined,
        ...(exclusionReason ? { exclusionReason } : {}),
      };
    });

  const activeCount = filtered.reduce((count, file) => count + (file.isIgnored ? 0 : 1), 0);
  if (activeCount > maxActiveFiles) {
    throw new RepositoryTooLargeError(activeCount, maxActiveFiles);
  }

  return filtered;
}

export function getActiveFiles(files: FilteredFile[]): FilteredFile[] {
  return files.filter((f) => !f.isIgnored);
}

export function getIgnoredFiles(files: FilteredFile[]): FilteredFile[] {
  return files.filter((f) => f.isIgnored);
}
