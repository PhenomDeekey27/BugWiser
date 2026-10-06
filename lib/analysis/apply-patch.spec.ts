import assert from 'node:assert/strict';
import {
  applyHunksToContent,
  applyHunksDetailed,
  matchKey,
  toPhysicalLines,
  normalizeHunkLines,
} from './patch-lines.ts';
import {
  findSyntaxRegression,
  parsesAsJavaScript,
  verifyPatchAgainstSources,
} from './patch-verify.ts';

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

// ── Real artifacts ───────────────────────────────────────────────────────────
// Verbatim from analysis 421faf8d-46f5-43ea-ae17-9ebea6d3091b — the run whose
// "No files could be applied" failure started this investigation.

const ORDER_RESPONSE_SERVICE = `const {
  calculateSubtotal,
  calculateDiscount,
  calculateTotal
} = require("./pricingService");
const { calculateShippingCost } = require("./shippingService");

function buildOrderResponse(order) {
  const subtotal = calculateSubtotal(order.items);
  const discount = calculateDiscount(subtotal, order.discount);
  const shippingCost = calculateShippingCost(order.shipping);

  const total = calculateTotal(
    subtotal,
    order.discount,
    shippingCost
  );

  return {
    id: order.id,
    customer: order.customer,
    items: order.items,
    pricing: {
      subtotal,
      discount,
      shipping: shippingCost,
      total
    },
    shipping: order.shipping
  };
}

module.exports = { buildOrderResponse };`;

/**
 * The stored `patch` artifact from the failing analysis, verbatim. Its old
 * side (3 context + 4 removed) is NOT contiguous — the blank file line 12 sits
 * between the context block and the removed block — which is exactly what made
 * the previous window matcher return "Expected content not found".
 */
const BROKEN_HUNK_LINES = [
  { type: 'context', content: '  const subtotal = calculateSubtotal(order.items);' },
  { type: 'context', content: '  const discount = calculateDiscount(subtotal, order.discount);' },
  { type: 'context', content: '  const shippingCost = calculateShippingCost(order.shipping);' },
  { type: 'removed', content: '  const total = calculateTotal(' },
  { type: 'removed', content: '    subtotal,' },
  { type: 'removed', content: '    order.discount,' },
  { type: 'removed', content: '    shippingCost' },
  { type: 'added', content: '  );' },
  { type: 'added', content: '  const total = calculateTotal(' },
  { type: 'added', content: '    subtotal,' },
  { type: 'added', content: '    discount,' },
  { type: 'added', content: '    shippingCost' },
  { type: 'added', content: '  );' },
];

const BROKEN_PATCH = {
  path: 'src/services/orderResponseService.js',
  hunks: [
    { oldStart: 13, oldLines: 5, newStart: 13, newLines: 5, lines: BROKEN_HUNK_LINES },
  ],
};

const PRICING_SERVICE = `function calculateSubtotal(items) {
  return items.reduce(
    (total, item) => total + item.quantity * item.unitPrice,
    0
  );
}

function calculateDiscount(subtotal, discount) {
  if (!discount) {
    return 0;
  }

  if (discount.type === "percentage") {
    return subtotal * (discount.value / 100);
  }

  if (discount.type === "fixed") {
    return Math.min(discount.value, subtotal);
  }

  return 0;
}

function calculateTotal(subtotal, discountAmount, shippingCost) {
  return subtotal - discountAmount + shippingCost;
}

module.exports = {
  calculateSubtotal,
  calculateDiscount,
  calculateTotal
};`;

// Packed content (the model put the line terminator inside `content`) and a
// wrong `oldStart` (28 vs the real line 24) — the Oct 3 artifact that must
// keep applying.
const PRICING_PATCH = {
  path: 'src/services/pricingService.js',
  hunks: [
    {
      oldStart: 28,
      oldLines: 6,
      newStart: 28,
      newLines: 7,
      lines: [
        { type: 'context', content: 'function calculateTotal(subtotal, discountAmount, shippingCost) {\n' },
        { type: 'removed', content: '  return subtotal - discountAmount + shippingCost;\n' },
        {
          type: 'added',
          content:
            '  const discountedSubtotal = subtotal - discountAmount;\n  return discountedSubtotal + shippingCost;\n',
        },
      ],
    },
  ],
};

