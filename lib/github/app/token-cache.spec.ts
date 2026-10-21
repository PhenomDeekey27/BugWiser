import assert from 'node:assert/strict';
import { createInstallationTokenCache, type CachedInstallationToken } from './token-cache-core.ts';

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

const MINUTE = 60_000;

function token(installationId: number, expiresAtMs: number): CachedInstallationToken {
  return {
    token: `ghs_${installationId}`,
    expiresAtMs,
    permissions: { contents: 'write', issues: 'read' },
    repositorySelection: 'selected',
    installationId,
  };
}

function harness(ttlMinutes = 55) {
  let now = 1_800_000_000_000;
  const created: number[] = [];
  const cache = createInstallationTokenCache({
    now: () => now,
    create: async (installationId) => {
      created.push(installationId);
      return token(installationId, now + ttlMinutes * MINUTE);
    },
  });
  return {
    cache,
    created,
    advance(ms: number) {
      now += ms;
    },
  };
}

suite('Installation token cache', () => {
  test('serves a cached token instead of calling GitHub again', async () => {
    const h = harness();
    const first = await h.cache.get(7);
    const second = await h.cache.get(7);
    assert.equal(first, second);
    assert.deepEqual(h.created, [7]);
  });

  test('keeps installations separate', async () => {
    const h = harness();
    await h.cache.get(1);
    await h.cache.get(2);
    assert.deepEqual(h.created, [1, 2]);
    assert.equal(h.cache.peek(1)?.token, 'ghs_1');
    assert.equal(h.cache.peek(2)?.token, 'ghs_2');
  });

  test('refreshes inside the five-minute expiry margin', async () => {
    const h = harness(55);
    await h.cache.get(7);
    h.advance(49 * MINUTE); // 6 minutes left: still reusable
    await h.cache.get(7);
    assert.deepEqual(h.created, [7]);

    h.advance(2 * MINUTE); // 4 minutes left: must refresh
    await h.cache.get(7);
    assert.deepEqual(h.created, [7, 7]);
  });

  test('deduplicates concurrent misses', async () => {
    const h = harness();
    const [a, b, c] = await Promise.all([
      h.cache.get(9),
      h.cache.get(9),
      h.cache.get(9),
    ]);
    assert.equal(a, b);
    assert.equal(b, c);
    assert.deepEqual(h.created, [9]);
  });

  test('never caches an already-expired token', async () => {
    const now = 1_800_000_000_000;
    const cache = createInstallationTokenCache({
      now: () => now,
      create: async (installationId) => token(installationId, now - 1000),
    });

    await assert.rejects(() => cache.get(3), /already-expired/);
    assert.equal(cache.peek(3), undefined);
  });

  test('a failed refresh does not poison the next attempt', async () => {
    const now = 1_800_000_000_000;
    let attempts = 0;
    const cache = createInstallationTokenCache({
      now: () => now,
      create: async (installationId) => {
        attempts++;
        if (attempts === 1) throw new Error('boom');
        return token(installationId, now + 55 * MINUTE);
      },
    });

    await assert.rejects(() => cache.get(4), /boom/);
    const recovered = await cache.get(4);
    assert.equal(recovered.token, 'ghs_4');
    assert.equal(attempts, 2);
  });

  test('invalidate and clear drop cached tokens', async () => {
    const h = harness();
    await h.cache.get(1);
    h.cache.invalidate(1);
    assert.equal(h.cache.peek(1), undefined);
    await h.cache.get(1);
    h.cache.clear();
    assert.equal(h.cache.peek(1), undefined);
  });
});

run();
