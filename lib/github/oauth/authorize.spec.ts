import assert from 'node:assert/strict';
import { GITHUB_AUTHORIZE_ENDPOINT, buildAuthorizeUrl } from './authorize.ts';

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

const BASE = {
  clientId: 'Iv1.abcdef1234567890',
  redirectUri: 'https://bugwiser.example/api/auth/callback',
  state: 'state-token',
  scopes: ['read:user', 'repo'],
};

test('builds the OAuth App authorize URL', () => {
  const url = buildAuthorizeUrl(BASE);
  assert.equal(`${url.origin}${url.pathname}`, GITHUB_AUTHORIZE_ENDPOINT);
  assert.equal(url.searchParams.get('client_id'), BASE.clientId);
  assert.equal(url.searchParams.get('redirect_uri'), BASE.redirectUri);
  assert.equal(url.searchParams.get('state'), 'state-token');
  assert.equal(url.searchParams.get('scope'), 'read:user repo');
  assert.equal(url.searchParams.get('allow_signup'), 'true');
});

test('does not send PKCE parameters: OAuth Apps do not support them', () => {
  const url = buildAuthorizeUrl(BASE);
  assert.equal(url.searchParams.has('code_challenge'), false);
  assert.equal(url.searchParams.has('code_challenge_method'), false);
});

test('trims scopes and omits an empty scope parameter', () => {
  const spaced = buildAuthorizeUrl({ ...BASE, scopes: [' repo ', '', 'read:user'] });
  assert.equal(spaced.searchParams.get('scope'), 'repo read:user');

  const empty = buildAuthorizeUrl({ ...BASE, scopes: [] });
  assert.equal(empty.searchParams.has('scope'), false);
});

test('allow_signup can be turned off', () => {
  const url = buildAuthorizeUrl({ ...BASE, allowSignup: false });
  assert.equal(url.searchParams.has('allow_signup'), false);
});

run();