// ── matchKey ────────────────────────────────────────────────────────────────
suite('matchKey', () => {
  test('collapses whitespace runs to a single space', () => {
    assert.equal(matchKey('return   42;'), 'return 42;');
    assert.equal(matchKey('    return 42;    '), 'return 42;');
  });

  test('treats tabs and spaces as equivalent', () => {
    assert.equal(matchKey('\treturn x;'), matchKey('  return x;'));
  });

  test('does not alter the line text itself', () => {
    assert.equal(matchKey('const a=1;'), 'const a=1;');
    assert.notEqual(matchKey('const a=1;'), matchKey('const a = 1;'));
  });
});

// ── toPhysicalLines ─────────────────────────────────────────────────────────
suite('toPhysicalLines', () => {
  test('splits on all terminators and drops the trailing terminator', () => {
    assert.deepEqual(toPhysicalLines('a\nb\n'), ['a', 'b']);
    assert.deepEqual(toPhysicalLines('a'), ['a']);
    assert.deepEqual(toPhysicalLines('a\r\nb\r'), ['a', 'b']);
  });

  test('is idempotent', () => {
    const once = toPhysicalLines('a\nb\n');
    assert.deepEqual(toPhysicalLines(once.join('\n')), once);
    assert.deepEqual(toPhysicalLines(toPhysicalLines('x').join('\n')), ['x']);
  });
});

// ── normalizeHunkLines ──────────────────────────────────────────────────────
suite('normalizeHunkLines', () => {
  test('expands packed multi-line content into physical lines', () => {
    const lines = normalizeHunkLines([{ type: 'added', content: '  return 42;\n' }]);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].content, '  return 42;');
  });

  test('expands one packed entry into several rows, preserving the type', () => {
    const lines = normalizeHunkLines([
      { type: 'added', content: '  const a = 1;\n  const b = 2;\n' },
    ]);
    assert.deepEqual(
      lines.map((line) => line.content),
      ['  const a = 1;', '  const b = 2;']
    );
    assert.ok(lines.every((line) => line.type === 'added'));
  });

  test('passes through entries whose content is not a string', () => {
    const lines = normalizeHunkLines([{ type: 'context', content: 42 }]);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].content, 42);
  });
});

