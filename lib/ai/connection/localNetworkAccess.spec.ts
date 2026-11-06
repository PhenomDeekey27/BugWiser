import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { fileURLToPath } from 'node:url';

interface ResolveContext {
  parentURL?: string;
}
type NextResolve = (specifier: string, context: ResolveContext) => { url: string };

const registerHooks = (
  nodeModule as unknown as {
    registerHooks?: (hooks: {
      resolve: (specifier: string, context: ResolveContext, nextResolve: NextResolve) => { url: string };
    }) => void;
  }
).registerHooks;

// The app's modules import each other without a file extension (Next bundles
// them); plain Node ESM needs the `.ts` suffix, so resolve it for this spec.
registerHooks?.({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      const relative = specifier.startsWith('./') || specifier.startsWith('../');
      if (!relative || !context.parentURL) throw err;
      const withTs = new URL(`${specifier}.ts`, context.parentURL);
      if (!existsSync(fileURLToPath(withTs))) throw err;
      return nextResolve(withTs.href, context);
    }
  },
});

const {
  localNetworkDeniedMessage,
  localNetworkPermissionName,
  primeLocalNetworkAccess,
  queryLocalNetworkPermission,
} = await import('./localNetworkAccess.ts');

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

function permissions(state: string, opts: { throwOnQuery?: boolean } = {}) {
  const queries: string[] = [];
  return {
    queries,
    api: {
      async query(descriptor: { name: string }) {
        queries.push(descriptor.name);
        if (opts.throwOnQuery) throw new TypeError('Unrecognized permission name');
        return { state };
      },
    },
  };
}

test('granular permission names are used, never the legacy combined name', () => {
  assert.equal(localNetworkPermissionName('loopback'), 'loopback-network');
  assert.equal(localNetworkPermissionName('local'), 'local-network');
});

test('query maps browser states', async () => {
  const p = permissions('granted');
  assert.equal(await queryLocalNetworkPermission('loopback', p.api), 'granted');
  assert.deepEqual(p.queries, ['loopback-network']);

  assert.equal(await queryLocalNetworkPermission('local', permissions('denied').api), 'denied');
  assert.equal(await queryLocalNetworkPermission('local', permissions('prompt').api), 'prompt');
});

test('query is unsupported without a Permissions API or an unknown permission name', async () => {
  assert.equal(await queryLocalNetworkPermission('loopback', undefined), 'unsupported');
  assert.equal(
    await queryLocalNetworkPermission('loopback', permissions('prompt', { throwOnQuery: true }).api),
    'unsupported'
  );
});

test('priming skips the request when the permission is already granted', async () => {
  let calls = 0;
  const state = await primeLocalNetworkAccess('http://127.0.0.1:8000/v1', {
    permissions: permissions('granted').api,
    fetchFn: async () => {
      calls++;
      return {};
    },
  });
  assert.equal(state, 'granted');
  assert.equal(calls, 0, 'no wasted request once the site is allowed');
});

test('priming never fires when the site is denied, and reports denied', async () => {
  let calls = 0;
  const state = await primeLocalNetworkAccess('http://127.0.0.1:8000/v1', {
    permissions: permissions('denied').api,
    fetchFn: async () => {
      calls++;
      return {};
    },
  });
  assert.equal(state, 'denied');
  assert.equal(calls, 0);
});

test('priming sends one no-cors loopback-declared request while in prompt, then re-reads state', async () => {
  let current = 'prompt';
  const seen: Array<{ url: string; init?: RequestInit & { targetAddressSpace?: string } }> = [];
  const state = await primeLocalNetworkAccess('http://127.0.0.1:8000/v1', {
    permissions: {
      async query() {
        return { state: current };
      },
    },
    fetchFn: async (url, init) => {
      seen.push({ url, init });
      current = 'granted'; // the prompt was allowed
      return {};
    },
  });
  assert.equal(state, 'granted');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'http://127.0.0.1:8000/v1');
  assert.equal(seen[0].init?.mode, 'no-cors');
  assert.equal(seen[0].init?.targetAddressSpace, 'loopback');
});

test('priming leaves a dismissed/unanswerable prompt as prompt', async () => {
  const state = await primeLocalNetworkAccess('http://127.0.0.1:8000/v1', {
    permissions: permissions('prompt').api,
    fetchFn: async () => {
      throw new TypeError('Failed to fetch');
    },
  });
  assert.equal(state, 'prompt');
});

test('non-local targets are never primed', async () => {
  let calls = 0;
  const state = await primeLocalNetworkAccess('https://api.github.com', {
    permissions: permissions('prompt').api,
    fetchFn: async () => {
      calls++;
      return {};
    },
  });
  assert.equal(state, 'unsupported');
  assert.equal(calls, 0);
});

test('the denied message names the endpoint and the setting to change', () => {
  const message = localNetworkDeniedMessage('http://127.0.0.1:8000/v1');
  assert.match(message, /127\.0\.0\.1:8000/);
  assert.match(message, /Allow/);
  assert.match(message, /site controls/i);
});

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
