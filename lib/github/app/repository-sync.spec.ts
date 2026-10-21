import assert from 'node:assert/strict';
import {
  buildInstallationRepositoryRows,
  describeRepositoryListState,
  findRemovedRepositoryIds,
  type InstallationRepositoryInput,
} from './repository-sync-core.ts';

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

function repo(overrides: Partial<InstallationRepositoryInput> = {}): InstallationRepositoryInput {
  return {
    id: 101,
    name: 'Bug_Repo',
    full_name: 'PhenomDeekey27/Bug_Repo',
    owner: { login: 'PhenomDeekey27' },
    private: false,
    default_branch: 'main',
    html_url: 'https://github.com/PhenomDeekey27/Bug_Repo',
    pushed_at: '2026-10-20T10:00:00Z',
    ...overrides,
  };
}

const NOW = '2026-10-21T12:00:00.000Z';

suite('buildInstallationRepositoryRows', () => {
  test('maps the installation-selected repository into an upsert row', () => {
    const rows = buildInstallationRepositoryRows(173645094, [repo()], NOW);
    assert.deepEqual(rows, [
      {
        installation_id: 173645094,
        repo_id: 101,
        full_name: 'PhenomDeekey27/Bug_Repo',
        owner: 'PhenomDeekey27',
        name: 'Bug_Repo',
        private: false,
        default_branch: 'main',
        html_url: 'https://github.com/PhenomDeekey27/Bug_Repo',
        pushed_at: '2026-10-20T10:00:00Z',
        updated_at: NOW,
      },
    ]);
  });

  test('keeps nulls for optional GitHub fields instead of inventing values', () => {
    const rows = buildInstallationRepositoryRows(
      1,
      [repo({ default_branch: null, html_url: null, pushed_at: null })],
      NOW
    );
    assert.equal(rows[0].default_branch, null);
    assert.equal(rows[0].html_url, null);
    assert.equal(rows[0].pushed_at, null);
  });

  test('drops entries GitHub could not have returned', () => {
    const rows = buildInstallationRepositoryRows(
      1,
      [repo({ id: 0 }), repo({ id: 2, full_name: 'broken' }), repo({ id: 3 })],
      NOW
    );
    assert.deepEqual(rows.map((row) => row.repo_id), [3]);
  });

  test('returns an empty array when the installation has no repositories', () => {
    assert.deepEqual(buildInstallationRepositoryRows(1, [], NOW), []);
  });
});

suite('findRemovedRepositoryIds', () => {
  test('drops repositories that are no longer selected on GitHub', () => {
    assert.deepEqual(findRemovedRepositoryIds([1, 2, 3], [1, 3]), [2]);
  });

  test('keeps everything when GitHub still returns every repository', () => {
    assert.deepEqual(findRemovedRepositoryIds([1, 2], [1, 2]), []);
  });

  test('handles an installation with every repository removed', () => {
    assert.deepEqual(findRemovedRepositoryIds([1, 2], []), [1, 2]);
  });
});

suite('describeRepositoryListState', () => {
  test('no installation: ask the user to install, not an error', () => {
    assert.deepEqual(
      describeRepositoryListState({
        installationCount: 0,
        repositoryCount: 0,
        syncFailureCount: 0,
      }),
      {
        requiresInstallation: true,
        requiresRepositorySelection: false,
        failWithSyncError: false,
      }
    );
  });

  test('installation with no selected repositories is empty, not an error', () => {
    assert.deepEqual(
      describeRepositoryListState({
        installationCount: 1,
        repositoryCount: 0,
        syncFailureCount: 0,
      }),
      {
        requiresInstallation: false,
        requiresRepositorySelection: true,
        failWithSyncError: false,
      }
    );
  });

  test('a failed sync with nothing visible is an error, never an empty list', () => {
    assert.deepEqual(
      describeRepositoryListState({
        installationCount: 1,
        repositoryCount: 0,
        syncFailureCount: 1,
      }),
      {
        requiresInstallation: false,
        requiresRepositorySelection: false,
        failWithSyncError: true,
      }
    );
  });

  test('a failed enumeration with no installation is an error, not "install"', () => {
    assert.equal(
      describeRepositoryListState({
        installationCount: 0,
        repositoryCount: 0,
        syncFailureCount: 1,
      }).failWithSyncError,
      true
    );
  });

  test('a partial failure still returns the repositories that synced', () => {
    assert.deepEqual(
      describeRepositoryListState({
        installationCount: 2,
        repositoryCount: 1,
        syncFailureCount: 1,
      }),
      {
        requiresInstallation: false,
        requiresRepositorySelection: false,
        failWithSyncError: false,
      }
    );
  });
});

run();