// ── applyHunksToContent ─────────────────────────────────────────────────────
suite('applyHunksToContent', () => {
  test('applies a straightforward added-line hunk', () => {
    const file = 'function f() {\n  return 1;\n}\n';
    const result = applyHunksToContent(file, [
      {
        oldStart: 2,
        lines: [
          { type: 'context', content: '  return 1;\n' },
          { type: 'added', content: '  console.log("hi");\n' },
        ],
      },
    ]);
    assert.equal(result, 'function f() {\n  return 1;\n  console.log("hi");\n}\n');
  });

  test('tolerates whitespace differences (tab vs space) in context', () => {
    const file = 'function f() {\n\treturn x;\n}\n';
    const result = applyHunksToContent(file, [
      {
        oldStart: 2,
        lines: [
          { type: 'context', content: '    return x;\n' },
          { type: 'added', content: '  console.log(x);\n' },
        ],
      },
    ]);
    assert.equal(result, 'function f() {\n\treturn x;\n  console.log(x);\n}\n');
  });

  test('recovers the exact location when the model reports a wrong line number', () => {
    const file = 'const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\n';
    const result = applyHunksToContent(file, [
      {
        oldStart: 3, // reported line 3, the content is really on line 2
        lines: [
          { type: 'context', content: 'const b = 2;' },
          { type: 'added', content: 'const b2 = 2;' },
        ],
      },
    ]);
    assert.equal(result, 'const a = 1;\nconst b = 2;\nconst b2 = 2;\nconst c = 3;\nconst d = 4;\n');
  });

  test('applies a multi-group hunk (context interleaved with changes)', () => {
    const file = 'line0\nline1\nline2\nline3\nline4\nline5\nline6\n';
    const result = applyHunksToContent(file, [
      {
        oldStart: 1,
        lines: [
          { type: 'context', content: 'line1\n' },
          { type: 'added', content: 'NEW_A\n' },
          { type: 'context', content: 'line3\n' },
          { type: 'removed', content: 'line4\n' },
          { type: 'added', content: 'NEW_B\n' },
        ],
      },
    ]);
    // `line2` was never quoted by the model but sits between two of its
    // anchors, so it must still be present afterwards — in file order.
    assert.equal(result, 'line0\nline1\nline2\nNEW_A\nline3\nNEW_B\nline5\nline6\n');
  });

  test('shifts later hunks after an earlier deletion', () => {
    const file = 'a\nb\nc\nd\ne\nf\n';
    const result = applyHunksToContent(file, [
      {
        oldStart: 1,
        lines: [
          { type: 'context', content: 'a' },
          { type: 'removed', content: 'b' },
        ],
      },
      {
        oldStart: 6,
        lines: [
          { type: 'context', content: 'f' },
          { type: 'added', content: 'g' },
        ],
      },
    ]);
    assert.equal(result, 'a\nc\nd\ne\nf\ng\n');
  });

  test('a context-only hunk applies as a no-op', () => {
    const file = 'const a = 1;\nconst b = 2;\n';
    const result = applyHunksToContent(file, [
      {
        oldStart: 1,
        lines: [{ type: 'context', content: 'const a = 1;' }],
      },
    ]);
    assert.equal(result, file);
  });

  test('preserves blank lines the model left out of its context', () => {
    const file = 'const a = 1;\n\nconst b = 2;\n\nconst c = 3;\n';
    const result = applyHunksToContent(file, [
      {
        oldStart: 1,
        lines: [
          { type: 'context', content: 'const a = 1;' },
          { type: 'context', content: 'const b = 2;' },
          { type: 'context', content: 'const c = 3;' },
          { type: 'added', content: 'const d = 4;' },
        ],
      },
    ]);
    assert.equal(result, 'const a = 1;\n\nconst b = 2;\n\nconst c = 3;\nconst d = 4;\n');
  });

  test('applies the real non-contiguous hunk instead of reporting "not found"', () => {
    const result = applyHunksToContent(ORDER_RESPONSE_SERVICE, BROKEN_PATCH.hunks);
    assert.notEqual(result, null);

    // The blank file line 12 that the old window matcher could not skip.
    assert.match(result!, /calculateShippingCost\(order\.shipping\);\n\n {2}\);/);
    // Everything after the edited block still survives.
    assert.match(result!, /\n  return \{\n/);
    assert.match(result!, /module\.exports = \{ buildOrderResponse \};/);
  });

  test('applies the packed-content pricingService artifact verbatim', () => {
    const result = applyHunksToContent(PRICING_SERVICE, PRICING_PATCH.hunks);
    assert.notEqual(result, null);
    assert.match(result!, /const discountedSubtotal = subtotal - discountAmount;/);
    assert.match(result!, /return discountedSubtotal \+ shippingCost;/);
    assert.ok(!result!.includes('return subtotal - discountAmount + shippingCost;'));
    assert.ok(parsesAsJavaScript(result!));
  });

  test('rejects a patch whose expected content is not in the file', () => {
    const file = 'const a = 1;\nconst b = 2;\n';
    const result = applyHunksToContent(file, [
      {
        oldStart: 1,
        lines: [
          { type: 'context', content: 'const missing = 5;' },
          { type: 'added', content: 'const zzz = 99;' },
        ],
      },
    ]);
    assert.equal(result, null);
  });

  test('rejects a pure-addition hunk (nothing to locate it)', () => {
    const file = 'const a = 1;\nconst b = 2;\nconst c = 3;\n';
    const result = applyHunksToContent(file, [
      { oldStart: 2, lines: [{ type: 'added', content: 'X' }] },
      { oldStart: 3, lines: [{ type: 'added', content: 'Y' }] },
    ]);
    assert.equal(result, null);
  });

  test('rejects overlapping hunks (malformed patch)', () => {
    const file = 'a\nb\nc\n';
    const result = applyHunksToContent(file, [
      {
        oldStart: 1,
        lines: [
          { type: 'context', content: 'a' },
          { type: 'removed', content: 'b' },
          { type: 'added', content: 'B' },
        ],
      },
      {
        oldStart: 2,
        lines: [
          { type: 'context', content: 'b' },
          { type: 'removed', content: 'c' },
          { type: 'added', content: 'C' },
        ],
      },
    ]);
    assert.equal(result, null);
  });

  test('does not match an unrelated-but-similar file region', () => {
    const file = 'function alpha() {\n  return 10;\n}\n';
    const result = applyHunksToContent(file, [
      {
        oldStart: 1,
        lines: [
          { type: 'context', content: 'const unrelated = 20;' },
          { type: 'added', content: 'const done = 1;' },
        ],
      },
    ]);
    assert.equal(result, null);
  });

  test('adds CRLF lines when the file uses CRLF endings', () => {
    const file = 'function f() {\r\n  return 1;\r\n}\r\n';
    const result = applyHunksToContent(file, [
      {
        oldStart: 2,
        lines: [
          { type: 'context', content: '  return 1;\r\n' },
          { type: 'added', content: '  console.log("hi");\n' },
        ],
      },
    ]);
    assert.equal(result, 'function f() {\r\n  return 1;\r\n  console.log("hi");\r\n}\r\n');
  });

  test('does not introduce CR into an LF file when the model emits CRLF', () => {
    const file = 'function f() {\n  return 1;\n}\n';
    const result = applyHunksToContent(file, [
      {
        oldStart: 2,
        lines: [
          { type: 'context', content: '  return 1;\r\n' },
          { type: 'added', content: '  console.log("hi");\r\n' },
        ],
      },
    ]);
    assert.equal(result, 'function f() {\n  return 1;\n  console.log("hi");\n}\n');
    assert.ok(!result!.includes('\r'));
  });

  test('rejects a stale file whose context line changed by one character', () => {
    // The model saw `return 1;`; the file now says `return 2;`. Content has to
    // match exactly (whitespace aside) or the patch would edit a line the
    // model never looked at.
    const file = 'function f() {\n  return 2;\n}\n';
    const result = applyHunksToContent(file, [
      {
        oldStart: 2,
        lines: [
          { type: 'context', content: '  return 1;' },
          { type: 'added', content: '  console.log(1);' },
        ],
      },
    ]);
    assert.equal(result, null);
  });

  test('never matches a line it is about to delete', () => {
    // `return 10;` is one character away from `return 20;`, but a REMOVED line
    // must be quoted exactly — otherwise the patch would delete real code.
    const file = 'function alpha() {\n  return 10;\n}\n';
    const result = applyHunksToContent(file, [
      {
        oldStart: 2,
        lines: [{ type: 'removed', content: '  return 20;' }],
      },
    ]);
    assert.equal(result, null);
  });

  test('does not apply when the closest region is farther than the cutoff', () => {
    const file = 'const alpha1 = 1;\nconst alpha2 = 2;\nconst alpha3 = 3;\nconst alpha4 = 4;\nconst alpha5 = 5;\n';
    const result = applyHunksToContent(file, [
      {
        oldStart: 1,
        lines: [
          { type: 'context', content: 'function unrelated() {' },
          { type: 'context', content: '  return 0;' },
          { type: 'context', content: '}' },
          { type: 'added', content: 'const done = 1;' },
        ],
      },
    ]);
    assert.equal(result, null);
  });
});

