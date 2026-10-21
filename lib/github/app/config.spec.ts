import assert from 'node:assert/strict';
import { githubAppInstallUrl, normalizeGitHubAppSlug, privateKeyShape } from './config.ts';

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

const MALFORMED = [
  // Full URLs: the misconfiguration that produced a 404 install link.
  'https://github.com/settings/apps/bugwiser-devassistant',
  'https://github.com/apps/bugwiser-devassistant',
  'http://github.com/apps/bugwiser-devassistant',
  'github.com/apps/bugwiser-devassistant',
  // Paths and fragments.
  'apps/bugwiser-devassistant',
  'bugwiser-devassistant/installations/new',
  'bugwiser-devassistant?tab=1',
  'bugwiser-devassistant#readme',
  'bugwiser-devassistant&x=1',
  'bugwiser-devassistant%2Fsettings',
  // Other separators / characters GitHub does not allow in a slug.
  'bugwiser devassistant',
  'bugwiser_devassistant',
  'bugwiser.devassistant',
  'bugwiser@devassistant',
  'bugwiser:devassistant',
  'bugwiser\\devassistant',
  // GitHub's rule: single hyphens only, never at either end.
  '-bugwiser-devassistant',
  'bugwiser-devassistant-',
  'bugwiser--devassistant',
  // Empty / oversized.
  '',
  '   ',
  'a'.repeat(101),
];

suite('normalizeGitHubAppSlug', () => {
  test('accepts a real slug unchanged', () => {
    assert.equal(normalizeGitHubAppSlug('bugwiser-devassistant'), 'bugwiser-devassistant');
  });

  test('trims surrounding whitespace and lowercases', () => {
    assert.equal(normalizeGitHubAppSlug('  BugWiser-DevAssistant  '), 'bugwiser-devassistant');
  });

  test('accepts a single character and a 100-character slug', () => {
    assert.equal(normalizeGitHubAppSlug('a'), 'a');
    assert.equal(normalizeGitHubAppSlug('a'.repeat(100)), 'a'.repeat(100));
  });

  test('rejects full URLs, paths, query strings and malformed slugs', () => {
    for (const value of MALFORMED) {
      assert.equal(normalizeGitHubAppSlug(value), null, `accepted ${JSON.stringify(value)}`);
    }
  });

  test('rejects non-string input', () => {
    assert.equal(normalizeGitHubAppSlug(null), null);
    assert.equal(normalizeGitHubAppSlug(undefined), null);
  });
});

suite('githubAppInstallUrl', () => {
  test('builds the canonical installation URL', () => {
    assert.equal(
      githubAppInstallUrl('bugwiser-devassistant'),
      'https://github.com/apps/bugwiser-devassistant/installations/new'
    );
  });

  test('never percent-encodes an input into a host path', () => {
    const url = githubAppInstallUrl('bugwiser-devassistant');
    assert.ok(url);
    assert.ok(!url.includes('%'));
    assert.equal(url.split('/').length, 7); // https: + '' + github.com + apps + slug + installations + new
  });

  test('returns null for a settings URL instead of a broken install link', () => {
    assert.equal(
      githubAppInstallUrl('https://github.com/settings/apps/bugwiser-devassistant'),
      null
    );
  });

  test('returns null for every malformed slug', () => {
    for (const value of MALFORMED) {
      assert.equal(githubAppInstallUrl(value), null, `built a URL for ${JSON.stringify(value)}`);
    }
    assert.equal(githubAppInstallUrl(null), null);
  });

  test('reads the validated slug from GITHUB_APP_SLUG', () => {
    const original = process.env.GITHUB_APP_SLUG;
    try {
      process.env.GITHUB_APP_SLUG = 'bugwiser-devassistant';
      assert.equal(
        githubAppInstallUrl(),
        'https://github.com/apps/bugwiser-devassistant/installations/new'
      );

      process.env.GITHUB_APP_SLUG = 'https://github.com/settings/apps/bugwiser-devassistant';
      assert.equal(githubAppInstallUrl(), null);

      delete process.env.GITHUB_APP_SLUG;
      assert.equal(githubAppInstallUrl(), null);
    } finally {
      if (original === undefined) delete process.env.GITHUB_APP_SLUG;
      else process.env.GITHUB_APP_SLUG = original;
    }
  });
});

suite('privateKeyShape', () => {
  test('accepts RSA, PKCS#8 and EC private key PEMs', () => {
    const shapes = [
      '-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----',
      '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
      '-----BEGIN EC PRIVATE KEY-----\nabc\n-----END EC PRIVATE KEY-----',
    ];
    for (const pem of shapes) {
      assert.equal(privateKeyShape(pem), 'private_key');
    }
  });

  test('rejects a certificate pasted into GITHUB_APP_PRIVATE_KEY', () => {
    assert.equal(
      privateKeyShape('-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----'),
      'certificate'
    );
  });

  test('reports missing and other malformed values', () => {
    assert.equal(privateKeyShape(''), 'missing');
    assert.equal(privateKeyShape('not-a-pem'), 'other');
    // A truncated multi-line value (what an unquoted .env produces).
    assert.equal(privateKeyShape('-----BEGIN RSA PRIVATE KEY-----'), 'other');
  });
});

run();
