# TESTING.md

End-to-end testing guide for BugWiser.

---

## Test Repository Setup

### Recommended Test Repository

Use a small repository with a clear, reproducible bug. The bug should be:

- **Simple** — a single file with an obvious defect
- **Verifiable** — the expected behavior is unambiguous
- **Patchable** — the fix is a small, localized change

### Example: Calculation Bug

**Repository:** Create a new GitHub repository with this structure:

```
src/
  calculator.js
test/
  calculator.test.js
package.json
```

**`src/calculator.js`** — Contains an intentional bug:

```javascript
function calculateTotal(items, discountPercent) {
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const tax = subtotal * 0.1;
  const total = subtotal + tax;

  if (discountPercent > 0) {
    const discount = total * (discountPercent / 100);
    return total - discount;
  }

  return total;
}

module.exports = { calculateTotal };
```

**Bug:** The discount is applied after tax. It should be applied before tax.

**Expected correct behavior:**
- Input: `[{ price: 100, quantity: 1 }]`, discount: `10`
- Current (wrong): `$100 + $10 tax = $110, then $110 - $11 = $99`
- Correct: `$100 - $10 discount = $90, then $90 + $9 tax = $99`

### Example: Null Pointer Bug

**Repository:** Create a new GitHub repository with this structure:

```
src/
  parser.js
package.json
```

**`src/parser.js`** — Contains an intentional bug:

```javascript
function parseConfig(configString) {
  const lines = configString.split('\n');
  const config = {};

  for (const line of lines) {
    const [key, value] = line.split('=');
    // BUG: no null check on key
    config[key.trim()] = value.trim();
  }

  return config;
}

module.exports = { parseConfig };
```

**Bug:** Empty lines or lines without `=` cause a crash.

**Expected correct behavior:**
- Should skip empty lines and lines without `=`
- Should not throw on malformed input

---

## Test Issue

### Title

`calculateTotal applies discount after tax instead of before`

### Body

```
## Bug Description

The `calculateTotal` function in `src/calculator.js` applies the discount
after calculating tax. This means customers are charged tax on the full
price instead of the discounted price.

## Expected Behavior

1. Calculate subtotal from items
2. Apply discount to subtotal
3. Calculate tax on the discounted subtotal
4. Return the final total

## Actual Behavior

1. Calculate subtotal from items
2. Calculate tax on the full subtotal
3. Apply discount to the total (including tax)
4. Return the result

## Steps to Reproduce

1. Call `calculateTotal([{ price: 100, quantity: 1 }], 10)`
2. Expected: `$99` (discount before tax)
3. Actual: `$99` (same result in this case, but the tax amount differs)

For a clearer example:
- Subtotal: $200
- Tax rate: 10%
- Discount: 20%

Current: $200 + $20 tax = $220, then $220 - $44 = $176
Correct: $200 - $40 discount = $160, then $160 + $16 tax = $176

The customer is overcharged by the tax on the discount amount.

## Impact

All customers with percentage-based discounts are being overcharged.
```

---

## Expected Analysis Results

### Relevant Files

| File | Expected Relevance | Reason |
|------|-------------------|--------|
| `src/calculator.js` | High (0.9+) | Contains the buggy function |

### Root Cause

**Expected summary:** The `calculateTotal` function applies the discount after tax calculation instead of before.

**Expected explanation:** The function calculates tax on the full subtotal, then applies the discount to the total including tax. The correct order is: subtotal → discount → tax → total.

### Evidence

**Expected:** References to `src/calculator.js` lines 4-8 (tax calculation) and lines 10-13 (discount application), explaining the incorrect ordering.

### Solution

**Expected:** Move the discount calculation before the tax calculation. The steps should be:
1. Calculate subtotal
2. Apply discount to subtotal
3. Calculate tax on discounted subtotal
4. Return total

### Patch

**Expected diff:**

```diff
 function calculateTotal(items, discountPercent) {
   const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
-  const tax = subtotal * 0.1;
-  const total = subtotal + tax;
 
-  if (discountPercent > 0) {
-    const discount = total * (discountPercent / 100);
-    return total - discount;
+  let discountedSubtotal = subtotal;
+  if (discountPercent > 0) {
+    const discount = subtotal * (discountPercent / 100);
+    discountedSubtotal = subtotal - discount;
   }
 
-  return total;
+  const tax = discountedSubtotal * 0.1;
+  return discountedSubtotal + tax;
 }
```

---

## Test Procedure

### 1. Pre-Test Setup

```bash
# Verify server is running
curl http://localhost:3000

# Verify database is accessible
# (Check Supabase dashboard or run a query)

# Verify AI provider is configured
# (Check .env.local has at least one API key)
```