// ── applyHunksDetailed ──────────────────────────────────────────────────────
suite('applyHunksDetailed', () => {
  test('reports why the expected content was not found', () => {
    const outcome = applyHunksDetailed('const a = 1;\n', [
      {
        oldStart: 1,
        lines: [
          { type: 'context', content: 'const missing = 1;' },
          { type: 'added', content: 'const b = 2;' },
        ],
      },
    ]);
    assert.ok(!outcome.ok);
    assert.equal(outcome.ok ? '' : outcome.reason, 'not_found');
    assert.equal(outcome.ok ? -1 : outcome.hunkIndex, 0);
    assert.match(outcome.ok ? '' : outcome.detail, /expected 1 line/);
  });

  test('reports an unanchored hunk distinctly from missing content', () => {
    const outcome = applyHunksDetailed('const a = 1;\n', [
      { oldStart: 1, lines: [{ type: 'added', content: 'const b = 2;' }] },
    ]);
    assert.ok(!outcome.ok);
    assert.equal(outcome.ok ? '' : outcome.reason, 'unanchored');
    assert.match(outcome.ok ? '' : outcome.detail, /context or removed/);
  });

  test('reports which hunk overlaps', () => {
    const outcome = applyHunksDetailed('a\nb\nc\n', [
      {
        oldStart: 1,
        lines: [
          { type: 'context', content: 'a' },
          { type: 'removed', content: 'b' },
          { type: 'added', content: 'B' },
        ],
      },
      {
        oldStart: 2,
        lines: [
          { type: 'context', content: 'b' },
          { type: 'removed', content: 'c' },
          { type: 'added', content: 'C' },
        ],
      },
    ]);
    assert.ok(!outcome.ok);
    assert.equal(outcome.ok ? '' : outcome.reason, 'overlap');
    assert.equal(outcome.ok ? -1 : outcome.hunkIndex, 1);
  });

  test('rejects a line with an unrecognized type', () => {
    const outcome = applyHunksDetailed('const a = 1;\n', [
      {
        oldStart: 1,
        lines: [{ type: 'weird', content: 'const a = 1;' }],
      },
    ]);
    assert.ok(!outcome.ok);
    assert.equal(outcome.ok ? '' : outcome.reason, 'malformed');
    assert.match(outcome.ok ? '' : outcome.detail, /unrecognized type/);
  });

  test('rejects a line whose content is not a string', () => {
    const outcome = applyHunksDetailed('const a = 1;\n', [
      {
        oldStart: 1,
        lines: [{ type: 'context', content: 42 }],
      },
    ]);
    assert.ok(!outcome.ok);
    assert.equal(outcome.ok ? '' : outcome.reason, 'malformed');
    assert.match(outcome.ok ? '' : outcome.detail, /not a string/);
  });
});

