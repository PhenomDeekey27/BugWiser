import assert from 'node:assert/strict';
import { chooseTargetKind, pullRequestHead } from './fix-target.ts';

const { test, run } = (() => {
  const tests: Array<{ name: string; fn: () => void }> = [];
  return {
    test(name: string, fn: () => void) {
      tests.push({ name, fn });
    },
    async run() {
      let passed = 0;
      for (const t of tests) {
        try {
          t.fn();
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

test('auto pushes upstream only when GitHub confirms push permission', () => {
  assert.equal(
    chooseTargetKind({ mode: 'auto', canPush: true, permissionsKnown: true }),
    'upstream'
  );
  assert.equal(
    chooseTargetKind({ mode: 'auto', canPush: false, permissionsKnown: true }),
    'fork'
  );
});

test('auto attempts upstream when GitHub withheld permissions instead of forking blindly', () => {
  assert.equal(
    chooseTargetKind({ mode: 'auto', canPush: false, permissionsKnown: false }),
    'upstream'
  );
});

test('an explicit target overrides the permission heuristic', () => {
  assert.equal(
    chooseTargetKind({ mode: 'fork', canPush: true, permissionsKnown: true }),
    'fork'
  );
  assert.equal(
    chooseTargetKind({ mode: 'upstream', canPush: false, permissionsKnown: true }),
    'upstream'
  );
});

test('a fork PR uses owner:branch, a same-repository PR uses the bare branch', () => {
  assert.equal(pullRequestHead('owner', 'bugwiser/fix-1', 'forkOwner'), 'forkOwner:bugwiser/fix-1');
  assert.equal(pullRequestHead('Owner', 'bugwiser/fix-1', 'owner'), 'bugwiser/fix-1');
  assert.equal(pullRequestHead('owner', 'bugwiser/fix-1', null), 'bugwiser/fix-1');
});

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
