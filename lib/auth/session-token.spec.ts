import assert from 'node:assert/strict';
import {
  SESSION_COOKIE_VERSION_TAG,
  isGitHubCredentialExpired,
  openSession,
  persistenceBackoffSeconds,
  sealSession,
  sessionNeedsRefresh,
  sessionTtlFor,
  type GitHubCredential,
  type SessionPayloadInput,
} from './session-token.ts';

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

const SECRET = 's'.repeat(48);
const NOW = 1_800_000_000_000;

function githubInput(overrides: Partial<SessionPayloadInput> = {}): SessionPayloadInput {
  return {
    userId: '11111111-1111-5111-8111-111111111111',
    githubUserId: '42',
    login: 'octocat',
    name: 'The Octocat',
    avatarUrl: 'https://avatars.example/u/42',
    source: 'github',
    persisted: true,
    github: {
      accessToken: 'gho_example_access_token',
      expiresAt: 0,
      refreshToken: null,
      scopes: ['read:user', 'repo'],
    },
    ...overrides,
  };
}

test('round-trips identity and credential', () => {
  const token = sealSession(githubInput(), SECRET, 600, NOW);
  assert.ok(token.startsWith(`${SESSION_COOKIE_VERSION_TAG}.`));

  const session = openSession(token, SECRET, NOW + 1000);
  assert.ok(session);
  assert.equal(session.userId, '11111111-1111-5111-8111-111111111111');
  assert.equal(session.githubUserId, '42');
  assert.equal(session.login, 'octocat');
  assert.equal(session.name, 'The Octocat');
  assert.equal(session.source, 'github');
  assert.equal(session.persisted, true);
  assert.equal(session.github?.accessToken, 'gho_example_access_token');
  assert.deepEqual(session.github?.scopes, ['read:user', 'repo']);
});

test('the cookie value is encrypted, not readable', () => {
  const token = sealSession(githubInput(), SECRET, 600, NOW);
  assert.equal(token.includes('gho_example_access_token'), false);
  assert.equal(token.includes('octocat'), false);
});

test('rejects a wrong secret', () => {
  const token = sealSession(githubInput(), SECRET, 600, NOW);
  assert.equal(openSession(token, 'x'.repeat(48), NOW), null);
});

test('rejects a tampered ciphertext or tag', () => {
  const token = sealSession(githubInput(), SECRET, 600, NOW);
  const [version, iv, data, tag] = token.split('.');
  assert.equal(openSession([version, iv, `${data.slice(0, -2)}AA`, tag].join('.'), SECRET, NOW), null);
  assert.equal(openSession([version, iv, data, `${tag.slice(0, -2)}AA`].join('.'), SECRET, NOW), null);
  assert.equal(openSession([version, iv, data].join('.'), SECRET, NOW), null);
});

test('rejects an expired session', () => {
  const token = sealSession(githubInput(), SECRET, 60, NOW);
  assert.ok(openSession(token, SECRET, NOW + 59_000));
  assert.equal(openSession(token, SECRET, NOW + 60_000), null);
});

test('rejects a session issued in the future', () => {
  const token = sealSession(githubInput(), SECRET, 600, NOW);
  assert.equal(openSession(token, SECRET, NOW - 5 * 60_000), null);
});

test('a GitHub session without a credential is unusable', () => {
  const token = sealSession(githubInput({ github: null }), SECRET, 600, NOW);
  assert.equal(openSession(token, SECRET, NOW), null);
});

test('a guest session carries no credential', () => {
  const token = sealSession(
    {
      userId: '22222222-2222-5222-8222-222222222222',
      githubUserId: null,
      login: 'guest-abc12345',
      name: 'Guest',
      avatarUrl: '',
      source: 'guest',
      persisted: true,
      github: { accessToken: 'should-be-dropped', expiresAt: 0, refreshToken: null, scopes: [] },
    },
    SECRET,
    600,
    NOW
  );
  const session = openSession(token, SECRET, NOW);
  assert.ok(session);
  assert.equal(session.source, 'guest');
  assert.equal(session.github, null);
});

test('refuses to seal with a short secret', () => {
  assert.throws(() => sealSession(githubInput(), 'short', 600, NOW));
});

test('credential expiry treats 0 as non-expiring', () => {
  const permanent: GitHubCredential = {
    accessToken: 't',
    expiresAt: 0,
    refreshToken: null,
    scopes: [],
  };
  assert.equal(isGitHubCredentialExpired(permanent, NOW), false);
  assert.equal(isGitHubCredentialExpired(null, NOW), true);
  assert.equal(
    isGitHubCredentialExpired({ ...permanent, expiresAt: Math.floor(NOW / 1000) + 120 }, NOW),
    false
  );
  assert.equal(
    isGitHubCredentialExpired({ ...permanent, expiresAt: Math.floor(NOW / 1000) + 30 }, NOW),
    true
  );
});

test('session lifetime never outlives the credential', () => {
  const ttl = 7 * 24 * 60 * 60;
  assert.equal(sessionTtlFor(null, ttl, NOW), ttl);

  const permanent: GitHubCredential = {
    accessToken: 't',
    expiresAt: 0,
    refreshToken: null,
    scopes: [],
  };
  assert.equal(sessionTtlFor(permanent, ttl, NOW), ttl);

  const expiring = { ...permanent, expiresAt: Math.floor(NOW / 1000) + 3600 };
  assert.equal(sessionTtlFor(expiring, ttl, NOW), 3600);

  // Already expired still gets a minimal cookie so the next request can clear it.
  assert.equal(sessionTtlFor({ ...permanent, expiresAt: Math.floor(NOW / 1000) - 10 }, ttl, NOW), 60);
});

test('sliding refresh starts with less than a day left', () => {
  const token = sealSession(githubInput(), SECRET, 2 * 24 * 60 * 60, NOW);
  const session = openSession(token, SECRET, NOW);
  assert.ok(session);
  assert.equal(sessionNeedsRefresh(session, NOW), false);
  assert.equal(sessionNeedsRefresh(session, NOW + 25 * 60 * 60 * 1000), true);
});

test('persistence backoff doubles and caps at 15 minutes', () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6, 7, 8].map(persistenceBackoffSeconds),
    [30, 60, 120, 240, 480, 900, 900, 900]
  );
});

run();