// ── patch-verify: JavaScript syntax guard ───────────────────────────────────
suite('parsesAsJavaScript', () => {
  test('accepts CommonJS and top-level await', () => {
    assert.equal(parsesAsJavaScript('const a = 1;\nmodule.exports = { a };'), true);
    assert.equal(parsesAsJavaScript('const v = await fetch("/x");'), true);
    assert.equal(parsesAsJavaScript('async function f() { await g(); }'), true);
  });

  test('rejects module syntax, JSX and broken code', () => {
    assert.equal(parsesAsJavaScript('import x from "y";\nexport const a = 1;'), false);
    assert.equal(parsesAsJavaScript('export default function Page() { return <div/>; }'), false);
    assert.equal(parsesAsJavaScript('function f() {\n  );\n}'), false);
  });
});

suite('findSyntaxRegression', () => {
  test('detects the broken result produced by the real failing artifact', () => {
    const applied = applyHunksToContent(ORDER_RESPONSE_SERVICE, BROKEN_PATCH.hunks);
    assert.notEqual(applied, null);
    const problem = findSyntaxRegression(ORDER_RESPONSE_SERVICE, applied!);
    assert.match(problem!, /no longer parses as JavaScript/);
  });

  test('stays silent when the patched file still parses', () => {
    const applied = applyHunksToContent(PRICING_SERVICE, PRICING_PATCH.hunks);
    assert.notEqual(applied, null);
    assert.equal(findSyntaxRegression(PRICING_SERVICE, applied!), null);
  });

  test('stays silent when the original file cannot be evaluated', () => {
    const esm = 'import x from "y";\nconst a = x + 1;\nexport default a;\n';
    assert.equal(findSyntaxRegression(esm, 'import x from "y";\nconst a = ;\nexport default a;\n'), null);
  });

  test('stays silent when nothing changed', () => {
    assert.equal(findSyntaxRegression('function f() { return ; }', 'function f() { return ; }'), null);
  });
});

// ── patch-verify: pre-flight dry run ────────────────────────────────────────
suite('verifyPatchAgainstSources', () => {
  test('accepts a patch that applies and still parses', () => {
    const result = verifyPatchAgainstSources(
      [PRICING_PATCH],
      [{ path: 'src/services/pricingService.js', content: PRICING_SERVICE }]
    );
    assert.deepEqual(result, { ok: true });
  });

  test('rejects the real failing artifact before it is ever stored', () => {
    const result = verifyPatchAgainstSources(
      [BROKEN_PATCH],
      [{ path: 'src/services/orderResponseService.js', content: ORDER_RESPONSE_SERVICE }]
    );
    assert.ok(!result.ok);
    assert.match(result.ok ? '' : result.message, /src\/services\/orderResponseService\.js/);
    assert.match(result.ok ? '' : result.message, /no longer parses as JavaScript/);
  });

  test('skips files the analysis never captured', () => {
    const result = verifyPatchAgainstSources([PRICING_PATCH], []);
    assert.deepEqual(result, { ok: true });
  });

  test('skips files that carry no change', () => {
    const result = verifyPatchAgainstSources(
      [{ path: 'src/a.js', hunks: [{ oldStart: 1, lines: [{ type: 'context', content: 'x' }] }] }],
      [{ path: 'src/a.js', content: 'x\n' }]
    );
    assert.deepEqual(result, { ok: true });
  });

  test('reports a file whose expected content is gone', () => {
    const result = verifyPatchAgainstSources(
      [PRICING_PATCH],
      [{ path: 'src/services/pricingService.js', content: 'module.exports = {};\n' }]
    );
    assert.ok(!result.ok);
    assert.match(result.ok ? '' : result.message, /Expected content not found/);
    assert.match(result.ok ? '' : result.message, /The file may have changed since analysis/);
  });
});

// __SUITES__

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
