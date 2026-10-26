// Runs the specs that are self-contained ES modules.
//
// The repository's older root-level specs import project modules without file
// extensions and need a bundler/loader; they are intentionally not part of this
// runner. Each spec listed here is executable with plain Node + type stripping.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const specs = [
  'lib/analysis/clone-instructions.spec.ts',
  'lib/analysis/evidence-verify.spec.ts',
  'lib/analysis/filter.spec.ts',
  'lib/analysis/public-request.spec.ts',
  'lib/analysis/repository-context.spec.ts',
  'lib/analysis/workspace-core.spec.ts',
  'lib/auth/signed-cookie.spec.ts',
  'lib/github/public.spec.ts',
  'lib/github/app/config.spec.ts',
  'lib/github/app/errors.spec.ts',
  'lib/github/app/jwt.spec.ts',
  'lib/github/app/repository-sync.spec.ts',
  'lib/github/app/token-cache.spec.ts',
];

let failed = 0;

for (const spec of specs) {
  console.log(`\n# ${spec}`);
  const result = spawnSync(process.execPath, ['--no-warnings', spec], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.status !== 0) failed++;
}

console.log(`\n${specs.length - failed}/${specs.length} spec files passed`);
if (failed > 0) process.exitCode = 1;
