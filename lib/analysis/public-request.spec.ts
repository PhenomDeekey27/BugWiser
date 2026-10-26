import assert from 'node:assert/strict';
import { validatePublicAnalysisInput } from './public-request.ts';

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

const sha = 'a'.repeat(40);

test('accepts a repository URL with a description and derives the title', () => {
  const result = validatePublicAnalysisInput({
    repositoryUrl: 'https://github.com/expressjs/express',
    description: 'Requests with a malformed cookie header crash the parser.\nMore detail.',
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.repository.fullName, 'expressjs/express');
  assert.equal(result.issue, null);
  assert.equal(result.title, 'Requests with a malformed cookie header crash the parser.');
  assert.equal(result.commit, null);
});

test('rejects a description below the minimum length', () => {
  const result = validatePublicAnalysisInput({
    repositoryUrl: 'owner/repo',
    description: 'too short',
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, 'description_too_short');
});

test('rejects an oversized description', () => {
  const result = validatePublicAnalysisInput({
    repositoryUrl: 'owner/repo',
    description: 'x'.repeat(20_001),
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, 'description_too_long');
});

test('rejects an issue that belongs to a different repository', () => {
  const result = validatePublicAnalysisInput({
    repositoryUrl: 'https://github.com/owner/repo',
    issueUrl: 'https://github.com/other/repo/issues/12',
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, 'issue_repository_mismatch');
});

test('accepts an issue URL and an owner/repo#number shorthand', () => {
  const full = validatePublicAnalysisInput({
    repositoryUrl: 'https://github.com/owner/repo/tree/develop',
    issueUrl: 'https://github.com/owner/repo/issues/42',
  });
  assert.equal(full.ok, true);
  if (full.ok) {
    assert.equal(full.issue?.number, 42);
    assert.equal(full.description, null);
    assert.equal(full.repository.ref, 'develop');
  }

  const shorthand = validatePublicAnalysisInput({
    repositoryUrl: 'owner/repo',
    issueUrl: 'owner/repo#7',
  });
  assert.equal(shorthand.ok, true);
  if (shorthand.ok) assert.equal(shorthand.issue?.number, 7);
});

test('accepts an issue number selected from the issue list', () => {
  const result = validatePublicAnalysisInput({
    repositoryUrl: 'https://github.com/owner/repo',
    issueNumber: 42,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.issue, null);
  assert.equal(result.issueNumber, 42);
  assert.equal(result.description, null);

  const invalid = validatePublicAnalysisInput({
    repositoryUrl: 'owner/repo',
    issueNumber: 0,
  });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.code, 'invalid_issue_number');
});

test('rejects malformed repositories and invalid commits', () => {
  const repo = validatePublicAnalysisInput({
    repositoryUrl: 'https://gitlab.com/owner/repo',
    description: 'A description that is long enough to pass validation.',
  });
  assert.equal(repo.ok, false);
  if (!repo.ok) assert.equal(repo.code, 'invalid_url');

  const commit = validatePublicAnalysisInput({
    repositoryUrl: 'owner/repo',
    commit: 'not-a-sha',
    description: 'A description that is long enough to pass validation.',
  });
  assert.equal(commit.ok, false);
  if (!commit.ok) assert.equal(commit.code, 'invalid_commit');
});

test('normalizes a supplied commit SHA and truncates a long title', () => {
  const result = validatePublicAnalysisInput({
    repositoryUrl: 'owner/repo',
    commit: sha.toUpperCase(),
    description: 'A description that is long enough to pass validation.',
    title: 't'.repeat(400),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.commit, sha);
  assert.equal(result.title.length, 200);
});

void run();
