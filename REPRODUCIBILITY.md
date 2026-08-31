# REPRODUCIBILITY.md

Technical guide for reproducing the BugWiser workflow from a clean environment.

## 🔗 Links

- **Live Demo:**  https://BugWiser-nine.vercel.app/
- **Source Code:** https://github.com/PhenomDeekey27/BugWiser
- **Demo Video:**  https://drive.google.com/file/d/1P1AcylAB4JAaG7QHiw6dKXRNJWhYIgvd/view?pli=1


## 🔗 Links

- **Live Demo:**  https://issuepilot-nine.vercel.app/
- **Source Code:** https://github.com/PhenomDeekey27/IssuePilot
- **Demo Video:**  https://drive.google.com/file/d/1P1AcylAB4JAaG7QHiw6dKXRNJWhYIgvd/view?pli=1


---

## Prerequisites

| Requirement | Details |
|-------------|---------|
| Node.js | 18+ (check with `node --version`) |
| npm | 9+ (check with `npm --version`) |
| Git | 2.30+ |
| GitHub account | With at least one repository containing issues |
| Supabase account | Free tier works ([supabase.com](https://supabase.com)) |
| AI provider key | At least one of: OpenCode Zen, OpenRouter, Chutes, Z.AI, DeepSeek, or Gemini |

---

## 1. Repository Setup

```bash
git clone https://github.com/your-org/BugWiser.git
cd BugWiser
npm install
```

---

## 2. Supabase Setup

### Create Project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard)
2. Click "New project"
3. Choose a project name and database password
4. Note the project URL and anon key from Settings > API

### Run Migrations

Open the Supabase SQL Editor and run each migration file in order:

```
supabase/migrations/001_analysis_schema.sql
supabase/migrations/002_ai_pipeline_extensions.sql
supabase/migrations/003_add_model_config.sql
supabase/migrations/004_ai_investigation_stages.sql
supabase/migrations/005_add_analyzing_status_and_fix_constraints.sql
supabase/migrations/006_add_model_execution_artifact.sql
supabase/migrations/007_add_patch_application_fields.sql
supabase/migrations/008_add_pull_request_url.sql
```

Each migration uses `IF NOT EXISTS` and is idempotent — safe to re-run.

### Get Service Role Key

1. Go to Settings > API in your Supabase dashboard
2. Copy the `service_role` key (shown with a warning icon)
3. This key bypasses RLS and is used server-side only

---

## 3. GitHub OAuth Setup

### Create OAuth App

1. Go to [github.com/settings/developers](https://github.com/settings/developers)
2. Click "New OAuth App"
3. Fill in:
   - **Application name:** `BugWiser`
   - **Homepage URL:** `http://localhost:3000`
   - **Authorization callback URL:** `https://{YOUR_SUPABASE_PROJECT_REF}.supabase.co/auth/v1/callback`
     - Replace `{YOUR_SUPABASE_PROJECT_REF}` with your Supabase project reference (found in Settings > API > Project URL)
4. Click "Register application"
5. Copy the **Client ID**
6. Generate a **Client Secret** and copy it

### Configure in Supabase

1. In Supabase Dashboard, go to Authentication > Providers
2. Find GitHub and toggle it on
3. Paste the Client ID and Client Secret
4. Save

### Required Scopes

BugWiser uses these GitHub OAuth scopes (requested automatically by Supabase):

- `repo` — Read/write access to repositories (needed for branch creation, commits, PRs)
- `read:user` — Read user profile
- `user:email` — Read user email

---

## 4. AI Provider Setup

At least one provider must be configured. The system skips unconfigured providers automatically.

### Option A: OpenCode Zen (Recommended — Free)

1. Go to [opencode.ai](https://opencode.ai)
2. Sign up and get an API key
3. Set in `.env.local`:
   ```
   OPENCODE_ZEN_API_KEY=your-key-here
   OPENCODE_ZEN_BASE_URL=https://opencode.ai/zen/v1
   ```

### Option B: OpenRouter (Free Models)

1. Go to [openrouter.ai](https://openrouter.ai)
2. Sign up and get an API key
3. Set in `.env.local`:
   ```
   OPENROUTER_API_KEY=your-key-here
   OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
   ```

### Option C: Chutes (Free Testing)

1. Go to [chutes.ai](https://chutes.ai)
2. Sign up and get an API key
3. Set in `.env.local`:
   ```
   CHUTES_API_KEY=your-key-here
   CHUTES_BASE_URL=https://llm.chutes.ai/v1
   ```

### Option D: DeepSeek (Paid)

1. Go to [platform.deepseek.com](https://platform.deepseek.com)
2. Add credits and get an API key
3. Set in `.env.local`:
   ```
   DEEPSEEK_API_KEY=your-key-here
   DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
   ```

### Option E: Gemini (Paid)

1. Go to [aistudio.google.com](https://aistudio.google.com)
2. Get an API key
3. Set in `.env.local`:
   ```
   GEMINI_API_KEY=your-key-here
   ```

---

## 5. Environment Configuration

```bash
cp .env.example .env.local
```

Edit `.env.local` with your actual values:

```env
# Supabase (required)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# At least one AI provider (required)
OPENCODE_ZEN_API_KEY=your-key
OPENCODE_ZEN_BASE_URL=https://opencode.ai/zen/v1
```

---

## 6. Start the Application

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## 7. End-to-End Test Procedure

### Step 1: Create a Test Repository

Create a GitHub repository with an intentional bug. Example structure:

```
src/
  calculator.js
package.json
README.md
```

Example `src/calculator.js` with a bug:

```javascript
function calculateTotal(items, discountPercent) {
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const tax = subtotal * 0.1;
  const total = subtotal + tax;
  
  // BUG: discount applied after tax
  if (discountPercent > 0) {
    const discount = total * (discountPercent / 100);
    return total - discount;
  }
  
  return total;
}

module.exports = { calculateTotal };
```

### Step 2: Create a GitHub Issue

Open an issue in the test repository:

**Title:** `calculateTotal applies discount after tax instead of before`

**Body:**
```
## Bug Description
The calculateTotal function applies the discount after calculating tax,
which results in customers being overcharged.

## Expected Behavior
Discount should be applied to the subtotal before tax calculation.

## Steps to Reproduce
1. Call calculateTotal with items totaling $100 and a 10% discount
2. Expected: $100 - $10 discount = $90, then $90 + $9 tax = $99
3. Actual: $100 + $10 tax = $110, then $110 - $11 discount = $99
   (Same result in this case, but wrong for percentage-based discounts
   where tax should be on the discounted price)

## Impact
Customers are charged tax on the full price instead of the discounted price.
```

### Step 3: Sign In to BugWiser

1. Open http://localhost:3000
2. Click "Continue with GitHub"
3. Authorize the application

### Step 4: Select Repository

1. From the dashboard, click "Analyze an Issue"
2. Select your test repository from the list

### Step 5: Select Issue

1. From the issue list, select the bug report you created
2. Click "Start Analysis"

### Step 6: Verify Analysis Stages

Watch the investigation workspace as each stage completes:

| Stage | What to Verify |
|-------|---------------|
| **Repository Index** | File tree is fetched, fingerprint shows correct language/framework |
| **Relevant Files** | `src/calculator.js` appears with high relevance score |
| **Root Cause** | AI identifies the discount-after-tax ordering issue |
| **Evidence** | AI references specific lines in `src/calculator.js` |
| **Solution** | AI proposes moving discount calculation before tax |
| **Patch** | Unified diff shows the reordering of operations |

### Step 7: Verify Patch Application

1. Click "Apply Fix to New Branch"
2. Confirm in the modal
3. Verify:
   - A new branch `BugWiser/fix/issue-{N}-{id}` is created on GitHub
   - The patched file is committed on that branch
   - A pull request is created linking to the default branch

### Step 8: Verify Pull Request

1. Click "View Pull Request" in the success screen
2. On GitHub, verify:
   - The PR title references the issue
   - The diff shows the correct fix
   - CI checks pass (if configured)

---

## 8. Troubleshooting

### Analysis Fails to Start

- Check that at least one AI provider API key is set in `.env.local`
- Verify the Supabase project URL and keys are correct
- Check the browser console and server logs for errors

### Repository List is Empty

- Verify the GitHub OAuth is configured in Supabase
- Check that the `repo` scope is granted during OAuth
- Try signing out and signing back in

### Patch Application Fails

- Verify `SUPABASE_SERVICE_ROLE_KEY` is set
- Check that the GitHub token has write access (the `repo` scope)
- The user may need to re-authenticate to get a token with write permissions

### AI Returns Low-Quality Results

- Try a different provider (Gemini or DeepSeek tend to be more capable)
- The issue description may need more detail
- Complex repositories may exceed context window limits

---

## 9. Database Verification

To verify data is persisted correctly, query the Supabase SQL Editor:

```sql
-- Check analyses
SELECT id, status, current_stage, patch_status, created_branch, pull_request_url
FROM analyses
ORDER BY created_at DESC
LIMIT 10;

-- Check artifacts for an analysis
SELECT artifact_type, created_at
FROM analysis_artifacts
WHERE analysis_id = 'your-analysis-id'
ORDER BY created_at;

-- Check dashboard stats
SELECT
  COUNT(*) FILTER (WHERE status = 'completed') AS issues_analyzed,
  COUNT(*) FILTER (WHERE patch_status IS NOT NULL AND patch_status != 'none') AS patches_generated
FROM analyses
WHERE user_id = 'your-user-id';
```

---

## 10. Reproducibility Checklist

- [ ] Node.js 18+ installed
- [ ] Repository cloned and dependencies installed
- [ ] Supabase project created
- [ ] All 8 migrations applied
- [ ] GitHub OAuth app created and configured in Supabase
- [ ] At least one AI provider API key configured
- [ ] `.env.local` created with all required variables
- [ ] Development server running on port 3000
- [ ] Test repository with intentional bug created
- [ ] GitHub issue created describing the bug
- [ ] Successfully signed in with GitHub
- [ ] Repository selected and issue chosen
- [ ] All analysis stages completed
- [ ] Patch reviewed in the workspace
- [ ] Fix branch created on GitHub
- [ ] Pull request created and verified
