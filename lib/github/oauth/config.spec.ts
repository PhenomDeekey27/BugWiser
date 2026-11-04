import assert from 'node:assert/strict';
import {
  GITHUB_OAUTH_SCOPES,
  getGitHubOAuthConfig,
  getGitHubOAuthConfigProblem,
  githubOAuthManageUrl,
  isGitHubOAuthConfigured,
  requireGitHubOAuthConfig,
} from './config.ts';
import { GitHubConfigError } from '../errors.ts';

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

const ENV_KEYS = [
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'GITHUB_OAUTH_CLIENT_ID',
  'GITHUB_OAUTH_CLIENT_SECRET',
  'GITHUB_APP_CLIENT_ID',
  'GITHUB_APP_CLIENT_SECRET',
];

function withEnv(values: Record<string, string | undefined>, fn: () => void) {
  const saved = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  try {
    for (const key of ENV_KEYS) delete process.env[key];
    for (const [key, value] of Object.entries(values)) {
      if (value !== undefined) process.env[key] = value;
    }
    fn();
  } finally {
    for (const key of ENV_KEYS) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const VALID = {
  GITHUB_CLIENT_ID: 'Iv1.abcdef1234567890',
  GITHUB_CLIENT_SECRET: 'a-secret-value',
};

test('requests only profile read and repository scopes', () => {
  assert.deepEqual([...GITHUB_OAUTH_SCOPES], ['read:user', 'repo']);
});

test('reports missing configuration', () => {
  withEnv({}, () => {
    assert.equal(getGitHubOAuthConfig(), null);
    assert.equal(isGitHubOAuthConfigured(), false);
    assert.match(getGitHubOAuthConfigProblem() || '', /GITHUB_CLIENT_ID is missing/);
    assert.equal(githubOAuthManageUrl(), null);
  });
});

test('rejects a numeric App id and a malformed client id', () => {
  withEnv({ ...VALID, GITHUB_CLIENT_ID: '123456' }, () => {
    assert.match(getGitHubOAuthConfigProblem() || '', /numeric App id/);
  });
  withEnv({ ...VALID, GITHUB_CLIENT_ID: 'bad id!' }, () => {
    assert.match(getGitHubOAuthConfigProblem() || '', /not a valid OAuth App client id/);
  });
});

test('rejects a missing or whitespace-bearing secret', () => {
  withEnv({ GITHUB_CLIENT_ID: VALID.GITHUB_CLIENT_ID }, () => {
    assert.match(getGitHubOAuthConfigProblem() || '', /GITHUB_CLIENT_SECRET is missing/);
  });
  withEnv({ ...VALID, GITHUB_CLIENT_SECRET: 'a secret with spaces' }, () => {
    assert.match(getGitHubOAuthConfigProblem() || '', /contains whitespace/);
  });
});

test('accepts a valid OAuth App configuration', () => {
  withEnv(VALID, () => {
    assert.equal(getGitHubOAuthConfigProblem(), null);
    assert.equal(isGitHubOAuthConfigured(), true);
    assert.deepEqual(requireGitHubOAuthConfig(), {
      clientId: VALID.GITHUB_CLIENT_ID,
      clientSecret: VALID.GITHUB_CLIENT_SECRET,
    });
    assert.equal(
      githubOAuthManageUrl(),
      `https://github.com/settings/connections/applications/${encodeURIComponent(VALID.GITHUB_CLIENT_ID)}`
    );
  });
});

test('accepts the explicit OAuth aliases', () => {
  withEnv(
    {
      GITHUB_OAUTH_CLIENT_ID: 'Iv1.alias1234567890',
      GITHUB_OAUTH_CLIENT_SECRET: 'alias-secret',
    },
    () => {
      assert.deepEqual(requireGitHubOAuthConfig(), {
        clientId: 'Iv1.alias1234567890',
        clientSecret: 'alias-secret',
      });
    }
  );
});

test('falls back to legacy GITHUB_APP_* variables', () => {
  withEnv(
    {
      GITHUB_APP_CLIENT_ID: 'Iv1.legacy123456789',
      GITHUB_APP_CLIENT_SECRET: 'legacy-secret',
    },
    () => {
      assert.deepEqual(requireGitHubOAuthConfig(), {
        clientId: 'Iv1.legacy123456789',
        clientSecret: 'legacy-secret',
      });
    }
  );
});

test('require throws a configuration error, never a user-facing auth prompt', () => {
  withEnv({}, () => {
    assert.throws(() => requireGitHubOAuthConfig(), (error: unknown) => {
      assert.ok(error instanceof GitHubConfigError);
      return true;
    });
  });
});

run();
