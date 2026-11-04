import assert from 'node:assert/strict';
import {
  BUGWISER_USER_NAMESPACE,
  deterministicUserId,
  githubProfileMetadata,
  isRetryableStoreError,
  isUsableGitHubId,
  isUserId,
  persistIdentityWithStore,
  resolveIdentityWithStore,
  syntheticEmail,
  withStoreRetry,
  type GitHubIdentityProfile,
  type IdentityStore,
  type StoreError,
} from './identity-core.ts';

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

const PROFILE: GitHubIdentityProfile = {
  id: 42,
  login: 'octocat',
  name: 'The Octocat',
  avatarUrl: 'https://avatars.example/u/42',
};

const DB_DOWN: StoreError = { message: 'connect ECONNREFUSED 10.0.0.1:5432', code: 'ECONNREFUSED' };

function memoryStore(options: {
  userId?: string | null;
  lookupError?: StoreError;
  provisionError?: StoreError;
  canonicalId?: string | null;
} = {}): IdentityStore & { provisions: number; lastUser: GitHubIdentityProfile | null } {
  const state = {
    userId: options.userId ?? null,
    provisions: 0,
    lastUser: null as GitHubIdentityProfile | null,
  };

  return {
    get provisions() {
      return state.provisions;
    },
    get lastUser() {
      return state.lastUser;
    },
    async lookup() {
      if (options.lookupError) return { userId: null, error: options.lookupError };
      return { userId: state.userId, error: null };
    },
    async provision(profile, userId) {
      state.provisions++;
      state.lastUser = profile;
      if (options.provisionError) {
        return { userId: null, error: options.provisionError, createdUser: false };
      }
      return { userId: options.canonicalId ?? userId, error: null, createdUser: true };
    },
  };
}

test('deterministic user ids are stable, unique, and RFC 4122 v5', () => {
  const a = deterministicUserId(42);
  assert.equal(a, deterministicUserId(42));
  assert.notEqual(a, deterministicUserId(43));
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(BUGWISER_USER_NAMESPACE, 'ea51d9e6-6b67-5b63-be8d-bb92f80d5a01');
});

test('validates GitHub ids and BugWiser user ids', () => {
  assert.equal(isUsableGitHubId(1), true);
  assert.equal(isUsableGitHubId(0), false);
  assert.equal(isUsableGitHubId(-1), false);
  assert.equal(isUsableGitHubId(1.5), false);
  assert.equal(isUsableGitHubId('42'), false);
  assert.equal(isUserId('11111111-1111-5111-8111-111111111111'), true);
  assert.equal(isUserId('short'), false);
  assert.equal(isUserId(null), false);
});

test('synthetic email can never be delivered', () => {
  assert.equal(syntheticEmail(42), 'github-42@accounts.bugwiser.invalid');
});

test('profile metadata keeps the stable GitHub id', () => {
  const metadata = githubProfileMetadata(PROFILE);
  assert.equal(metadata.sub, '42');
  assert.equal(metadata.provider_id, '42');
  assert.equal(metadata.preferred_username, 'octocat');
  assert.equal(metadata.bugwiser_identity, 'github_oauth');
});

test('distinguishes transient storage failures from permanent ones', () => {
  assert.equal(isRetryableStoreError(DB_DOWN), true);
  assert.equal(isRetryableStoreError({ message: 'query_timeout' }), true);
  assert.equal(isRetryableStoreError({ message: 'duplicate key', code: '23505' }), false);
  assert.equal(isRetryableStoreError(null), false);
});

test('an existing mapping always wins and is never re-provisioned', async () => {
  const store = memoryStore({ userId: '99999999-9999-5999-8999-999999999999' });
  const result = await resolveIdentityWithStore(PROFILE, store);

  assert.deepEqual(result, {
    status: 'ok',
    userId: '99999999-9999-5999-8999-999999999999',
    persisted: true,
  });
  assert.equal(store.provisions, 0);
});

test('a new account is provisioned under the deterministic id', async () => {
  const store = memoryStore();
  const result = await resolveIdentityWithStore(PROFILE, store);

  assert.equal(result.status, 'ok');
  assert.equal(result.status === 'ok' && result.userId, deterministicUserId(42));
  assert.equal(store.provisions, 1);
  assert.deepEqual(store.lastUser, PROFILE);
});

test('a database outage still yields a usable, deterministic identity', async () => {
  const store = memoryStore({ lookupError: DB_DOWN });
  const result = await resolveIdentityWithStore(PROFILE, store, {
    attempts: 1,
    sleep: async () => {},
  });

  assert.deepEqual(result, {
    status: 'pending',
    userId: deterministicUserId(42),
    error: 'storage_error:ECONNREFUSED',
  });
});

test('a failed provision is pending, never an exception', async () => {
  const store = memoryStore({ provisionError: { message: 'boom' } });
  const result = await resolveIdentityWithStore(PROFILE, store, {
    attempts: 1,
    sleep: async () => {},
  });

  assert.equal(result.status, 'pending');
  assert.equal(result.status === 'pending' && result.userId, deterministicUserId(42));
});

test('an unusable GitHub id fails closed', async () => {
  const result = await resolveIdentityWithStore({ ...PROFILE, id: 0 }, memoryStore());
  assert.deepEqual(result, { status: 'invalid' });
});

test('retries only transient failures, with exponential backoff', async () => {
  let calls = 0;
  const delays: number[] = [];
  const result = await withStoreRetry(
    async () => {
      calls++;
      return calls < 3 ? { error: DB_DOWN } : { error: null, ok: true };
    },
    { attempts: 4, baseDelayMs: 100, sleep: async (ms) => void delays.push(ms) }
  );

  assert.equal(result.error, null);
  assert.equal(calls, 3);
  assert.deepEqual(delays, [100, 200]);
});

test('never retries a permanent failure', async () => {
  let calls = 0;
  const result = await withStoreRetry(
    async () => {
      calls++;
      return { error: { message: 'duplicate key', code: '23505' } };
    },
    { attempts: 5, sleep: async () => {} }
  );

  assert.equal(calls, 1);
  assert.equal(result.error?.code, '23505');
});

test('persistence adopts the canonical id when another row already owns the account', async () => {
  const result = await persistIdentityWithStore(
    PROFILE,
    deterministicUserId(42),
    memoryStore({ canonicalId: '88888888-8888-5888-8888-888888888888' })
  );

  assert.deepEqual(result, {
    status: 'ok',
    userId: '88888888-8888-5888-8888-888888888888',
  });
});

test('persistence reports pending on a transient failure and refuses a bad id', async () => {
  const pending = await persistIdentityWithStore(
    PROFILE,
    deterministicUserId(42),
    memoryStore({ provisionError: DB_DOWN }),
    { attempts: 1, sleep: async () => {} }
  );
  assert.equal(pending.status, 'pending');

  const invalid = await persistIdentityWithStore({ ...PROFILE, id: -5 }, 'x', memoryStore());
  assert.deepEqual(invalid, { status: 'pending', userId: 'x', error: 'invalid_github_id' });
});

run();
