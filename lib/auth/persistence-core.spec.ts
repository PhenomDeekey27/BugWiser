import assert from 'node:assert/strict';
import type { IdentityStore, StoreError } from './identity-core.ts';
import { githubProfileFromSession, needsPersistence, retryPendingPersistenceWithStore } from './persistence-core.ts';
import type { AppSession } from './session-token.ts';

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

const NOW = 1_800_000_000_000;
const PENDING_ID = '11111111-1111-5111-8111-111111111111';
const CANONICAL_ID = '22222222-2222-5222-8222-222222222222';

function session(overrides: Partial<AppSession> = {}): AppSession {
  return {
    userId: PENDING_ID,
    githubUserId: '42',
    login: 'octocat',
    name: 'The Octocat',
    avatarUrl: '',
    source: 'github',
    iat: Math.floor(NOW / 1000) - 60,
    exp: Math.floor(NOW / 1000) + 3600,
    persisted: false,
    persistAttempts: 0,
    nextPersistAt: 0,
    github: {
      accessToken: 'token',
      expiresAt: 0,
      refreshToken: null,
      scopes: ['repo'],
    },
    ...overrides,
  };
}

function store(result: { canonicalId?: string; error?: StoreError } = {}): IdentityStore {
  return {
    async lookup() {
      return { userId: null, error: null };
    },
    async provision(_profile, userId) {
      if (result.error) return { userId: null, error: result.error, createdUser: false };
      return { userId: result.canonicalId ?? userId, error: null, createdUser: true };
    },
  };
}

test('only a pending GitHub session needs persistence', () => {
  assert.equal(needsPersistence(session()), true);
  assert.equal(needsPersistence(session({ persisted: true })), false);
  assert.equal(needsPersistence(session({ source: 'guest', github: null, githubUserId: null })), false);
});

test('a session without a usable GitHub id is left alone', () => {
  assert.equal(githubProfileFromSession(session({ githubUserId: null })), null);
  assert.equal(githubProfileFromSession(session({ githubUserId: 'not-a-number' })), null);
  assert.deepEqual(githubProfileFromSession(session())?.login, 'octocat');
});

test('does nothing while still inside the backoff window', async () => {
  const pending = session({ persistAttempts: 2, nextPersistAt: Math.floor(NOW / 1000) + 30 });
  const outcome = await retryPendingPersistenceWithStore(pending, store(), NOW);
  assert.equal(outcome.changed, false);
  assert.equal(outcome.session, pending);
});

test('a successful write clears the retry schedule', async () => {
  const outcome = await retryPendingPersistenceWithStore(session(), store(), NOW);
  assert.equal(outcome.changed, true);
  assert.equal(outcome.session.persisted, true);
  assert.equal(outcome.session.persistAttempts, 0);
  assert.equal(outcome.session.nextPersistAt, 0);
});

test('a successful write adopts the canonical user id', async () => {
  const outcome = await retryPendingPersistenceWithStore(
    session(),
    store({ canonicalId: CANONICAL_ID }),
    NOW
  );
  assert.equal(outcome.session.userId, CANONICAL_ID);
});

test('a failed write schedules the next attempt with backoff', async () => {
  const outcome = await retryPendingPersistenceWithStore(
    session(),
    store({ error: { message: 'connect ECONNREFUSED', code: 'ECONNREFUSED' } }),
    NOW
  );

  assert.equal(outcome.changed, true);
  assert.equal(outcome.session.persisted, false);
  assert.equal(outcome.session.persistAttempts, 1);
  assert.equal(outcome.session.nextPersistAt, Math.floor(NOW / 1000) + 30);

  const second = await retryPendingPersistenceWithStore(
    outcome.session,
    store({ error: { message: 'connect ECONNREFUSED', code: 'ECONNREFUSED' } }),
    NOW + 31_000
  );
  assert.equal(second.session.persistAttempts, 2);
  assert.equal(second.session.nextPersistAt, Math.floor((NOW + 31_000) / 1000) + 60);
});

test('an already persisted or guest session is never written again', async () => {
  const persisted = await retryPendingPersistenceWithStore(session({ persisted: true }), store(), NOW);
  assert.equal(persisted.changed, false);

  const guest = await retryPendingPersistenceWithStore(
    session({ source: 'guest', github: null, githubUserId: null }),
    store(),
    NOW
  );
  assert.equal(guest.changed, false);
});

run();
