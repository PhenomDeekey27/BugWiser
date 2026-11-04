import assert from 'node:assert/strict';
import { localAddressSpace } from './relayTarget.ts';

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

test('loopback hosts declare the loopback address space', () => {
  assert.equal(localAddressSpace('http://127.0.0.1:8000/v1'), 'loopback');
  assert.equal(localAddressSpace('http://localhost:11434'), 'loopback');
  assert.equal(localAddressSpace('http://[::1]:1234/v1'), 'loopback');
  assert.equal(localAddressSpace('http://0.0.0.0:8080'), 'loopback');
  assert.equal(localAddressSpace('http://127.9.8.7:5000'), 'loopback');
});

test('private LAN hosts declare the local address space', () => {
  assert.equal(localAddressSpace('http://192.168.1.20:8000'), 'local');
  assert.equal(localAddressSpace('http://10.0.0.5:1234/v1'), 'local');
  assert.equal(localAddressSpace('http://172.20.3.4:8080'), 'local');
  assert.equal(localAddressSpace('http://box.local:8000'), 'local');
});

test('public and non-http targets declare nothing', () => {
  assert.equal(localAddressSpace('https://api.github.com'), null);
  assert.equal(localAddressSpace('https://example.com/v1'), null);
  assert.equal(localAddressSpace('ftp://127.0.0.1:21'), null);
  assert.equal(localAddressSpace('not a url'), null);
});

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
