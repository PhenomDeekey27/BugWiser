import assert from 'node:assert/strict';
import {
  describeRepositoryAccessState,
  mapApiRepositories,
  mapApiRepository,
} from './repositories-core.ts';
import type { GitHubApiRepository } from './types.ts';

const { test, run } = (() => {
  const tests: Array<{ name: string; fn: () => void }> = [];
  return {
    test(name: string, fn: () => void) {
      tests.push({ name, fn });
    },
    run() {
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

function row(overrides: Partial<GitHubApiRepository> = {}): GitHubApiRepository {
  return {
    id: 1,
    name: 'repo',
    full_name: 'octocat/repo',
    owner: { login: 'octocat', avatar_url: 'https://avatars.example/u/1' },
    description: 'A repository',
    language: 'TypeScript',
    stargazers_count: 10,
    forks_count: 2,
    private: false,
    default_branch: 'main',
    html_url: 'https://github.com/octocat/repo',
    pushed_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    ...overrides,
  };
}

test('maps a usable repository payload', () => {
  const mapped = mapApiRepository(row({ permissions: { push: true } }));
  assert.ok(mapped);
  assert.equal(mapped.repoId, 1);
  assert.equal(mapped.fullName, 'octocat/repo');
  assert.equal(mapped.owner, 'octocat');
  assert.equal(mapped.name, 'repo');
  assert.equal(mapped.language, 'TypeScript');
  assert.equal(mapped.stars, 10);
  assert.equal(mapped.private, false);
  assert.equal(mapped.permissionsKnown, true);
  assert.equal(mapped.canWrite, true);
});

test('reports unknown permissions instead of inventing a denial', () => {
  const mapped = mapApiRepository(row());
  assert.ok(mapped);
  assert.equal(mapped.permissionsKnown, false);
  assert.equal(mapped.canWrite, false);
});

test('drops payloads missing the fields the app relies on', () => {
  assert.equal(mapApiRepository(row({ id: 0 })), null);
  assert.equal(mapApiRepository(row({ id: 1.5 })), null);
  assert.equal(mapApiRepository(row({ full_name: 'no-slash' })), null);
  assert.equal(mapApiRepository(null as unknown as GitHubApiRepository), null);
});

test('falls back to the full name and safe defaults', () => {
  const mapped = mapApiRepository(
    row({
      owner: { login: '' },
      name: '',
      description: null,
      language: null,
      default_branch: '',
      html_url: '',
      pushed_at: null,
      updated_at: '',
      stargazers_count: Number.NaN,
      forks_count: Number.NaN,
    })
  );
  assert.ok(mapped);
  assert.equal(mapped.owner, 'octocat');
  assert.equal(mapped.name, 'repo');
  assert.equal(mapped.description, '');
  assert.equal(mapped.language, '');
  assert.equal(mapped.defaultBranch, 'main');
  assert.equal(mapped.htmlUrl, 'https://github.com/octocat/repo');
  assert.equal(mapped.pushedAt, null);
  assert.equal(mapped.stars, 0);
  assert.equal(mapped.forks, 0);
});

test('sorts by most recently pushed and drops unusable rows', () => {
  const mapped = mapApiRepositories([
    row({
      id: 1,
      full_name: 'a/one',
      owner: { login: 'a' },
      name: 'one',
      pushed_at: '2025-01-01T00:00:00Z',
    }),
    row({
      id: 2,
      full_name: 'b/two',
      owner: { login: 'b' },
      name: 'two',
      pushed_at: '2026-01-01T00:00:00Z',
    }),
    row({
      id: 3,
      full_name: 'c/three',
      owner: { login: 'c' },
      name: 'three',
      pushed_at: null,
    }),
    row({ id: 0, full_name: 'bad/four' }),
  ]);

  assert.deepEqual(
    mapped.map((repo) => repo.fullName),
    ['b/two', 'a/one', 'c/three']
  );
});

test('describes connected, guest, and empty states', () => {
  assert.deepEqual(describeRepositoryAccessState({ connected: false, repositoryCount: 0 }), {
    requiresGitHub: true,
    empty: false,
  });
  assert.deepEqual(describeRepositoryAccessState({ connected: true, repositoryCount: 0 }), {
    requiresGitHub: false,
    empty: true,
  });
  assert.deepEqual(describeRepositoryAccessState({ connected: true, repositoryCount: 3 }), {
    requiresGitHub: false,
    empty: false,
  });
});

run();
