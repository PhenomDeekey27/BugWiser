// Dashboard duplicate handling + analysis-creation idempotency.
//
// Proves:
//   - a repeated row for the SAME analysis id renders/counts once;
//   - two INTENTIONAL analyses of the same repository/issue (different ids)
//     both remain visible and counted;
//   - the counters and the recent-card list are derived from the same
//     deduplicated row set (no card that is not counted);
//   - only a valid client key constrains creation, and a unique violation is
//     recognised as the concurrent-retry case.

import { strict as assert } from 'node:assert';
import { summarizeAnalyses, dedupeAnalysisRows } from './lib/analysis/dashboard-analyses';
import {
  isMissingSchema,
  isUniqueViolation,
  normalizeAnalysisIdempotencyKey,
} from './lib/analysis/idempotency';

let failures = 0;

async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log('PASS ' + name);
  } catch (err) {
    failures++;
    console.error('FAIL ' + name + ' :: ' + ((err as Error).message || String(err)));
  }
}

interface Row {
  id: string;
  status: string;
  patch_status?: string | null;
  repository_full_name?: string;
  issue_number?: number;
  created_at?: string;
}

const base: Row = {
  id: 'analysis-1',
  status: 'completed',
  patch_status: 'generated',
  repository_full_name: 'Bug_Repo',
  issue_number: 1,
  created_at: '2026-10-01T10:00:00.000Z',
};

async function main() {
  await check('duplicate rows for the same analysis id render and count once', () => {
    const summary = summarizeAnalyses([base, { ...base }]);
    assert.equal(summary.rows.length, 1);
    assert.equal(summary.recent.length, 1);
    assert.equal(summary.issuesAnalyzed, 1);
    assert.equal(summary.patchesGenerated, 1);
  });

  await check('two intentional analyses of the same issue are BOTH preserved', () => {
    const second: Row = {
      ...base,
      id: 'analysis-2',
      status: 'failed',
      patch_status: 'none',
      created_at: '2026-10-01T09:00:00.000Z',
    };
    const summary = summarizeAnalyses([base, second]);
    assert.equal(summary.rows.length, 2, 'different ids are different analyses');
    assert.equal(summary.recent.length, 2);
    assert.deepEqual(summary.rows.map((r) => r.id), ['analysis-1', 'analysis-2']);
    // Same repository + issue number must never be used as a dedupe key.
    assert.equal(summary.rows[0].repository_full_name, summary.rows[1].repository_full_name);
    assert.equal(summary.rows[0].issue_number, summary.rows[1].issue_number);
  });

  await check('counters are derived from the same deduplicated set as the cards', () => {
    const rows: Row[] = [
      base, // completed + patch
      { ...base }, // same id, must not inflate
      { id: 'a2', status: 'completed', patch_status: 'none' },
      { id: 'a3', status: 'failed', patch_status: 'generated' },
      { id: 'a4', status: 'completed', patch_status: 'generated' },
    ];
    const summary = summarizeAnalyses(rows, 5);
    assert.equal(summary.rows.length, 4);
    assert.equal(summary.issuesAnalyzed, 3); // a1, a2, a4
    assert.equal(summary.patchesGenerated, 3); // a1, a3, a4 (not a2)
    assert.equal(summary.recent.length, 4);
    assert.equal(
      summary.recent.filter((r) => r.status === 'completed').length,
      summary.issuesAnalyzed,
      'every completed card is counted exactly once'
    );
    assert.equal(
      summary.recent.filter((r) => r.patch_status && r.patch_status !== 'none').length,
      summary.patchesGenerated,
      'every patch card is counted exactly once'
    );
  });

  await check('recent limit applies AFTER dedupe, not before', () => {
    const rows: Row[] = [base, { ...base }, { ...base, id: 'a2' }, { ...base, id: 'a3' }];
    const summary = summarizeAnalyses(rows, 2);
    assert.deepEqual(summary.recent.map((r) => r.id), ['analysis-1', 'a2']);
  });

  await check('rows without a stable id are dropped rather than rendered anonymously', () => {
    const rows = [base, { ...base, id: '' }, { ...base, id: 'a2' }] as Row[];
    assert.deepEqual(dedupeAnalysisRows(rows).map((r) => r.id), ['analysis-1', 'a2']);
  });

  await check('idempotency key validation accepts UUIDs / opaque tokens only', () => {
    assert.equal(
      normalizeAnalysisIdempotencyKey('3f5c2f18-9a0e-4a02-9b2f-7f3a1c5d8e21'),
      '3f5c2f18-9a0e-4a02-9b2f-7f3a1c5d8e21'
    );
    assert.equal(normalizeAnalysisIdempotencyKey('  analysis-abc_123  '), 'analysis-abc_123');
    assert.equal(normalizeAnalysisIdempotencyKey('short'), null);
    assert.equal(normalizeAnalysisIdempotencyKey('has spaces here'), null);
    assert.equal(normalizeAnalysisIdempotencyKey('x'.repeat(201)), null);
    assert.equal(normalizeAnalysisIdempotencyKey(undefined), null);
    assert.equal(normalizeAnalysisIdempotencyKey(42), null);
  });

  await check('unique violation and missing-schema errors are classified', () => {
    assert.equal(isUniqueViolation({ code: '23505', message: 'duplicate key value' }), true);
    assert.equal(
      isUniqueViolation({ message: 'duplicate key value violates unique constraint' }),
      true
    );
    assert.equal(isUniqueViolation({ code: '23503', message: 'foreign key' }), false);
    assert.equal(isUniqueViolation(null), false);
    assert.equal(isMissingSchema({ code: '42703', message: 'column does not exist' }), true);
    assert.equal(isMissingSchema({ message: 'relation "analyses" does not exist' }), true);
    assert.equal(isMissingSchema({ code: '23505', message: 'dup' }), false);
  });

  if (failures > 0) {
    console.error(`\n${failures} dashboard/idempotency check(s) failed`);
    process.exit(1);
  }
  console.log('\nALL PASS');
}

void main();