### 2. Authentication Test

1. Open http://localhost:3000
2. Click "Continue with GitHub"
3. Complete GitHub OAuth flow
4. **Verify:** Redirected to dashboard
5. **Verify:** Dashboard shows user greeting with GitHub username
6. **Verify:** Dashboard shows repository count from GitHub

### 3. Repository Selection Test

1. Click "Analyze an Issue"
2. **Verify:** Repository list loads from GitHub
3. **Verify:** Test repository appears in the list
4. Select the test repository
5. **Verify:** Issue list loads for the selected repository

### 4. Issue Selection Test

1. Select the test issue
2. **Verify:** Issue title and number are displayed
3. Click "Start Analysis"
4. **Verify:** Redirected to investigation workspace

### 5. Analysis Pipeline Test

Monitor each stage:

| Stage | Expected | How to Verify |
|-------|----------|--------------|
| Initialization | Status changes to "indexing" | UI shows progress |
| Relevant Files | `src/calculator.js` listed | File list shows the file |
| Root Cause | Discount ordering identified | Summary explains the bug |
| Evidence | Line references provided | Code snippets shown |
| Solution | Reorder operations | Steps listed |
| Patch | Unified diff generated | Diff viewer shows changes |

### 6. Patch Application Test

1. Review the generated patch in the diff viewer
2. Click "Apply Fix to New Branch"
3. Confirm in the modal
4. **Verify:** Success screen shows:
   - Branch name: `repolens/fix/issue-{N}-{id}`
   - Commit SHA
   - Files changed: `src/calculator.js`
   - "View Pull Request" button

### 7. GitHub Verification Test

1. Click "View Pull Request" or navigate to the repository on GitHub
2. **Verify:** New branch exists
3. **Verify:** Commit message references the issue
4. **Verify:** PR is created with correct title and description
5. **Verify:** PR diff shows the expected fix
6. **Verify:** Default branch is unchanged

### 8. Dashboard Persistence Test

1. Navigate back to http://localhost:3000/dashboard
2. **Verify:** "Issues Analyzed" shows 1 (or correct count)
3. **Verify:** "Patches Generated" shows 1 (or correct count)
4. **Verify:** Recent Analyses shows the completed analysis
5. Refresh the page
6. **Verify:** Values persist after refresh

---

## Fallback Testing

### Test Provider Fallback

1. Set only one provider key in `.env.local`
2. Run an analysis
3. **Verify:** Analysis completes using the configured provider
4. Add a second provider key
5. Run another analysis
6. **Verify:** System tries preferred models, falls back if needed

### Test Error Recovery

1. Set `AI_TEST_FAIL_PROVIDER=opencode` in `.env.local`
2. Run an analysis
3. **Verify:** System falls back to other providers
4. Remove the test variable
5. **Verify:** Normal operation resumes

---

## Performance Benchmarks

| Metric | Expected Range |
|--------|---------------|
| Repository indexing | 5-30 seconds |
| Relevant file discovery | 10-45 seconds |
| Root cause analysis | 15-60 seconds |
| Evidence extraction | 10-45 seconds |
| Solution generation | 15-60 seconds |
| Patch generation | 15-60 seconds |
| Patch application | 5-15 seconds |
| **Total pipeline** | **1-5 minutes** |

Times vary based on repository size, AI provider response time, and model selection.

---

## Automated Testing

BugWiser does not currently include automated test suites. The testing approach is manual end-to-end verification as described above.

### What Could Be Automated

- Unit tests for `lib/ai/validation/` (parsing and validation functions)
- Unit tests for `lib/analysis/filter.ts` (file filtering logic)
- Unit tests for `lib/analysis/fingerprint.ts` (fingerprint detection)
- Integration tests for API routes (with mock Supabase client)
- E2E tests with Playwright or Cypress (full browser automation)

---

## Test Checklist

- [ ] Server starts without errors (`npm run dev`)
- [ ] Landing page loads correctly
- [ ] GitHub OAuth flow completes
- [ ] Dashboard displays user info
- [ ] Repository list loads from GitHub
- [ ] Issue list loads for selected repository
- [ ] Analysis pipeline completes all stages
- [ ] Relevant files are identified correctly
- [ ] Root cause is explained accurately
- [ ] Evidence references specific code
- [ ] Solution provides actionable steps
- [ ] Patch generates a valid diff
- [ ] Fix branch is created on GitHub
- [ ] Patched files are committed
- [ ] Pull request is created
- [ ] Dashboard shows correct stats
- [ ] Dashboard persists after refresh
- [ ] No errors in browser console
- [ ] No errors in server logs
