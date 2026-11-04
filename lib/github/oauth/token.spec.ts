import assert from 'node:assert/strict';
import { GitHubError } from '../errors.ts';
import {
  exchangeAuthorizationCode,
  parseScopes,
  refreshAccessToken,
} from './token.ts';

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
const CODE_OPTIONS = {
  clientId: 'Iv1.abcdef1234567890',
  clientSecret: 'secret-value',
  code: 'one-time-code',
  redirectUri: 'https://bugwiser.example/api/auth/callback',
};

function fetchReturning(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch;
}

test('parses comma- and space-separated scopes without duplicates', () => {
  assert.deepEqual(parseScopes('repo, read:user,repo'), ['repo', 'read:user']);
  assert.deepEqual(parseScopes(' repo  user '), ['repo', 'user']);
  assert.deepEqual(parseScopes(''), []);
  assert.deepEqual(parseScopes(null), []);
});

test('exchanges a code for a non-expiring token', async () => {
  const grant = await exchangeAuthorizationCode(
    CODE_OPTIONS,
    fetchReturning({ access_token: 'gho_token', scope: 'repo,read:user', token_type: 'bearer' }),
    NOW
  );

  assert.deepEqual(grant, {
    accessToken: 'gho_token',
    scopes: ['repo', 'read:user'],
    expiresAt: 0,
    refreshToken: null,
  });
});

test('sends the client secret and the authorization code to GitHub', async () => {
  let sentBody = '';
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    sentBody = String(init?.body ?? '');
    return new Response(JSON.stringify({ access_token: 't' }), { status: 200 });
  }) as unknown as typeof fetch;

  await exchangeAuthorizationCode(CODE_OPTIONS, fetchImpl, NOW);

  const body = JSON.parse(sentBody) as Record<string, string>;
  assert.equal(body.client_id, CODE_OPTIONS.clientId);
  assert.equal(body.client_secret, CODE_OPTIONS.clientSecret);
  assert.equal(body.code, 'one-time-code');
  assert.equal(body.redirect_uri, CODE_OPTIONS.redirectUri);
  assert.equal(body.grant_type, undefined);
});

test('records expiry and refresh token when GitHub issues them', async () => {
  const grant = await exchangeAuthorizationCode(
    CODE_OPTIONS,
    fetchReturning({
      access_token: 'gho_token',
      expires_in: 28800,
      refresh_token: 'ghr_refresh',
      scope: 'repo',
    }),
    NOW
  );

  assert.equal(grant.expiresAt, Math.floor(NOW / 1000) + 28800);
  assert.equal(grant.refreshToken, 'ghr_refresh');
});

test('sends grant_type=refresh_token when renewing', async () => {
  let sentBody = '';
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    sentBody = String(init?.body ?? '');
    return new Response(
      JSON.stringify({ access_token: 'new', refresh_token: 'rotated', expires_in: 60 }),
      { status: 200 }
    );
  }) as unknown as typeof fetch;

  const grant = await refreshAccessToken(
    { clientId: 'id', clientSecret: 'secret', refreshToken: 'old' },
    fetchImpl,
    NOW
  );

  const body = JSON.parse(sentBody) as Record<string, string>;
  assert.equal(body.grant_type, 'refresh_token');
  assert.equal(body.refresh_token, 'old');
  assert.equal(grant.accessToken, 'new');
  assert.equal(grant.refreshToken, 'rotated');
});

test('a GitHub error payload is auth_rejected, not retryable', async () => {
  await assert.rejects(
    exchangeAuthorizationCode(
      CODE_OPTIONS,
      fetchReturning({ error: 'bad_verification_code', error_description: 'The code is invalid' }, 200)
    ),
    (error: unknown) => {
      assert.ok(error instanceof GitHubError);
      assert.equal(error.code, 'auth_rejected');
      assert.equal(error.message, 'The code is invalid');
      return true;
    }
  );
});

test('an unreadable body is an api_error', async () => {
  await assert.rejects(
    exchangeAuthorizationCode(CODE_OPTIONS, fetchReturning('<html>oops</html>')),
    (error: unknown) => {
      assert.ok(error instanceof GitHubError);
      assert.equal(error.code, 'api_error');
      return true;
    }
  );
});

test('a network failure is network_error', async () => {
  const failing = (async () => {
    throw new TypeError('fetch failed');
  }) as unknown as typeof fetch;

  await assert.rejects(exchangeAuthorizationCode(CODE_OPTIONS, failing), (error: unknown) => {
    assert.ok(error instanceof GitHubError);
    assert.equal(error.code, 'network_error');
    return true;
  });
});

run();
