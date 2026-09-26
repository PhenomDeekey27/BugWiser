# think/state.md — Implementation State

## TASK — UI/UX Bug Fixes (Sept 25, 2026)

**Status:** ✅ FIXES APPLIED + VALIDATED

### 6. Responsive UI Fixes (Sept 25, 2026)

**Status:** ✅ FIXED

Goal: fix responsive layout issues across all pages, especially the models page where status labels were overlapping and content was cramped on mobile.

#### Models Page (`app/models/page.tsx`)
- **Root cause:** 12-column grid table didn't collapse on mobile; `bg-bw-surface` was not a valid Tailwind class causing invisible backgrounds/borders in light mode; modal was too wide (`max-w-lg`) on mobile; status badges overlapped
- **Fixes:**
  - Table cells: reduced padding (`p-3 lg:p-4`), smaller gaps (`gap-2 lg:gap-4`), smaller text sizes (`text-[10px] lg:text-xs`), proper `whitespace-nowrap` on status badges to prevent overlap
  - Added `min-w-0` on truncating cells to allow proper text overflow
  - Added `shrink-0` on icons and badges to prevent them from squishing
  - Modal: changed `max-w-lg` to `max-w-[90vw] lg:max-w-lg` with responsive padding (`p-2 sm:p-4` and `p-4 sm:p-6`)
  - Container: changed `p-6 lg:p-8 max-w-4xl mx-auto` to `p-4 lg:p-8 max-w-4xl mx-auto w-full`
  - Section headers: `flex flex-col sm:flex-row sm:items-center justify-between` for responsive alignment
  - Card component: `p-4 sm:p-5` instead of `p-5`
  - Badge font sizes: `text-[10px] lg:text-xs` to prevent overflow
  - Button height: `h-7 lg:h-8` to fit mobile
  - `bg-bw-surface` → `bg-surface`, `border-bw-surface` → `border-border`, `bg-bw-surface/50` → `bg-surface`, `bg-bw-surface/80` → `bg-surface-dim` throughout

#### StageConfigPanel (`components/models/StageConfigPanel.tsx`)
- Grid: `grid grid-cols-1 md:grid-cols-3` → `grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3` for better tablet layout
- Padding: `p-5` → `p-4 sm:p-5`
- Heading: `text-2xl` → `text-xl lg:text-2xl`
- `bg-bw-surface/50` → `bg-surface`, `border-bw-surface` → `border-border`
- `hover:border-bw-surface-bright/60` → `hover:border-outline hover:bg-surface-dim`

#### Hero (`components/landing/Hero.tsx`)
- `hover:bg-bw-surface/60` → `hover:bg-surface-dim` (fixes invisible hover state in light mode)

#### ProductPreview (`components/landing/ProductPreview.tsx`)
- All `bg-bw-surface/*` → `bg-surface/*` for proper light mode visibility
- `bg-bw-surface/40` → `bg-surface/70`, `bg-bw-surface/50` → `bg-surface/80`, `bg-bw-surface/30` → `bg-surface/60`, `bg-bw-surface/60` → `bg-surface`, `bg-bw-surface/20` → `bg-surface/50`, `bg-bw-surface/10` → `bg-surface/30`
- Sidebar padding: `p-5` → `p-4 lg:p-5`
- Responsive window header and progress items

#### FeatureSteps (`components/landing/FeatureSteps.tsx`)
- `glass-card p-10 md:p-14` → `glass-card p-6 md:p-10`
- Heading: `text-[2rem]` → `text-xl md:text-[2.5rem]`
- Grid gaps: `gap-6` → `gap-4 md:gap-6`
- Step icons: `w-16 h-16 mb-5` → `w-12 h-12 md:w-16 md:h-16 mb-4 md:mb-5`
- Step text: `text-base` → `text-sm md:text-base`, `text-sm` → `text-xs md:text-sm`
- `bg-bw-surface` references replaced with `bg-surface`

#### HomepageHeader (`components/landing/HomepageHeader.tsx`)
- `bg-bw-surface/60` → `bg-surface/70`
- `bg-bw-surface` → `bg-surface` (dropdown)
- Hardcoded `style={{ background: '#F0EBE6' }}` → `bg-surface-dim` class

#### ProviderCard (`components/models/ProviderCard.tsx`)
- `p-5` → `p-4 sm:p-5`
- Removed hardcoded `bg-slate-300 text-black` on disconnect button

#### AppShell (`components/layout/AppShell.tsx`)
- `bg-bw-surface` → `bg-surface` (sidebar toggle button)

#### Sidebar (`components/layout/Sidebar.tsx`)
- `bg-bw-surface` → `bg-surface`

#### TopBar (`components/layout/TopBar.tsx`)
- `bg-bw-surface` → `bg-surface` (header background and dropdown)

#### Analysis/New Page (`app/analysis/new/page.tsx`)
- `bg-bw-surface` → `bg-surface` on modal, empty states, and preflight overlay

#### DotField (removed)
- Removed `components/DotField.tsx` usage from `app/page.tsx`, eliminating cursor-following background effect

#### Root Cause for `bg-bw-surface` Issues
`bg-bw-surface` was NOT a valid Tailwind class — it was not generated from `@theme inline` in `globals.css`. The `--color-bw-surface` variable doesn't exist in the `@theme` block; only `--color-surface` is defined. This meant all `bg-bw-surface` classes rendered as invisible/transparent backgrounds, causing the light mode visibility failures. All references were replaced with `bg-surface` (which uses `var(--bw-surface)` = `#FFFFFF` in light mode, `#111416` in dark mode).

#### Validation
- `npx tsc --noEmit`: 0 errors ✓
- `npm run build`: Compiled successfully ✓
- `npm run lint`: No new errors ✓
- Responsive: Mobile layout properly stacks content, status labels no longer overlap

Goal: fix 5 UI/UX bugs without changing model selection algorithms, provider logic, pricing, catalog, or authentication architecture.

### 1. Cursor/Background Fix (Bugs 1 & 2)
- **Root cause:** `components/DotField.tsx` rendered a full-canvas animation with `requestAnimationFrame`, `mousemove` listener, and `setInterval(20ms)` for mouse-speed tracking. This ran continuously on the home page, causing visual noise and scrolling lag.
- **Files changed:** `app/page.tsx`
- **What was removed:** `<DotField />` component and its import from `app/page.tsx`. The `landing-radial-fade` div remains for subtle gradient depth.
- **Performance impact:** Eliminated continuous canvas rendering loop, mousemove handler, and setInterval. Scrolling now uses native browser behavior.

### 2. Scrolling Performance
- **Root cause:** The `DotField` component's `requestAnimationFrame` loop, `mousemove` listener, and `setInterval` for mouse-speed calculation were the primary sources of layout thrashing and scroll lag.
- **Optimization:** Removing the DotField component eliminated all per-frame/per-mousemove work. No CSS `scroll-behavior: smooth` was added (would mask the real issue).
- **Result:** Native, smooth scrolling with no continuous CPU/rendering activity from the removed effect.

### 3. Button Interaction (Bug 3)
- **Shared component changed:** `components/ui/button.tsx`
- **Changes:**
  - Added `cursor-pointer` to base `buttonVariants` class
  - Added `disabled:cursor-not-allowed` for disabled state
  - Added `hover:shadow-md` to `default` variant
  - Added `hover:border-outline` + `hover:shadow-sm` to `outline` variant
  - Added `hover:shadow-sm` to `secondary` variant
  - Added `hover:shadow-sm` to `destructive` variant
  - Added `cursor-pointer` to `link` variant (explicit, though base already has it)
- **CSS changes:** `app/globals.css` — `.btn-bw-primary` and `.dark .btn-bw-primary` now have `cursor: pointer` and `.btn-bw-primary:disabled` / `.dark .btn-bw-primary:disabled` have `cursor: not-allowed` + `opacity: 0.5`.
- **Light/dark behavior:** All hover states use existing theme tokens via `hover:bg-muted`, `hover:shadow-md`, etc. No new colors introduced.

### 4. GitHub Session Expiration Redirect (Bug 4)
- **Root cause:** `components/landing/SessionExpiryCheck.tsx` called `router.refresh()` immediately after detecting an expired session, causing a redirect loop/delay. It also called `signOut()` and `router.push('/auth/github')` automatically, creating race conditions.
- **Fix:** Removed `router.refresh()`, removed automatic `signOut()`, and `localStorage.removeItem()`. Now only shows a toast with a "Sign in" action button. The toast's `onClick` handler calls `signOut()` + `localStorage.removeItem()` + `router.replace('/auth/github')`. Duration increased from 6000ms to 8000ms.
- **Redirect destination:** `/auth/github`
- **Unrelated errors:** Normal API failures do NOT trigger redirects — only `!session?.provider_token` (missing GitHub token) triggers the toast. The middleware (`proxy.ts`) still handles protected route redirects separately.
- **No redirect loops:** `router.replace` avoids adding to history; no automatic refresh prevents re-triggering the check.

### 5. Model Configure Visibility in Light Mode (Bug 5)
- **Root cause:** The `StageChangeModal` and model configuration table in `app/models/page.tsx` used `bg-bw-surface` and `border-bw-surface` which are both `#FFFFFF` in light mode, making borders invisible. Hover states like `bg-bw-surface/50` and `bg-bw-surface/80` blended with the page background.
- **Files changed:** `app/models/page.tsx`, `app/globals.css`
- **Changes:**
  - Modal container: `bg-bw-surface border border-bw-surface` → `bg-surface border border-border` + `shadow-lg`
  - Modal close button hover: `hover:bg-bw-surface/80` → `hover:bg-surface-dim`
  - Search input: `border-bw-surface bg-bw-surface/50` → `border-border bg-surface`
  - Model list items (Recommended/Free/Paid): `border-bw-surface bg-bw-surface/50 hover:bg-bw-surface/80` → `border-border bg-surface hover:bg-surface-dim`
  - Status badge: `bg-bw-surface/50` → `bg-surface`
  - Table rows: `hover:bg-bw-surface/80` → `hover:bg-surface-dim`
  - Table dividers: `divide-bw-surface` → `divide-border`
  - Table container: `bg-bw-surface/50 border border-bw-surface` → `bg-surface border border-border`
  - Table Configure button: `border-bw-surface bg-bw-surface/50 hover:bg-bw-surface/80` → `border-border bg-surface hover:bg-surface-dim`
  - Tip section: `bg-bw-surface/30 border border-bw-surface` → `bg-surface/50 border border-border`
  - `Card` component: `border-bw-surface bg-bw-surface/50` → `border-border bg-surface`
  - Modal bottom border: `border-bw-surface` → `border-outline-variant`
  - Added `shadow-lg` to modal for proper elevation separation
- **Light mode result:** All modal borders, hover states, and backgrounds now properly separate from the page background. Model names, provider names, descriptions, and actions are fully readable.
- **Dark mode preserved:** Existing dark-mode CSS in `globals.css` continues to work correctly.

### Additional Bulk Fix (Sept 25, 2026)

**Issue:** `bg-bw-surface` was NOT a valid Tailwind class — it was not generated from `@theme inline` in `globals.css`. The `--color-bw-surface` variable doesn't exist in the `@theme` block. This meant all `bg-bw-surface` classes rendered as invisible/transparent backgrounds, causing light mode visibility failures across the entire application.

**Fixes:**
- Bulk replaced all `bg-bw-surface` → `bg-surface` and `border-bw-surface` → `border-border` across all analysis components (`AnalysisOverview`, `ApplyFixModal`, `ApplyFixSuccess`, `EvidencePanel`, `IssueSelector`, `ModelTierBadge`, `PatchViewer`, `ProgressOverlay`, `RelevantFilesPanel`, `RepositoryFileTree`, `RepositorySelector`, `RootCausePanel`, `SolutionPanel`)
- Fixed `app/analysis/[id]/page.tsx` remaining `bg-bw-surface` reference
- Removed dead CSS rules from `app/globals.css`: `.dark header.bg-bw-surface/60`, `header .absolute.bg-bw-surface`, `.dark .bg-bw-surface`
- Fixed `TopBar.tsx`, `Sidebar.tsx`, `AppShell.tsx` remaining `bg-bw-surface` references
- Fixed `HomepageHeader.tsx` `bg-bw-surface/60` → `bg-surface/70`, `bg-bw-surface` → `bg-surface`, and hardcoded `#F0EBE6` inline style → `bg-surface-dim`
- Fixed `DotField.tsx` — removed unused component

**Root cause summary:** `bg-bw-surface` was never a valid Tailwind class name. The `@theme inline` block defines `--color-surface` (not `--color-bw-surface`). The `--bw-surface` CSS variable exists but is only used by the custom `.bg-surface` utility class in `@layer utilities`. All `bg-bw-surface` references were replaced with `bg-surface`.

### Validation
- `npx tsc --noEmit`: **0 errors** ✓
- `npm run build`: **✓ Compiled successfully** (18 routes) ✓
- `npm run lint`: Pre-existing errors only; no new lint errors introduced ✓
- Zero `bg-bw-surface` or `border-bw-surface` references remain in any code file ✓

### Round 2 Fixes (Sept 25, 2026) — Dark Mode, Responsiveness, Session

**Issue A: #87898a gray backgrounds in dark mode**
- **Root cause:** `@theme inline` inlined literal light values (e.g. `--color-surface: #FFFFFF`) into utilities. `bg-surface/50` generated `color-mix(in oklab, #FFFFFF 50%, transparent)` — always white-translucent regardless of theme. Over dark `#0B0D0F` background this rendered ≈ `#87898a`.
- **Fix:** Changed all surface + brand color definitions in `@theme inline` from literal hex values to dynamic `var(--bw-*)` references (e.g. `--color-surface: var(--bw-surface)`). Since `--bw-surface` is overridden in `.dark`, opacity modifiers like `bg-surface/50` now resolve correctly per theme. Also fixed `--color-bw-*`, `--color-on-surface*`, `--color-outline*`, `--color-primary-*`, `--color-secondary-*`, `--color-tertiary*`, `--color-error-*`.
- **Affects:** `bg-surface/30|50|60|70|80`, `text-bw-peach/50|60|70|80`, and all other opacity-modified theme colors across the app.

**Issue B: Tip section awful colors in dark mode**
- Changed `bg-surface/50 border border-border` → `bg-primary-container/5 border border-primary-container/20` (subtle warm brand-tinted callout that works in both themes).

**Issue C: Mobile dropdown behind hero text + dark mode dropdown looks bad**
- Header z-index: `z-20` → `z-50` (dropdown now stacks above hero content on mobile).
- Dropdown background: `bg-bw-surface border border-border` (invalid class = transparent) → `glass-strong` (proper glassmorphism: `rgba(255,255,255,0.85)` + blur in light, `rgba(33,30,26,0.78)` + blur in dark).

**Issue D: Session expired but profile pic still shows in header**
- `SessionExpiryCheck` now calls `supabase.auth.signOut()` + `router.refresh()` immediately on detecting expired GitHub session. This clears the Supabase session so the server-rendered header re-renders with the "Continue with GitHub" button instead of the avatar. Toast with "Sign in" action preserved.

**Issue E: Choose Your Model Strategy modal not responsive on mobile**
- Modal wrapper: added `p-4` outer padding, `max-h-[90vh] overflow-y-auto` inner scroll, responsive padding `p-4 sm:p-6`.
- Strategy cards: added `min-w-0` + `shrink-0` + `truncate` on provider/model spans so long model IDs truncate instead of overflowing. Reason text gets `break-words`.
- Footer buttons: `flex gap-3 justify-end` → `flex flex-col-reverse sm:flex-row gap-3 sm:justify-end` (stack on mobile, inline on desktop).

**Issue F: "No free model" badge overlaps other columns**
- **Root cause:** Grid columns totaled 14 in a `grid-cols-12` grid (4+4+3+1+2), causing Status and Action cells to overflow into implicit rows/overlap.
- **Fix:** Rebalanced to exactly 12: Stage(3) + Model(3) + Provider(2) + Status(2) + Action(2). Status now has adequate width for "No free model" badge. Added `min-w-0` to status cell.

### Validation (Round 2)
- `npx next build`: ✓ Compiled successfully
- `npx eslint`: Pre-existing errors only; no new errors ✓
- Zero `bg-bw-surface` references remain ✓

### Round 3 Fixes (Sept 26, 2026) — Duplicate React Keys

**Issue:** Console warnings: "Encountered two children with the same key, `gpt-5.4`" — 30+ duplicate-key warnings from model lists and other data-driven arrays.

**Root cause:** Same `modelId` appears from multiple providers (e.g. `gpt-5.4` from both provider A and provider B), so `key={model.modelId}` collided. Similarly, string arrays (labels, languages, tags, capabilities, file paths) could contain duplicate values from API data.

**Fixes applied (19 key sites across 11 files):**
1. `app/models/page.tsx` (6 sites): `key={model.modelId}` → `key={`${model.providerId}/${model.modelId}`}` — composite provider+model key, the main gpt-5.4 fix
2. `components/analysis/ModelTierBadge.tsx`: `key={model}` → `key={`${idx}-${model}`}`
3. `components/models/ModelCard.tsx` (2 sites): tags + capabilities → `${tagIdx}-${tag}`, `${capIdx}-${c}`
4. `components/analysis/AnalysisOverview.tsx` (3 sites): labels, languages, sourceDirectories → indexed composite keys
5. `components/analysis/IssueSelector.tsx`: labels → `${labelIdx}-${label}`
6. `components/analysis/RootCausePanel.tsx`: affectedFiles → `${fileIdx}-${file}`
7. `components/analysis/ApplyFixSuccess.tsx`: filesChanged → `${fIdx}-${f}`
8. `components/analysis/ApplyFixModal.tsx`: patch files → `${fIdx}-${f.path}`
9. `components/analysis/PatchViewer.tsx`: patch files → `${fileIdx}-${file.path}`
10. `components/analysis/RelevantFilesPanel.tsx`: files → `${fileIdx}-${file.path}`
11. `components/analysis/AnalysisStepper.tsx`: stages → `${index}-${stage.stage}`

**Keys verified safe (no fix needed):** `stage.id`, `providerId`, `issue.id`, `repo.id`, `analysis.id`, `strategy.tier`, `setup.id`, `stat.label`, `item.href`, `step.title`, `permission`, `tab`, STAGE_ORDER values, tree `node.path`/`child.path` (structurally unique in tree), `dot.x-dot.y` coordinates.

**Validation:** `npx next build` ✓; `npx eslint` on changed files: 0 errors ✓

### Diff Safety Confirmation
- ✅ **Model selection unchanged:** Free/Balanced/Quality formulas, `stageSelection.ts`, `cost.ts`, `stageTokenProfiles.ts` untouched
- ✅ **Provider logic unchanged:** `live.ts`, `normalizers.ts`, `model-intelligence/index.ts` untouched
- ✅ **Pricing unchanged:** `cost.ts` pricing logic untouched
- ✅ **Catalog unchanged:** `stageSelection.ts` catalog logic untouched
- ✅ **No new colors introduced:** All changes use existing theme tokens (`bg-surface`, `border-border`, `bg-surface-dim`, etc.)
- ✅ **No new packages introduced**
- ✅ **No authentication architecture rewrite:** `SessionExpiryCheck` uses same Supabase auth flow; `proxy.ts` middleware unchanged
- ✅ **No unnecessary UI redesign:** Existing visual identity preserved; only interaction feedback and visibility improved

---

## TASK 4 — Catalog persistence/refresh failure fix + live-model metadata audit (+ connect/disconnect fix)

**Status:** ✅ INVESTIGATION COMPLETE, FIXES APPLIED (September 25, 2026)

Goal: fix the 20s `/api/models` + `price_fetched_at` schema-cache errors, fix broken connect/disconnect, and audit where live-model capability scores come from (why Free ≡ Balanced). Selection algorithms deliberately NOT redesigned.

### Answers to the ten report questions

1. **Why `/api/models` took ~20s.** Three stacked causes: (a) a failed/partial `storeCatalog` left `loadCatalog()` empty → every request ran a FULL synchronous rebuild (Task 1's design intentionally rebuilds synchronously when no rows exist); (b) provider fetches in `fetchLiveModels` ran sequentially (OpenRouter's multi-MB 460-model catalog dominates); (c) `aiClassify` sent a **~496-model listing** (~20-25K tokens of prompt) through the chosen "free" model — the classified model was itself `openrouter/stealth/space-bunny-alpha`, a stealth/paid model, and the call could take many seconds before returning truncated JSON. Additionally the DB's `updated_at` trigger on `model_catalog` fires per-row. (a) was the loop; (b)+(c) made each iteration slow.

2. **Why `price_fetched_at` was missing from the schema cache.** The PostgREST schema cache hadn't picked up migration 014 yet (the classic PostgREST cache invalidation problem — Next.js dev server holds a long-lived service-role client). **VERIFIED LIVE: the migration IS applied now** — `GET /rest/v1/model_catalog?select=price_source,price_fetched_at` returned 200 with populated values (`price_source='live'`, `price_fetched_at='2026-09-25T07:38:33.575+00:00'`), and a successful store ran at 07:39 UTC today. No new migration needed; any lingering cache error clears on PostgREST reload (Supabase Dashboard → Settings → API → "Reload schema cache" / `NOTIFY pgrst, 'reload schema';`) or simply restarts with the dev server.

3. **Is migration 014 applied?** YES — see (2). Also confirmed via columns' presence in both `model_catalog` and `model_catalog_meta` responses.

4. **Are repeated provider rebuilds occurring?** YES, until 07:39 UTC today. Hard DB evidence: `model_catalog_meta.model_count = 496` while `model_catalog` holds only **396 rows** (openrouter 362 + gemini 34) — the persisted fingerprint (gemini:openrouter) matches the meta fingerprint, so this was NOT interleaved-rebuild contamination but the **old delete-then-insert store dying mid-flight** (meta upserted first, DELETE succeeded, INSERT batches failed/partial) — exactly the corruption that made `loadCatalog()` return stale-but-present rows with a mismatched count and, in the empty case, forced full rebuilds every request. NOTE: the user's runtime log predates the successful 07:39 store; the '20.6s' log line and repeated 'Store error: price_fetched_at' messages were from before migration 014 became visible to PostgREST.

5. **Where live-model capability scores come from.** Chain: provider API → `historyEntryToModel` (live.ts) assigns `scores = staticEntry?.scores ?? {3,3,3,3}` (0–5 default) → `discoverModels` merges → **`aiClassify` OR `deterministicRank`** produces the 0–100 `codingScore/reasoningScore/speedScore/longContextScore/valueScore` → persisted → served via `/api/models` `scores` → `stageScore()` in stageSelection. `supportsCoding/reasoning/toolCalling` booleans are also mostly defaults: live OpenRouter entries get `capabilities = staticModel?.capabilities ?? ['coding','tool_calling','structured_output']`.

6. **Do live models receive generic default scores?** YES — PROVEN WITH LIVE DB DATA. The DB shows `classified_by_ai=true`, but EVERY free OpenRouter model stores the IDENTICAL tuple `coding=70, reasoning=50, speed=70, longContext=70, value=70, overall=65` (nex-n2.5-pro, ling-3.0-flash-sante, ling-3.0-flash-fin, qwen3.8-27b, dots-3-note-preview... all byte-identical). That tuple is exactly `deterministicRank()`'s output for `supportsCoding=true (from default caps), supportsReasoning=false, ctx=262144` — i.e. the AI classification **failed/truncated and the code zip-filled the gap with `?? 50` constants** (`aiClassify`'s old `scores[i] || {}` path), then stamped `classified_by_ai=true` anyway. Paid models fare little better: `70/50/65-70/70/78|70/65` — three near-identical buckets. Root cause: with 496 models and `max_tokens=4096`, the classifier CANNOT return complete output (needs ~25K output tokens); truncation was guaranteed on every rebuild. The separate `{coding:3,reasoning:3,speed:3,longContext:3}` default in `historyEntryToModel` applies to `registryScores` only and never reached selection in this catalog (0 registry-matched live entries) — the DOMINANT generic-score source was the zip-fill + doomed-classification combo.

7. **Why Free and Balanced select the same model.** Free picks `freePool[0]` = highest stage-score free model. Balanced computes `quality − log10(1+cost×100)×12` where free cost = 0 → penalty 0 → Balanced = highest stage-score free model too. With (6) giving every free model the SAME stage score, `freePool[0]` is whichever constant-scored model sorts first, and Balanced deterministically picks the same one. The algorithm is CORRECT — it faithfully processed garbage-typed metadata. Fixing (6) restores score differentiation; ranking logic itself stays untouched per task constraints.

8. **Are connected-provider models actually entering the pipeline?** YES. Verified end-to-end: discoverModels → STATIC+live merge (live overrides, keeps registryScores) → storeCatalog → loadCatalog → `/api/models` → client `libraryBaseModels` → `selectStageModels` (family grouping → STAGE_CONTEXT_MIN gate → provider top-5 cap → per-policy pick) → PUT preference → runtime `resolveAnalysisRouting` reads `stage_overrides`. Context windows are real (OpenRouter live values; 262144/512000 observed in DB). The pipeline is sound; its INPUT metadata was the problem.

9. **Exact files changed (this task):** `lib/ai/model-intelligence/index.ts` (storeCatalog rewrite, aiClassify outcome + guard, truthful classifiedByAi), `lib/ai/catalog/live.ts` (parallel provider fetches), `app/api/models/connections/[provider]/route.ts` (env-provider disconnect 409), `app/models/page.tsx` (disconnect error toast). Migration 014 file unchanged and verified applied.

10. **Follow-up selection task needed:** YES — see "Next task" below.

### Connect/disconnect failure (user-reported "not working") — root causes found
- **Disconnect of an env-configured provider (gemini here, via GEMINI_API_KEY in .env.local) was a silent no-op**: `getProviderConnections` ORs env-configured providers into `connected=true` regardless of DB rows; `removeUserConnection` deletes from `provider_connections` where no row exists (0 rows deleted); the UI then re-renders the provider as still-connected. No error was ever surfaced.
  - **Fix:** the DELETE route now returns **409 with an explanatory message** for env-configured providers (`configured via server environment…cannot be disconnected from the UI`), and the client toast now surfaces the response's error body. `provider_connections` currently contains exactly one row (openrouter, connected since 2026-09-03) — only openrouter/opencode-style user connections are disconnectable, which matches the new behavior.
- **Connect itself was not broken server-side** (validate → save → deduped rebuild once), but its result was invisible whenever the store loop corrupted the catalog (issue 1) and the rebuild raced the page GET — the connect route fired a background rebuild while the client's immediate `refresh()` raced it; fingerprint matching now converges on the next request, and single-flight dedupe keeps one build. The user-visible symptom "connect does nothing for a while" was the 20s rebuild + corrupted store, not the connect logic.
- Note: `provider_connections` has no RLS INSERT/UPDATE policy for users (only SELECT) — all writes correctly go through service-role background client. Not a bug; documented.

### What was changed (code)

**1. `lib/ai/model-intelligence/index.ts` — storeCatalog made failure-tolerant (Issue 1 core fix)**
- Old: meta upsert → `DELETE FROM model_catalog WHERE user_id` → INSERT batches (errors only logged) → catalog empty on any failure, freshness clock already advanced.
- New: chunked **UPSERT** on `(user_id, provider, model_id)` (idempotent, keeps previous catalog on batch failure, no empty window) → delete-by-`provider_fingerprint ≠ current` cleanup (removes disconnected-provider/vanished-model rows only after ≥1 batch stored; a failed rebuild can no longer destroy the previous catalog) → **meta written LAST** (freshness clock advances only after rows persist; a failed store leaves the old analyzedAt so the next request correctly retries staleness refresh). Counts in meta remain truthful (`classified_by_ai` semantics fixed, see 3).

**2. `aiClassify` — truncation guard + honest outcome reporting (Issue 2 root-cause fix)**
- `AI_CLASSIFY_MAX_MODELS = 80`: catalogs larger than what `max_tokens=4096` can possibly score skip the doomed call entirely (~25K-output-token requirement vs 4096 budget) → no more guaranteed-truncated responses (this ALSO removes ~5-15s from every large-catalog rebuild — part of the 20s fix).
- Result changed from bare array to `{ models, applied }`; short/unparseable outputs → `{ deterministicRank(models), applied: false }` — the zip-fill `?? 50` constant-tuple path can no longer fire.
- `getOrBuildCatalog` sets `classified_by_ai`/`classification_model` from `outcome.applied` — a failed classification is no longer stamped as AI-classified (DB previously claimed `classified_by_ai=true` while storing deterministic fallback tuples).
- Consequence: with the current 396+ model catalog, selection metadata now ALWAYS comes from `deterministicRank` — i.e. scores derived from real per-model metadata (price/context/capability booleans) rather than constants. Still coarse (see Next task), but truthful and differentiated by actual price/context/capability differences.

**3. `lib/ai/catalog/live.ts` — provider fetches parallelized**
- `fetchLiveModels` now `Promise.all`s all configured providers (was sequential). Biggest single-request win for rebuild latency; per-provider failure isolation unchanged.

**4. `app/api/models/connections/[provider]/route.ts` + `app/models/page.tsx`**
- Env-configured provider disconnect → HTTP 409 + message; client `handleDisconnect` reads the error body and toasts it instead of `Failed to disconnect` only. (`handleConnect` already surfaced server error bodies.)

### Verification
- `npx tsc --noEmit`: **0 errors**.
- Live DB probes (service-role, read-only SELECTs only): migration-014 columns present+populated; meta model_count 496 vs 396 rows (old interrupted-store evidence); openrouter=362/gemini=34/opencode=0 rows; single `provider_connections` row (openrouter); free-model identical-tuple evidence captured above.
- `git diff` reviewed; Tasks 1-3 hunks intact; this task only touched the four files listed in answer 9.
- Determinism preserved: no randomness, no provider-diversity logic, no escalation added. Free/Balanced/Quality formulas, STAGE_WEIGHTS, STAGE_CONTEXT_MIN, family grouping, provider caps: untouched.

### Behavior after fix
- Fresh persisted catalog → `/api/models` serves from `loadCatalog` with NO provider calls (TTL 1h, fingerprint-checked).
- Stale catalog → persisted data served immediately + deduped background rebuild (no competing builds).
- Connect/disconnect (user-key providers) → fingerprint mismatch → single synchronous rebuild on the next request, now with parallel fetches and (for large catalogs) no classification call.
- First build with ≥80 models: skips AI classify; 576-model rebuild should now be dominated by provider fetch latency (parallel) rather than fetch+classify+failed-store serial chains.
- Small catalogs (≤80 models, e.g. single-provider opencode/chutes setups) still get genuine AI classification with honest `classified_by_ai` flagging.

### Remaining issues (for later tasks)
- **Selection metadata quality is the real remaining gap → recorded as Next task below.**
- Rebuild dedupe is per-server-process (in-memory Map). Multi-instance deployments would each dedupe independently; acceptable at current scale, note for future.
- `model_catalog` `updated_at` per-row trigger adds write latency on 500+ row upserts; consider dropping the trigger or batching via RPC in a perf task.
- The old corrupted meta state (model_count 496 vs 396 rows) self-heals on the next successful store (upsert + fresh meta) — no manual data fix needed.
- env-configured providers cannot be disconnected by design; a "hide env provider" UI preference could be added later (product decision, out of scope).
- Pre-existing: dead modules (`lib/ai/model-catalog/*`, `lib/ai/orchestration/*`, preflight route, `components/analysis/ModelSelector.tsx`), stage_overrides reconciliation pass, engine (strategy-selection.ts) registry-only ranking.

### NEXT TASK (explicitly recorded per task instructions)

**Next task: Improve task-specific capability metadata/ranking for live connected models.**

The selection ALGORITHM is correct and stays as-is. What must improve is the METADATA fed to it and, if needed, metadata-aware scoring — NOT a rewrite of Free/Balanced/Quality formulas:
- Live provider models carry almost no reliable capability metadata: `supportsCoding=true, supportsReasoning=false, supportsToolCalling=true` are DEFAULTS from `historyEntryToModel`; `registryScores` default `{3,3,3,3}`; deterministic scores collapse into 3-4 buckets (free models all identical `70/50/70/70` → tie → arbitrary-but-stable pick). OpenRouter's `/models` payload DOES expose richer per-model fields (e.g. `supported_parameters` — `tools`, `reasoning`, `structured_outputs`; `architecture`; per-endpoint pricing) that are currently ignored — derive `supportsReasoning`/`supportsToolCalling`/`supportsStructuredOutput` from them first.
- Consider making `deterministicRank` more discriminative within same-price/ctx tiers (e.g. weigh OpenRouter `context_length` ordering, pricing tiers, real capability flags) so Free/Balanced tie-breaks reflect genuine differences instead of sort order.
- Optionally align OpenCode/Gemini/OpenAI live entries with real capability docs the same way.
- After metadata improves, verify Free vs Balanced picks diverge ONLY when the data supports it (same model legitimately winning both is allowed).

---

## Task: TASK 1 — Catalog freshness + pricing provenance

**Status:** ✅ COMPLETED

Goal: Make the model catalog reliable and fresh enough that provider connections, pricing, model metadata, and automatic model selection are not driven by arbitrarily stale Supabase catalog data. Free/Balanced/Quality selection logic intentionally NOT redesigned.

### Audit findings that drove the design
- Persisted catalog (Supabase `model_catalog` + `model_catalog_meta`, migration 011) was loaded by `loadCatalog()` with **no TTL and no fingerprint check** — any existing rows were treated as permanently authoritative.
- `refreshCatalogIfNeeded()` (fingerprint-aware) existed but had **zero callers**.
- `lib/ai/model-catalog/` (builder/cache with 5-min TTL/ranking) is a **parallel, unwired implementation** — nothing imports it except type-only imports. Left untouched (not deleted; out of scope).
- `POST /api/models/connect` and `DELETE /api/models/connections/[provider]` fired **independent fire-and-forget** `getOrBuildCatalog(user.id, true)` refreshes that could race each other and racing page GETs (duplicate provider fetches, interleaved `model_catalog` delete+insert).
- Pricing units were already normalized to USD per 1M tokens with a single conversion point (`toPerMillion` in `live.ts`) — correct, unchanged.
- Free-detection bugs: OpenRouter free test was a strict string compare (`pricing?.prompt === '0'`) so numeric `0` was misread as paid; Chutes hardcoded `isFree: false` even for explicitly zero-priced models.
- `fetchGemini` had **no modality filter** — non-text models (e.g. Lyria, Veo, Imagen) passed `supportedGenerationMethods: ['generateContent']` checks in some product surfaces and could enter the candidate pool.

### What was changed

**1. Catalog freshness (single mechanism, in `lib/ai/model-intelligence/index.ts`)**
- `CATALOG_TTL_MS = 1h` + `isCatalogStale(analyzedAt)`.
- `getOrBuildCatalog(userId)` (non-forced, the real serving path used by `/api/models`, `/api/ai/models`, preflight) now:
  - **Fingerprint mismatch** (provider set changed) → rebuilds **synchronously** (deduped) so the request following an explicit user action reflects it; falls back to the persisted catalog only if the rebuild fails or returns empty.
  - **Merely time-stale** → serves the persisted catalog immediately and triggers a **background** deduped rebuild (no provider API calls on routine fresh page loads).
  - No rows at all → builds synchronously (unchanged first-load behavior).
- New `rebuildCatalogOnce(userId)`: single-flight guard (per-user in-flight promise map) deduplicating concurrent force rebuilds. Connect/disconnect routes now call this instead of raw `getOrBuildCatalog(user.id, true)`, eliminating competing builds between the background refresh and racing page GETs.
- `refreshCatalogIfNeeded()` kept as the documented fingerprint+staleness entry point, now delegating to `rebuildCatalogOnce()` — one refresh mechanism, no second cache layer. Still uncalled by routes; the freshness logic lives in `getOrBuildCatalog` itself.

**2. Pricing provenance**
- Migration `supabase/migrations/014_model_catalog_price_provenance.sql`: `price_source TEXT CHECK IN ('live','registry','unknown') DEFAULT 'unknown'` + `price_fetched_at TIMESTAMPTZ` on both `model_catalog` and `model_catalog_meta` (`IF NOT EXISTS` — safe on existing DBs).
- `NormalizedModel` gained `priceSource` / `priceFetchedAt`; `ClassifiedModel` inherits.
- Discovery assigns provenance:
  - Static registry entries with defined prices → `'registry'` + build timestamp; null-priced registry entries (e.g. `zai/glm-4.7-flash`) → `'unknown'` + null (never reads as free).
  - Live entries whose provider payload carried an actual price (OpenRouter/Chutes/OpenCode) → `'live'`.
  - Live entries with no live price but a priced static fallback (OpenAI/Gemini/DeepSeek/Z.AI via `findStaticModel`) → `'registry'`.
  - Neither → `'unknown'` + null.
- `storeCatalog` persists both columns per row; `model_catalog_meta` gets the most authoritative catalog-wide confirmation (live > registry > unknown; freshest timestamp wins).
- `loadCatalog` defaults pre-migration rows to `'unknown'`/null and re-enriches `registryScores` from the **current** STATIC_MODEL_REGISTRY (no `registry_scores` DB column; keeps loaded live rows from being stuck with build-time default scores).
- API contract additions (additive): `/api/models` and `/api/ai/models` model payloads now include `priceSource` and `priceFetchedAt`; client `CatalogModel` interface (app/models/page.tsx) and the stageSelection `CatalogModel` structural type gained optional/informational `priceSource?`/`priceFetchedAt?`. No selection logic branches on provenance.

**3. Zero-price / free detection (`lib/ai/catalog/live.ts`)**
- New helpers: `toPriceNumber()` (string|number coercion; numeric `0` survives) and `isExplicitlyFree(input, output, known)` — free ⇔ pricing data exists AND both sides coerce to exactly `0`. NULL/missing/unknown is NEVER free. No price is ever fabricated.
- **OpenRouter**: prompt/completion coerced via `toPriceNumber` (handles `"0"` and numeric `0`); free requires the pricing object to actually carry `prompt`/`completion` fields; missing/null pricing → unknown (not free).
- **Chutes**: no longer blindly `isFree: false`; explicit zero pricing (both sides) → free; absent pricing stays unknown/paid with null prices.
- **OpenCode**: same shared helper (semantics preserved, numeric `0` now also handled).
- Null prices remain `null` end-to-end; UI continues to show "Pricing unavailable" for them.

**4. Gemini modality filter (`lib/ai/catalog/live.ts`)**
- `GEMINI_NON_TEXT_FAMILY` regex over model id + displayName blocks non-text generation families (`imagen`, `veo`, `lyria`, `chirp`, `tts`, `embedding`, `aqa`) — family-token matching with word boundaries (e.g. `imagine` is NOT matched). Applied in addition to the existing `generateContent` method check. Not a per-model blacklist; replace with a structured modality check if Google exposes one on models.list. Models like Lyria can no longer enter the text/code candidate pool.

**5. Registry consistency**
- Authoritative roles (documented in code comments, unchanged structure): STATIC_MODEL_REGISTRY (`lib/ai/catalog/registry.ts`) = pricing + static metadata; MODEL_REGISTRY (`lib/ai/model-registry.ts`) = runtime routing task weights; model-intelligence = live discovery/merge; Supabase = persisted serving cache.
- Fixed the direct contradiction: 4 Chutes entries in MODEL_REGISTRY (`Qwen3.5-397B-A17B-TEE`, `DeepSeek-V4-Flash-0731-TEE`, `Kimi-K2.6-TEE`, plus header note covering `Qwen3-32B-TEE`) flipped `free: true → false` — the pricing authority prices them 0.08–0.60 USD/1M, so runtime routing and catalog selection no longer disagree.
- Deliberate non-change: `zai/glm-4.7-flash*` entries remain `free: true` in MODEL_REGISTRY while STATIC prices are null/unknown — that is "free with unpriced static metadata", not a free-vs-paid contradiction. OpenRouter MODEL_REGISTRY entries have no STATIC counterpart, so no direct contradiction exists there either (live catalog supplies truth at runtime).
- `lib/ai/model-catalog/*` (builder/cache/ranking) remains dead-but-present code; not deleted (out of scope, "do not blindly delete registries").

### Untouched (per task constraints)
Free/Balanced/Quality selection algorithms, stage weights, context gates (`STAGE_CONTEXT_MIN`), family grouping (`modelFamilyKey`), provider candidate caps, manual model selector, runtime fallback behavior, stage override routing, database table structures (additive columns only).

### Validation
- `npx tsc --noEmit`: **0 errors** (baseline before changes was also 0 errors — clean).
- `git diff` reviewed hunk by hunk: changes limited to `lib/ai/model-intelligence/index.ts`, `lib/ai/catalog/live.ts`, `lib/ai/model-registry.ts`, `app/api/models/route.ts`, `app/api/ai/models/route.ts` (provenance fields only; rest of that diff is prior-task work), `app/models/page.tsx` (type only), connect/disconnect routes (rebuild call only), `lib/ai/catalog/stageSelection.ts` (optional type fields only; selection logic untouched — remaining diff is prior-task work). New file: `supabase/migrations/014_model_catalog_price_provenance.sql`.
- Note: the ripgrep binary for `code_search` was unavailable in this environment; verification used direct file reads + git diff instead.
- Behavior notes: catalog can now refresh on (a) fingerprint change — synchronous, (b) 1h staleness — background, (c) connect/disconnect — deduped background + next-load guarantee via (a). Pre-migration catalogs are served once with `unknown` provenance, then refreshed. Manual selection/stage overrides unaffected (they live in `user_preferences`, not the catalog).

### Remaining issues (for later tasks)
- Per-stage cost display still uses a single 12k/2k token profile with three duplicated formulas in `app/models/page.tsx`.
- Stage rows can still show stale models if a user's persisted `stage_overrides` reference models that no longer exist in a rebuilt catalog (pre-existing; needs a reconciliation pass).
- OpenRouter free-detection for models whose pricing fields are present-but-null is treated as unknown-paid (conservative; correct per spec).
- `lib/ai/model-catalog/*` dead module and `POST /api/model-intelligence/refresh` (now effective via dedupe but still UI-uncalled) could be wired or removed in a cleanup task.
- Chutes/OpenCode pricing units remain *assumed* USD-per-1M per provider docs — worth a one-time live verification.

---

## TASK 2 — Unified cost calculation + realistic per-stage token profiles

**Status:** ✅ COMPLETED (September 25, 2026)

Goal: one canonical cost formula, one canonical set of per-stage token profiles, all duplicated cost arithmetic removed. Model selection logic deliberately NOT touched; TASK 3 (Free/Balanced/Quality finalization) NOT implemented.

### Audit findings
- Task 1's note about ripgrep being unavailable was stale — `code_search` works again in this environment (used for the sweep below).
- Three duplicated cost formulas existed, all in `app/models/page.tsx`, all using a flat 12k/2k `STAGE_ESTIMATE_TOKENS` for every stage: (1) `getStageCostEstimate` (stage rows), (2) `estimateTotalCost` (total card, with `-1` sentinel for unknown), (3) `calculateTotalCost` (stage-change modal candidates). A fourth duplicated formatter (`formatCost`) encoded magic sentinels `0`/`-1`.
- Dead code found and removed rather than rewired: `getStageCost` (unused), and the modal's `selectedCost`/`localCost`/`initialPriceInput`/`localPriceInput` cost plumbing — `initialPriceInput` was never passed by any caller, so the plumbing could only ever display stale or null costs. Modal candidates now format cost directly at render time.
- Out-of-scope pricing math verified and deliberately untouched (selection scoring, not cost display): `lib/ai/catalog/scoring.ts` `costEfficiency` (dead module — only type-only imports from `model-catalog/types`), `lib/ai/model-intelligence/index.ts` `valueScore` (`inputPrice*2+outputPrice` heuristic), `lib/ai/catalog/stageSelection.ts` family-representative blended cost + `pickBalanced` `log10` cost penalty, `app/api/analysis/preflight/route.ts` (`inputPrice ?? 5` fallback), `lib/ai/model-catalog/ranking.ts` (dead module).
- `components/analysis/ModelSelector.tsx` is unwired (zero importers) and shows a wrong `/1K` price unit label — documented, NOT touched (dead-code cleanup is out of scope).
- Note: raw price display helpers (`formatPrice` ×3 in ModelCard/ModelComparison/SelectedModelSummary, `getCostLabel` in page.tsx) show per-1M prices, not cost estimates — left as-is per "don't unnecessarily redesign the UI".

### What was changed

**1. Canonical cost helper — `lib/ai/catalog/cost.ts` (NEW, single source of truth)**
- `estimateCostUsd(pricing, tokens)` — the ONLY estimated-cost arithmetic: `(inputPricePerMillion × inputTokens + outputPricePerMillion × outputTokens) / 1_000_000`. Consumes already-normalized USD-per-1M pricing; performs NO provider conversion (OpenRouter conversion stays in `live.ts` `toPerMillion`).
- `CostEstimate` discriminated union — `{ status: 'free', usd: 0 } | { status: 'priced', usd } | { status: 'unknown', usd: null }`. Unknown is EXPLICIT: null/undefined/NaN/Infinity/negative prices never collapse to 0; free requires `isFree` (Task 1's confirmed-zero semantics) and wins even when numeric fields are null.
- `formatCostUsd(estimate)` — preserves the historical formatting exactly (micro-costs 4 decimals so $0.012-class values never read as $0.00; <1 → 3 decimals; ≥1 → 2) plus `'Free'` / `'Pricing unavailable'` labels. Magic sentinels (`0`/`-1`) eliminated.
- `TOKENS_PER_MILLION` and `NormalizedPricing`/`TokenCounts` types exported here.

**2. Stage token profiles — `lib/ai/catalog/stageTokenProfiles.ts` (NEW, single source of truth)**
- `STAGE_TOKEN_PROFILES: Record<StageKey, StageTokenProfile>` over the five canonical stage IDs. Values (estimated workload, NOT context capacity — documented in-file):
  - `relevant_file_discovery`: input 12,000 / output 1,000 (historical baseline, slightly smaller output — compact file list)
  - `root_cause_analysis`: input 24,000 / output 2,000
  - `evidence_extraction`: input 64,000 / output 4,000 ← largest by far; its stage context REQUIREMENT is 200K (STAGE_CONTEXT_MIN) but the profile is an estimated workload well below that ceiling, deliberately not 200K
  - `solution_generation`: input 16,000 / output 3,000
  - `patch_generation`: input 20,000 / output 4,000
- Sanity check of the canonical example: ($0.60 × 12,000 + $2.40 × 2,000) / 1,000,000 = **$0.012** ✓ (not hardcoded; verified against the formula).

**3. Wiring — `app/models/page.tsx` (the only UI with cost estimates)**
- All three duplicated formulas replaced by one local adapter `stageCostEstimateUsd(model, stageId)` → `estimateCostUsd(pricing, STAGE_TOKEN_PROFILES[stageId])`, plus `getStageTokenProfile` fallback (unexpected stage id → discovery profile, never a crash).
- Stage table rows (`getStageCostEstimate`) now pass `stage.id`, so each row uses its own profile — evidence_extraction no longer shares the 12k/2k workload with other stages.
- Total cost card: `estimateTotalCost()` returns `CostEstimate` (sums per-stage priced estimates; free stages contribute 0; any unconfigured stage or unknown-priced stage → whole total `unknown` → "Pricing unavailable", never a misleading partial number).
- Stage-change modal candidates: per-stage estimate formatted at render time via the shared helper; dead `localCost`/`localPriceInput` plumbing and the unused `selectedStageCost`/`selectedStagePriceInput` page states removed; `onApply` signature narrowed (no more cost string round-tripping).
- UX precision fixes (small, deliberate): the `~` estimate marker now prefixes only calculated `$` values (never `~Free` / `~Pricing unavailable`); the Model Library card badge no longer labels unknown-pricing models as "Paid" — it shows a neutral "Pricing unavailable" badge reusing existing token classes. Free/Paid/unknown distinctions are never hidden.
- Unknown pricing behavior for the stage rows is unchanged from before Task 2 ("Pricing unavailable") but now flows from the typed union instead of ad-hoc null checks.

### Pricing semantics preserved (Task 1 intact)
- USD-per-1M normalization, `toPerMillion`, price provenance (`priceSource`/`priceFetchedAt`), live/registry/unknown classification, explicit-zero free detection, Gemini modality filter, catalog freshness — all untouched; `git diff` confirms the Task 1 hunks are intact and Task 2 only added `cost.ts`/`stageTokenProfiles.ts` plus the page.tsx changes above.
- The cost helper consumes the Task 1 output shape (`price.input`/`price.output`/`price.isFree`) without reinterpretation. Provenance is currently informational only in the cost path (no change requested).

### Untouched (per task constraints)
Free/Balanced/Quality selection algorithms, STAGE_WEIGHTS (evidence_extraction `coding:2, reasoning:2, speed:3, longContext:3` verified present exactly once — in `stageSelection.ts`; no duplicate weight definitions found), STAGE_CONTEXT_MIN, family grouping, provider caps, candidate ranking, manual model selector, runtime fallback, all API routes, ProviderCard/StageConfigPanel (no cost math), ModelCard/ModelComparison/SelectedModelSummary (per-1M price display, not estimates), dead modules `lib/ai/model-catalog/*` and `components/analysis/ModelSelector.tsx`.

### Validation
- `npx tsc --noEmit`: **0 errors** (run twice — after the main wiring and again after the two follow-up UX edits).
- `git diff` reviewed: Task 1 changes intact; no unrelated refactors.
- Duplicate-formula sweep (`code_search`): no estimated-cost arithmetic outside `cost.ts` remains. Remaining per-1M multiplications are selection-scoring heuristics (stageSelection, model-intelligence valueScore, dead model-catalog/ranking) — explicitly out of scope; document-only.
- All five stages consume `STAGE_TOKEN_PROFILES`; evidence_extraction input (64k) ≫ other stages (12–24k).
- Semantics: free → `Free`/`$0` (never computed), unknown → `Pricing unavailable` (never `$0`/`Free`, whole total goes unknown), paid → calculated via the canonical formula.

### Remaining issues (for later tasks)
- Token profiles are estimates, not measured usage — once the pipeline tracks real per-stage tokens, swap `STAGE_TOKEN_PROFILES` values (single place) or feed measured counts into `estimateCostUsd`.
- `estimateTotalCost` marks the whole total unknown if ANY stage is unconfigured/unknown-priced; a per-stage breakdown row could be nicer UX (out of scope).
- Selection-scoring cost heuristics (`?? 5` in preflight, `*2+output` blends) still diverge conceptually from real per-stage costs — fine for Task 3 to reconsider WITHOUT changing ranking behavior.
- Dead code candidates for a cleanup task: `lib/ai/model-catalog/*`, `lib/ai/catalog/scoring.ts`, `components/analysis/ModelSelector.tsx` (wrong `/1K` label if ever revived).

---

## TASK 3 — Final Free / Balanced / Quality automatic selection

**Status:** ✅ COMPLETED (September 25, 2026)

Goal: finalize deterministic automatic model selection. No runtime escalation, no randomness, no artificial provider diversity, no new packages. Manual selection untouched.

### Audit findings (real flow traced)
- **Live selection path:** /models UI → `selectStageModels()` (`lib/ai/catalog/stageSelection.ts`, catalog-based: family grouping → STAGE_CONTEXT_MIN gate → provider top-N → per-policy pick) → persists `selected_strategy` + concrete `stage_overrides` via `/api/models/preference` → Supabase `user_model_preferences` → runtime `gateway.generate()` → `resolveAnalysisRouting()` (auto mode reads `stage_overrides[task]`) → `runWithFallback` (override first, then strategy/auto chain) → model router. UI and runtime share ONE selection implementation. ✓
- **Engine path (`lib/ai/strategy-selection.ts` + `/api/ai/models`):** registry-based, used by `runWithFallback`'s strategy-chain fallback and the informational `/api/ai/models` endpoint. `resolveStrategyMode()` verified correct: manual → 'auto' (preserves manual overrides), free/free_paid/fully_paid/custom pass through, auto/balanced/quality/invalid → 'auto'.
- **Competing implementations exist but only two matter:** `lib/ai/model-catalog/strategies.ts` (dead — only type-imports of `model-catalog/types` anywhere), `app/api/analysis/preflight/route.ts` (own per-stage composite scorer, pre-setup-era display), `lib/ai/orchestration/*` (dead — zero importers). None deleted (per task constraints); documented for a future cleanup task.
- **Task 2 leftovers verified intact:** `STAGE_WEIGHTS` defined exactly once (evidence_extraction coding:2/reasoning:2/speed:3/longContext:3); `STAGE_CONTEXT_MIN` 32k/128k/200k/32k/32k applied before ranking; provider-scoped `modelFamilyKey` unchanged; `MAX_CANDIDATES_PER_PROVIDER = 5`.
- **DB constraint:** migration 013 already allows `selected_strategy IN ('auto','free','free_paid','fully_paid','custom','balanced','quality')`. The API route body type omitted balanced/quality (runtime JSON worked, contract didn't) — fixed.
- **Runtime note (no change needed):** gateway fetches `analyses.model_strategy` for the fallback chain; `/api/analyses` maps balanced/quality → 'custom'. The OVERRIDDEN stage model itself comes from `stage_overrides` via `resolveAnalysisRouting`, so runtime used the user's picks regardless; the chain is fallback-only.
- **Pre-existing uncommitted work in stageSelection.ts:** the working tree already contained the spec-conformant Free rework (free-first by stage score with price excluded from Free ranking; best confirmed-paid fallback; last-resort pool[0]) from prior work — verified against spec, kept as-is (behavior preserved, not re-implemented).

### What was changed

**1. `lib/ai/catalog/stageSelection.ts` — Balanced/Quality finalized on Task 2 costs**
- New shared consumer `stageEstimatedCostUsd(model, stageId)` → `estimateCostUsd(pricing, STAGE_TOKEN_PROFILES[stageId])` from `lib/ai/catalog/cost.ts`. NO cost arithmetic re-implemented. Returns null for unknown pricing (explicit handling; never zero).
- **Balanced** (`pickBalanced`): now scores stage-weighted quality (0–100) against the ACTUAL stage-specific estimated cost — evidence_extraction costs more than discovery for the same model, and the cost term reflects it. `quality − log10(1 + cost·100) × 12` (scale constants documented in-file; preserves the diminishing-penalty shape of the previous heuristic while switching its cost input from static blended per-1M price to stage-specific Task 2 estimates). Unknown pricing → `Infinity` penalty (worst tier, explicit, never silent zero). No longer silently skips unknown-priced candidates.
- **Quality** (`pickQuality`): capability-first, not price-blind. Best stage score → qualify candidates within `QUALITY_COMPARABLE_TOLERANCE = 5` points → prefer lowest stage-specific estimated cost among qualified → a materially stronger model (> 5 pts) still beats a cheaper comparable one. Free ($0) wins within tolerance; unknown pricing = worst cost tier (eligible only if all qualified are unknown). Deterministic: strict `<` keeps pool order (score → valueScore → stable ID) on cost ties. Explicitly NOT "highest price wins" / "largest model wins".
- **Free**: behavior verified unchanged/already spec-conformant (see audit). No randomness; same model may win all five stages (stages are independent).
- Selection operates on already-normalized USD-per-1M prices; no new conversion layer.

**2. `lib/ai/strategy-selection.ts` — engine honors persisted overrides in every mode**
- New `applyStageOverrides(assignments, stageOverrides)` applied by `free`, `free_paid`, and `fully_paid` modes (custom/auto already applied overrides). This fixes the one real Part-12 inconsistency: previously a saved Free setup (concrete picks in `stage_overrides`) made `/api/ai/models` report registry-derived picks while UI/runtime used the persisted picks. Now every mode reflects the user's configured assignments.
- `pickBestForTask` gained a deterministic tie-break (score → stable `provider/model` ID), so equal-scored models never depend on registry iteration order.
- Registry `free` flags (already reconciled to pricing truth in Task 1) remain the engine's free signal.

**3. `app/api/ai/models/route.ts` — truthful output**
- Comments updated (balanced/quality resolve to 'auto' for the engine, but their persisted stage_overrides are honored by every mode via applyStageOverrides).
- `selectedStrategy` now echoes the user's SAVED strategy (incl. balanced/quality) instead of the resolved internal engine mode.

**4. `app/api/models/preference/route.ts` + `app/models/page.tsx`**
- Route body type now imports/uses `SelectedStrategy` (includes balanced/quality — matches migration 013 constraint and what the UI actually sends).
- Client `Preference.selected_strategy` type extended to match.

### Behavior summary
- **Free:** normal automatic pool (family → context gate → provider cap) → genuinely free only (`isFree === true` = confirmed zero pricing) → best stage-weighted score (price NOT in Free ranking) → no suitable free: best confirmed-priced paid candidate → none: safest remaining eligible (pool[0], existing fallback semantics). Unknown pricing never free.
- **Balanced:** deterministic stage-specific price/performance on Task 2 costs (see above). Not cheapest, not best-score.
- **Quality:** capability-first with 5-point comparable-capability tolerance, then cheapest (see above).
- **Manual:** completely untouched (`selection_mode='manual'` → `manualModel` → all stages; recoverable-failure fallback preserved).
- **Persistence:** setups persist `selection_mode:'auto'` + `selected_strategy` + concrete `stage_overrides`; reload restores both setup badge and stage rows; manual per-stage changes still possible after any setup (StageChangeModal → overrides → Save Preference).
- **Runtime:** overrides reach `runWithFallback` per-stage; runtime error fallback chain unchanged; NO escalation.

### Validation
- `npx tsc --noEmit`: **0 errors** (multiple runs through the task).
- `git diff` reviewed hunk-by-hunk; Tasks 1–2 work intact; no unrelated refactors.
- Duplicate search: `STAGE_WEIGHTS` ×1; stage-score formulas ×3 (stageSelection = UI/runtime selection; strategy-selection = engine fallback chain; /api/ai/models fit display — each binds different model shapes; preflight/orchestration/model-catalog copies are dead). Balanced/Quality cost math exists ONLY in stageSelection via cost.ts.
- Four modes verified by code-trace: Free ✓, Balanced ✓, Quality ✓, Manual ✓.
- Context gates, weights, family grouping, provider caps, pricing semantics, Task 2 profiles: verified intact.
- Determinism: all tie-breaks stable (score → valueScore → provider/model ID); no randomness anywhere in the path.

### Remaining future work (explicitly NOT done)
- **Runtime quality escalation (cheap → stronger → premium on failed validation/result quality) — FUTURE WORK, not implemented.**
- Engine (`strategy-selection.ts`) still ranks from static MODEL_REGISTRY metadata and knows nothing of context gates or Task 2 costs; candidates for unification behind the catalog selection if the strategy-chain fallback ever needs parity.
- Dead modules for a cleanup task: `lib/ai/model-catalog/*`, `lib/ai/orchestration/*`, `app/api/analysis/preflight/route.ts`, `components/analysis/ModelSelector.tsx`.
- `stage_overrides` may reference models removed from a rebuilt catalog (pre-existing; needs reconciliation pass).
- Balanced scale constants (100/12) and Quality tolerance (5) are documented starting points — tune against real catalogs.

---

## Next task

None scheduled. TASK 3 completed. Runtime quality escalation remains explicitly future work.

---

## INVESTIGATION — Why Free/Balanced/Quality picked Nemotron + Qwen (OpenRouter-only, Sept 25, 2026)

**Status:** ✅ INVESTIGATION COMPLETE, NO SELECTION LOGIC CHANGED.

Question: with only OpenRouter connected, Free/Quality pick Nemotron 3 Super (discovery)
+ Nemotron 3 Ultra (other 4 stages), while Balanced picks Qwen3.5-122B-A10B (~$0.0052)
for discovery and Ultra elsewhere — all rows labelled "Custom Override". Verdict: the
selections are CORRECT outputs of the current algorithm on live data; the label does NOT
signal failure (see 7). Runtime evidence below from `scripts/debug-selection.ts` (live DB
+ live OpenRouter fetch, force rebuild) plus a throwaway ranking probe (deleted after use).

### 1. Live candidate counts (measured, not estimated)
- `getProviderConnections` DB truth: only `openrouter: true`; all others false.
- Force rebuild: static 0 + live 455 → catalog 455, all `openrouter`, `classifiedByAi=false`
  (catalog > 80 models → AI classify skipped by design, deterministic metadata scoring).
  A second load minutes later served 457 rows — OpenRouter live catalog volatility (±2),
  not a bug. Free models: 21. Distinct score tuples: 106 (was ~3-4 pre-fix).
- Automatic pool (family grouping → ctx gate → provider cap 5, single provider):
  457 avail → 425 families (32 near-duplicates dropped) → ctx pass per stage:
  discovery 410, root-cause 386, evidence 308, solution 410, patch 410 → capped to 5/stage.
- Capped top-5 (by stageScore) per stage:
  - discovery: qwen3.5-122b-a10b 88.75, qwen3.5-9b 85.88, nemotron-3-super:free 85.00, qwen3.5-397b 85.00, nemotron-3-nano-omni:free 82.13
  - root-cause: ultra:free 89.50, qwen3.5-122b 86.38, super:free 85.13, qwen3.5-397b 85.13, lightning:free 83.75
  - evidence: qwen3.5-122b 84.60, ultra:free 83.30, qwen3.5-9b 82.00, super:free 81.60, qwen3.5-397b 81.60
  - solution/patch: ultra:free 90.75, qwen3.5-122b 88.13, super:free 86.88, qwen3.5-397b 86.88, lightning:free 85.38
- Family check: `modelFamilyKey(super:free) == modelFamilyKey(super paid)` → true, so the
  paid Super variant is correctly absorbed (free rep wins on cost); it never contests picks.

### 2. Winner catalog records (live `priceSource='live'` throughout)
- `nvidia/nemotron-3-super-120b-a12b:free`: ctx 262144, in/out $0/$0, isFree true,
  scores c/r/s/lc = 100/86/73/75, caps [coding,reasoning,tool_calling,structured_output].
- `nvidia/nemotron-3-ultra-550b-a55b:free`: ctx 1000000, $0/$0, isFree true,
  scores 100/90/56/95, caps [coding,reasoning,tool_calling] (no structured_output flag).
- `qwen/qwen3.5-122b-a10b` (paid): ctx 262144, in $0.26/M out $2.08/M, isFree false,
  scores 100/86/83/75, caps [coding,reasoning,vision,tool_calling,structured_output].

### 3. Why Free picks Super once + Ultra ×4
Free = best stageScore among `isFree` in the capped pool. Discovery free ranking:
Super 85.00 > nano-omni 82.13 = qwen3.8-free 82.13 > Ultra 81.63 > lightning 74.25.
Super beats Ultra on discovery because weights {3,1,3,1} punish Ultra's speed 56
(550B MoE, 55B active → base 62 − 6 ctx penalty) vs Super's 73 (12B active → 74 − 1),
while Ultra's reasoning/longContext edge (90/95 vs 86/75) gets weight 1 each:
85.00 vs 81.63. All other stages weight reasoning/longContext ≥ discovery's, where
Ultra's 100/90/56/95 dominates (89.50/83.30/90.75/90.75 — top of free pool each time).
Genuine score win, not a tie-break: nearest free rival trails by 2.9–4.4 pts.

### 4. Why Balanced differs ONLY on discovery
Balanced = stageScore − log10(1+cost·100)·12 (free → penalty 0). Discovery:
Qwen122b 88.75 − 2.18 ($0.0052 = 0.26·12000+2.08·1000 /1M) = 86.57 > Super-free 85.00
> qwen3.5-9b 85.22 > others. The +3.75 quality lead exceeds the 2.18 cost penalty —
  justified by the formula. Every other stage the best paid model is ALSO worse on
  quality than free Ultra (root-cause: Qwen 86.38−3.72=82.66 vs 89.50; evidence:
  84.60−6.52=78.08 vs 83.30; solution: 88.13−3.72=84.41 vs 90.75; patch:
  88.13−5.46=83.67 vs 90.75), so free Ultra wins outright. Runner-up qwen3.5-9b on
  discovery (85.22, $0.0014) shows the trade-off is continuous, not hard-coded.

### 5. Why Quality == Free here (correct, not a bug)
Quality = cheapest stage cost among candidates within 5 pts of best stageScore.
Discovery best = Qwen 88.75, threshold 83.75 → qualified {Qwen122b $0.0052, qwen9b
$0.0014, super-paid $0.0014, super-free $0, qwen397b $0.0101} → cheapest = super-free $0.
Other stages: best = Ultra-free itself (89.50/83.30/90.75/90.75) → Ultra qualifies at $0
and nothing beats free. No paid model is >5 pts stronger than the free winner on ANY
stage (largest paid lead observed: +3.75 discovery Qwen over Super — inside tolerance),
so free winning all five Quality stages is the SPEC-CORRECT outcome.

### 6. Capability metadata provenance (current, post-fix)
`codingFamilySignal` (ID family tokens: nemotron/qwen3.5/etc.) + OpenRouter
`supported_parameters` (tools/tool_choice, reasoning/include_reasoning, response_format)
+ `architecture` input/output modalities → observed flags → deterministicRank
(contextToScore piecewise, active-param speed w/ ctx penalty, size refinements, registry
blend when a static entry exists — none exists for openrouter IDs, so pure live evidence).
106 distinct tuples; no constant-fill (aiClassify skipped >80 models, `applied:false`).

### 7. Persistence + "Custom Override" (traced, not assumed)
- `handleSetupSelect` runs live `selectStageModels` → sets ALL five rows `isOverride:true`
  → PUTs `{selection_mode:'auto', selected_strategy, stage_overrides}` → `saveModelPreference`.
  Live preference row confirms: `selected_strategy:'quality'` + 5 overrides = exactly the
  Quality picks. Reload path (`applyData` → `loadStageModels`) sets `isOverride = !!override`.
- "Custom Override" badge + "Custom" status render IFF `sm.isOverride` (page.tsx ~427-457) —
  i.e. ANY persisted `stage_overrides` entry, INCLUDING automatic-setup picks. It does NOT
  mean manual-only and does NOT mean the algorithm failed. Manual modal reuses the same flag
  via its own checkbox. Reconciliation (`overrideReconcile`, wired into both GET routes with
  self-healing persist) keeps overrides pointing at live catalog models; current overrides
  all resolve — no phantom/stale entries.
- UI values after each setup apply ARE fresh algorithm selections; after reload they are the
  persisted overrides (by design — same values, since overrides store the picks).

### 8. Task mapping verified independent
`selectStageModels` iterates `STAGE_WEIGHTS` entries passing per-stage weights
(discovery {3,1,3,1}, root-cause {2,3,1,2}, evidence {2,2,3,3}, solution/patch {3,2,1,2})
with per-stage `STAGE_CONTEXT_MIN` gates (32K/128K/200K/32K/32K) and shared cost profiles.
Page `STAGES` ids match `StageKey`s 1:1. Winners differ by stage (Super vs Ultra; Balanced
discovery diverges) — independent selection confirmed.

### 9. Root cause(s) — nothing to fix in selection
No defect found: Free/Balanced/Quality formulas, weights, gates, grouping, caps all behave
as specified on truthful metadata. The ONLY stale artifact is this file's old "Next task:
None scheduled" line predating the OpenRouter-only working-tree changes (observed flags,
modelSignals, scoring refinements, debug endpoint/scripts, overrideReconcile) — that prior
task's code is DONE in the working tree; its verification is what this entry completes.

### 10. Recommended next fix (NOT implemented)
Do NOT touch selection formulas. If Balanced-always-≈-Free feels wrong, the lever is
metadata depth (e.g. per-model reasoning/tool evidence is still boolean-coarse) or tuning
documented constants (BALANCED_COST_SCALE/MULTIPLIER, QUALITY tolerance 5) against real
catalogs — a product decision with before/after diagnostic tables, plus committing the
untracked debug/diagnostic files or removing them (`app/api/debug/`, `lib/ai/catalog/
debugSelection.ts`, `modelSignals.ts` is IMPORTED — keep; `scripts/` probes).

---

## AUDIT — Multi-provider participation: opencode connected, selections unchanged (Sept 25, 2026)

**Status:** ✅ AUDIT COMPLETE, NO PRODUCTION LOGIC CHANGED (temp probe deleted; `tsc` clean).

Question: second provider (opencode, DB row `connected` 10:48:23 UTC) added, yet all
Free/Balanced/Quality picks identical to OpenRouter-only. Verdict: CORRECT behavior —
opencode fully participates end-to-end and loses on the merits everywhere (15/15
multi-vs-OR-only cells SAME by fresh calculation, not by reading overrides).

### 1. Providers tested / connection state (DB truth)
- `provider_connections`: openrouter connected (09:22 UTC) + opencode connected (10:48 UTC),
  same user; all others disconnected. `getProviderConnections` → `{openrouter:true,
  opencode:true}` (DB-only by design; env keys don't connect).
- Resolvable keys: gemini (env), openrouter + opencode (DB-decrypted). Raw
  `fetchLiveModels`: openrouter 455 (21 free), gemini 36, opencode 80 — but
  `discoverModels` filters by connectedIds, so gemini's 36 are correctly EXCLUDED
  (disconnected-provider exclusion verified working).
- Serving catalog rebuilt at connect time (fingerprint `opencode:openrouter`,
  analyzedAt 10:48:24 UTC): 535 models = 455 openrouter + 80 opencode, `classifiedByAi=false`.
  Available ∩ connected: openrouter 455, opencode 80. Opencode free models: **0**.

### 2. Per-provider pipeline counts
- Normalization → discoverModels → available: openrouter 455, opencode 80 (no loss).
- Family grouping: 535 → 502 reps (33 dupes dropped); per-provider reps: openrouter 423, opencode 79.
- Context gates (reps passing): discovery 487 {OR 408, OC 79}; root-cause 463 {384, 79};
  evidence 308 {OR 308, OC **0**}; solution 487 {408, 79}; patch 487 {408, 79}.
- Provider cap (top-5/provider by stageScore): 10 candidates (5+5) in 4 stages; evidence 5 (OR only).

### 3. Opencode top models (discovery stageScore; all ctx=128000, prices null, isFree=false)
1. `mimo-v2.5-free` "Mimo v2.5 (free)" 93/82/50/65 ss 72.00 src=registry, cost unknown
2. `nemotron-3-ultra-free` 87/82/50/73 ss 70.75 src=registry, unknown
3. `big-pickle` 87/76/50/65 ss 69.00 src=registry, unknown
4. `nemotron-3.5-lightning-free` 80/38/50/57 ss 60.63 src=registry, unknown
5-10. `gpt-5.3-codex-spark`, `gpt-5.4/mini/nano/pro`, `gpt-5.5` … all 45/29/50/55 ss 46.13 src=unknown.
Best opencode (72.00) trails openrouter's 5th-place cap survivor (82.13) by ~10 pts on
discovery; gaps are similar-or-larger on all other stages (e.g. root-cause OC best 77.00
vs OR 5th 83.75; solution OC best 77.88 vs OR 5th 85.38).

### 4. Before-cap vs after-cap (per stage)
Before-cap top-8 are ALL openrouter on every stage (8th-place OR ≈ 77-82 vs OC best 70-78).
After-cap pools (10, or 5 for evidence): OR top-5 unchanged from OR-only audit; OC slots
6-10 (discovery: mimo 72.00, ultra-free 70.75, big-pickle 69.00, lightning 60.63,
claude-fable-5 46.13). Cap keeps 5/provider — it HELPS opencode (5 survive) and changes
nothing about the winners, who also lead pre-cap.

### 5. Picks: multi vs OR-only (fresh `selectForStage`, all 5 stages × free/balanced/quality)
All 15 SAME: discovery free Super-free 85.00 / balanced Qwen122b 86.57 ($0.0052) / quality
Super-free; root-cause/evidence/solution/patch Ultra-free (89.50/83.30/90.75/90.75) in all
three modes. Persisted overrides (quality picks, all OR, all still valid) agree with fresh
calculation — overrides are not masking anything.

### 6. Answers A–H
A. YES, opencode participates (80 live → 79 reps → gated → 5 capped survivors in 4/5 stages).
B. It loses on merits: ~10+ pt stageScore gaps + $0-cost rivals + unknown pricing.
C. Nowhere structural — its only hard filter-out is evidence ctx gate (128000 < 200000: all 79 reps).
D. NO — per-provider cap preserves opencode's 5; winners lead pre-cap too.
E. NO — family grouping drops 1 opencode dupe (80→79).
F. YES — all opencode prices null/unknown (src registry/unknown); consequence: ineligible for
   Free, −Inf balanced penalty, worst-tier Quality cost. Striking: IDs literally named
   `(free)` (`mimo-v2.5-free`, `nemotron-3-ultra-free`) carry NULL pricing → treated as paid.
G. PARTLY — capability scores exist (registry-backed for top 4, defaults 45/29/50/55 for the
   rest) but are materially lower: speed 50 (no size signal in IDs), longContext 55-73
   (flat 128K ctx), coding 45-93 vs OR's 95-100.
H. NO — fresh calculation matches persisted overrides exactly.

### 7. Recommended next task (NOT implemented)
Investigate opencode pricing payload: its `/models` response seemingly carries no usable
price fields (all null → unknown), and "(free)"-named models are unwinnable in every mode
(Free excludes them, Balanced −Inf, Quality worst-tier). If upstream exposes pricing
(per-endpoint fields or headers), map it in `fetchOpenCode` like OpenRouter; until then,
opencode can only ever win a stage if its stageScore beats OR's best by >tolerance AND the
mode tolerates unknown cost (never in Balanced). Also note: evidence's 200K gate structurally
locks out the entire opencode catalog (max 128K) — expected per current weights/gates, flag
only if product wants opencode viable for evidence. Do NOT touch selection formulas for any
of this.

---

## AUDIT — Provider metadata normalization (all 7 providers, live raw responses, Sept 25, 2026)

**Status:** ✅ AUDIT COMPLETE, NO PRODUCTION CODE CHANGED (3 throwaway capture scripts deleted; `tsc` clean).
**Scope lock:** no selection/scoring/weight/gate/cap changes. All provider rows `connected` at
audit time, so raw `/models` (or equivalent) captured LIVE for all 7 — no doc-based assumptions.
Live counts: openrouter 460, opencode 81, chutes 14, openai 126, gemini 50, deepseek 2, zai 11.

### 1. What each fetcher currently reads (live.ts) vs what the API actually returns
- **OpenRouter** (`fetchOpenRouter`): reads id/name/context_length/architecture/pricing.prompt|completion
  (per-token → ×1e6 ✓)/top_provider.max_completion_tokens/supported_parameters/reasoning-object/arch
  modalities. CORRECT and complete for selection; unused extras: `reasoning.{mandatory,default_enabled,
  supported_efforts}`, `per_request_limits`, `benchmarks.artificial_analysis`, `hugging_face_id`,
  `canonical_slug`, `created/knowledge_cutoff/expiration_date`. Zero = string "0" both sides
  (24 models; 0 numeric-zero; 0 null-priced; 0 negative — the −1 pseudo-models are gone).
- **OpenCode** (`fetchOpenCode`): reads id/name/context_length|context_window/max_output_tokens/pricing.prompt|completion.
  REALITY: entries carry ONLY `{id, object, created, owned_by}` — every read except id/name misses, so
  all 81 models get ctx 128000 default, null prices, default caps. 9 IDs match /free/i.
- **Chutes** (`fetchChutes`): reads `pricing.input`, `price.input.value`, `context_length`,
  `max_output_tokens`, observed=null. REALITY: `{pricing:{prompt,completion,input_cache_read},
  price:{input:{tao,usd},output:{tao,usd},input_cache_read}, context_length, max_model_len,
  max_output_length, input_modalities, output_modalities, supported_features:[json_mode,tools,
  structured_outputs,reasoning], quantization, chute_id, owned_by, ...}` — EVERY field the code reads
  is misnamed (pricing.prompt not .input; price.*.usd not .value; max_output_length not
  max_output_tokens). Units are USD per 1M native (0.12/0.37 scale matches registry) — the no-convert
  assumption is right, the field names are wrong → all chutes prices null. Capabilities/modalities ignored.
- **OpenAI** (`fetchOpenAI`): filters `owned_by==='openai'` + id regex, reads static-only for the rest.
  REALITY: 121/126 rows have `owned_by:'system'` (4 internal, 1 openai) → code filter passes **1/126**.
  Fields are `{id,object,created,owned_by,shutdown_date}` — no pricing/ctx/caps (static fallback correct in
  principle, but STATIC has zero openai rows → all defaults). `shutdown_date` (e.g. o1-2024-12-17 →
  2026-10-23) ignored; availability always 'available'.
- **Gemini** (`fetchGemini`): filters generateContent + family regex; reads inputTokenLimit (+static fallback).
  REALITY: `{name,version,displayName,description,inputTokenLimit,outputTokenLimit,
  supportedGenerationMethods,temperature,topP,topK,maxTemperature,thinking?}` — no pricing (static/unknown
  handling correct), no modality fields. `outputTokenLimit` IGNORED (stored null→8192 default; e.g. gemma
  32768 lost). `thinking:true` IGNORED (reasoning from static/default). Filter audit 50 models: 14 dropped
  (tts×5, lyria×3, embedding×3, aqa, veo×2 — both guards fire correctly, incl. end-of-string `-tts`),
  36 pass — but passers include `*-image` (6: 2.5-flash-image, 3-pro-image×2, nano-banana, 3.1-flash-image×2,
  3.1-flash-lite-image), `gemini-3.5-transcribe`, `computer-use`, `robotics-er`, `deep-research`×3,
  `omni`×2, `antigravity`×3: modality leakage via names the regex doesn't cover, undetectable otherwise
  (no modality fields in list API).
- **DeepSeek** (`fetchDeepSeek`): static-only for everything. REALITY (2 models): `{id,name,context_window
  (1048576!),max_output_tokens (393216!),input_modalities,output_modalities,effort:{supported_levels},
  api_capabilities}` — live IDs are `deepseek-flash` + `deepseek-v4-pro`; static `deepseek-v4-flash` is DEAD
  (no match) and static `deepseek-v4-pro` ctx 131072 contradicts live 1048576 → `deepseek-flash` gets 128000
  default (wrong; evidence-gate-relevant), displayName=id (live `name` ignored), effort/modalities ignored.
- **ZAI** (`fetchZAI`): static-only. REALITY (11 models): `{id,object,created,owned_by}` only — no pricing/ctx/caps
  anywhere; static `glm-4.7-flash` DEAD (live IDs `glm-4.5…4.7` plain). Live `glm-4.7` → defaults + coding=false,
  while the same GLM family on OR gets coding=true via family signal (cross-provider inconsistency).

### 2. Mapping tables (raw → normalized, confidence)
Pricing (all → USD per 1M): OR `pricing.prompt|completion` string-per-token ×1e6 HIGH; chutes
`pricing.prompt|completion` number-per-1M as-is (FIX fields) HIGH + `price.*.usd` fallback HIGH +
`input_cache_read` special (no normalized slot — ignore initially) MEDIUM; opencode NONE→static-if-matched
else unknown (FIX: fill static 0/0/free for the 4 matched, src registry) MEDIUM; openai/gemini/zai NONE→
static-if-matched else unknown HIGH-as-unknown; deepseek NONE→static-if-matched (FIX IDs) else unknown.
Zero: OR explicit "0"+"0" HIGH; chutes presumably numeric 0 (none observed — no zero models in 14) MEDIUM;
opencode free NOT name-inferable — authority is static registry only. Missing: OR none observed; chutes
n/a (fields misread); OC/ZAI/OpenAI/Gemini/DeepSeek = absent fields → unknown (never free) HIGH.
Context: OR `context_length` = window HIGH + `top_provider.max_completion_tokens` HIGH; chutes
`context_length` (=deploy ctx, ≤ `max_model_len` arch max — keep former, document) MEDIUM-HIGH +
`max_output_length` (FIX name) HIGH; gemini `inputTokenLimit` = max-input≈window MEDIUM + `outputTokenLimit`
(FIX: use) HIGH; deepseek `context_window` (FIX: use) + `max_output_tokens` (FIX: use) HIGH; openai NONE→
default 128000 LOW + `shutdown_date`→availability (FIX) MEDIUM; opencode/zai NONE→static-if-matched else
128000 default LOW (all-128000 uniformity is a smell — flag in UI provenance).
Capabilities (OBSERVED vs DERIVED): OR tools/reasoning/structured OBSERVED (params), vision OBSERVED
(modalities), coding DERIVED (family signal); chutes tools/reasoning/structured OBSERVED
(`supported_features`, FIX) + vision OBSERVED (modalities, FIX), coding DERIVED; deepseek reasoning
OBSERVED (`effort.supported_levels`, FIX) + vision OBSERVED (modalities, FIX) + displayName←`name` (FIX);
gemini reasoning OBSERVED (`thinking`, FIX), vision/tools/structured UNKNOWN-marked (no fields; tools/struct
currently default-true = fabricated confidence); OC/ZAI/OpenAI: no evidence → all UNKNOWN-marked (today:
coding/reasoning=false, tools/struct=true defaults — same fabrication flag); static-matched rows keep
curated caps with registry confidence.

### 3. Normalized schema proposal (next task implements; observed/derived/unknown per field)
`{provider, modelId, displayName, contextLength(+provenance: window|input-max|default),
inputPricePerMillion, outputPricePerMillion, priceSource: live|registry|unknown, priceFetchedAt, isFree
(+freeAuthority: explicit-zero|registry-confirmed|none), modalities: observed|unknown, supportsCoding
(observed:chutes-features/reasoning-effort? no — coding stays DERIVED family signal, applied UNIFORMLY
post-normalization to fix B13), supportsReasoning, supportsVision, supportsTools, supportsStructuredOutput
(each: observed|curated|unknown, never silent-true-default), speedSignals {activeParams, ctxPenalty},
familySignals, source, metadataConfidence: high|medium|low}`. Static registry role narrowed to
display/pricing/caps fallback with refreshed IDs (deepseek-v4-flash→deepseek-flash w/ 1M ctx; glm-4.7-flash→glm-4.7).

### 4. Bugs/gaps (15; selection logic untouched by all)
B1 opencode free-overwrite: live null-pricing stomps static explicit-free (4 models) → isFree=false +
null prices + priceSource 'registry' (triple inconsistency). B2 chutes price fields misnamed → all null.
B3 chutes output field misnamed → null. B4 chutes ignores supported_features/modalities. B5 deepseek ignores
live context_window/max_output_tokens/name/modalities/effort. B6 deepseek static ID dead + v4-pro ctx wrong
(131072 vs 1048576). B7 zai static ID dead. B8 openai owned_by filter stale → 1/126 pass. B9 openai
shutdown_date ignored. B10 gemini outputTokenLimit ignored. B11 gemini `thinking` ignored. B12 gemini
modality leakage (image/transcribe/computer-use/robotics/deep-research/omni/antigravity pass; no list-API
modality fields — name-heuristic extension only). B13 coding family signal OR-route-only (same family differs
by route). B14 silent-true defaults (tools/struct) + 'registry' stamped on null prices (B1/B2 fallout).
B15 OR extras unused (reasoning.efforts, per_request_limits, benchmarks — recommend NOT wiring benchmarks:
third-party, unstable; hugging_face_id usable for size signals later, low priority).

### 5. Implementation plan (NEXT task, audit must be reviewed first)
Single `normalizeProviderModel()` per provider returning the schema above; fix order: B8 (one-line filter:
`owned_by==='openai'` + keep id regex) → B2/B3/B4 chutes → B5/B6 deepseek → B1 opencode static-fill
→ B10/B11 gemini + B12 token extension → B7 zai IDs → B9 availability via shutdown_date → B13 uniform family
signals → B14 confidence marking (schema-visible, no silent defaults). Verify with a kept
`scripts/probe-raw-capture.ts` (redacted) + catalog rebuild diff (per-provider counts, free counts, null-price
counts) + re-run multi-provider audit tables. No selection/scoring/weight/gate/cap changes in that task either.

---

## IMPLEMENTATION — Provider metadata normalization (Sept 25, 2026)

**Status:** ✅ IMPLEMENTED + VALIDATED. No selection/weight/gate/cap/scoring changes
(`stageSelection.ts`, `cost.ts`, `stageTokenProfiles.ts` untouched — diff confirms).
`npx tsc --noEmit` clean. All temp scripts deleted. Fresh force rebuild with all 7
providers connected: 657 models, fingerprint all-7, `classifiedByAi=false`.

### What changed (files)
- **NEW `lib/ai/catalog/normalizers.ts`** — `normalizeProviderModel(provider, raw)` dispatch +
  7 normalizers + shared unit helpers (moved from live.ts) + static exact-match fallback
  (`applyStaticFallback`: live-wins, static-fills-absent-only, 'registry' never on null prices,
  exact `provider:modelId` only) + provenance (`priceSource/contextSource/freeAuthority/
  capabilityProvenance/metadataConfidence/modalities`).
- **`lib/ai/catalog/live.ts`** — transport-only fetchers (envelope parsing + normalize + drop
  nulls); deleted `LiveModelEntry`/`historyEntryToModel`/duplicated helpers. `fetchLiveModels`
  signature unchanged → dead `model-catalog/builder.ts` untouched, intelligence merge intact.
- **`lib/ai/catalog/types.ts`** — optional provenance fields on `ModelDefinition` (+`priceSource`).
- **`lib/ai/model-intelligence/index.ts`** — provenance passthrough into `NormalizedModel`
  (recomputed per build, NOT persisted — no schema change); priceSource now comes from the
  normalizer instead of recompute. Static path labeled curated/medium.
- Static registry rows: UNCHANGED (exact-match + live-wins makes dead IDs harmless; v4-pro's
  wrong static ctx now loses to live 1M).

### Per-provider behavior (measured on rebuild)
- **OpenRouter** 455, all high-confidence, zero-pricing free intact (21), Qwen $0.26/$2.08 ✓.
  Preserved exactly (same code path, moved).
- **Chutes** 14/14 priced-live (was 0), ctx live (12) + max_output_length populated,
  supported_features→observed caps (14 tools/reasoning/structured), vision observed where image
  input; 2 ctx-default rows (field absent upstream — honest default).
- **DeepSeek** 3 rows: flash + v4-pro live (1M ctx, 393216 maxOut, reasoning/vision observed),
  plus static-only `deepseek-v4-flash` phantom (registry, pre-existing fallback semantics —
  documented limitation, loses every ranking).
- **OpenCode** 81: 4 static explicit-free now free (`registry-confirmed`/`registry`, B1 fixed);
  other 77 unknown-price + all-false caps (no name inference, no silent-true defaults).
- **OpenAI** 126 raw → 64 eligible (owned `system`+`openai` kept, `openai-internal` out;
  13 past-`shutdown_date` excluded incl. sunset codex/chat-latest rows; 36 image/audio/realtime/
  transcribe/tts functional names excluded — gate breakdown verified ID-by-ID). Rest unknown/low.
- **Gemini** 50 → 28 (image×6 + banana + transcribe newly excluded; tts/lyria/embed/aqa/veo still
  excluded). outputTokenLimit populated 28/28, `thinking`→reasoning-observed 25/28. Agent models
  (computer-use/robotics/deep-research/omni/antigravity) deliberately KEPT (text I/O, no counter-evidence).
- **ZAI** 12 (11 live defaults + 1 static phantom): 0 false static attaches (live glm rows pure
  defaults 30/21/50/55); cross-provider coding note: zai glm coding=false (unknown) vs OR glm
  coding=true (derived) — now VISIBLE via provenance instead of silently inconsistent.
- Capability defaults are now all-false + 'unknown' (B14 fixed) except curated static matches.

### Before/after (all "before" values previously measured live)
OpenAI count 1→64; chutes priced 0→14, observed caps 0→14 (+vision where applicable), maxOut null→
populated; deepseek live-ctx 0→2, reasoning-observed 0→2; opencode free 0→4 (77 correctly non-free);
gemini eligible 36→28, outLimit known 0→28, thinking-observed 0→25; zai false matches 0→0 (kept honest);
OR 455 high→455 high.

### Regression + selection impact
OR-only 15/15 picks IDENTICAL to prior audit (Super/Qwen/Super + Ultra×12) — PASS. Full
7-provider picks also unchanged across all 15 (chutes Qwen-235B 86.75 qualifies in discovery
quality but $0 free still wins; balanced OR-Qwen still leads). Score inputs shifted honestly
(defaults-removed models score lower — e.g. zai/gemini-nonstatic/openai rows at 30/21/50/55-class
tuples), which is the intended data-accuracy effect, not a formula change.

### Remaining unknowns/limitations (not bugs)
No live pricing for OC/ZAI/OpenAI/Gemini/DeepSeek (unknown, correctly); OC/ZAI/OpenAI ctx all
128000-default; `input_cache_read` (chutes) has no normalized slot — ignored for now; OR
`reasoning.efforts`/`per_request_limits`/`benchmarks` deliberately unwired; `openai-internal`
owned rows excluded by policy; static phantoms (`deepseek-v4-flash`, `glm-4.7-flash`) remain as
registry-only rows (exact-match-only, never overwrite live).

### Next recommended task
Wire `metadataConfidence`/provenance into the /models UI (badges/columns: price provenance,
observed-vs-default capabilities) so users can SEE why providers win/lose; optionally backfill a
`registry_scores`-style column if persistence of provenance is wanted (schema migration — not
required). Do NOT tune selection until the UI exposes the new provenance.

---

## VALIDATION — Full 7-provider selection on corrected metadata (Sept 25, 2026)

**Status:** ✅ VALIDATED. Zero production changes (temp probe deleted; `tsc` clean; diff untouched
except this entry). Force rebuild via real `getOrBuildCatalog`: 657 models, all-7 fingerprint.

### 1. Catalog + pools (657 avail; families 619; gates/caps per stage)
- Per provider live/priced-live/free/ctxKnown: OR 455/455/21/455; chutes 14/14/0/12; OC 81/0/4/4;
  deepseek 3/0/0/3; gemini 28/0/0/28; zai 12/0/0/1; openai 64/0/0/0.
- Discovery/solution/patch: 657 → 619 fams → 604 gated → 33 capped (5/provider ×6 + deepseek 3).
  Root-cause: 579 gated → 33 capped. Evidence (200K): 339 gated {OR 308, chutes 9, deepseek 2,
  gemini 20} → 17 capped. OC/zai/openai structurally locked out of evidence (128K max).

### 2. Winners: all 15 = OpenRouter (fresh calculation)
Free: discovery Super-free 85.00, others Ultra-free (89.50/83.30/90.75/90.75). Balanced:
discovery Qwen122b 88.75−2.18=86.57 ($0.0052), others Ultra-free (penalty 0). Quality:
discovery Super-free (best 88.75, tol 5, 6 qualified, $0 cheapest), others Ultra-free
(best itself, 9/7/9 qualified). Full top-10s + alternatives recorded in this run's output.

### 3. Competition is real now (inputs transformed, outputs stable)
Chutes Qwen-235B/397B rank #2-3 discovery (86.75), #2-3 root-cause (89.13), **#1-2 evidence
(85.40 — beats winner 83.30 on raw score, loses quality on $0.0239 vs $0 within tolerance)**,
#2-3 solution/patch (90.38 vs 90.75 — 0.37 gap + cost). Balanced penalties verified live
(root-cause 89.13→85.63; evidence 85.40→79.04). OC's 4 registry-free now qualify for Free
(mimo 72.00 discovery alt3; ultra-free 77.00 root-cause alt4). DeepSeek-v4-pro + gemini-2.5-pro
(registry-priced, 86.50-87.75) populate caps honestly.

### 4. Mode/Free/Balanced/Quality/Evidence checks
Free pool = 25 authoritative only (21 OR explicit-zero live + 4 OC registry-confirmed); 6 OC
`-free`-named correctly non-free; chutes 0 false-free; unknown never free. Balanced: unknown
price → worst tier (no unknown model in any top-4); chutes priced participate with exact
penalties. Evidence ≥200K: OR 328, gemini 21, chutes 9, deepseek 2 — four providers viable.

### 5. Persistence + runtime
Preference row is now `selected_strategy:'balanced'` (user-applied) with overrides = exactly the
fresh Balanced picks (discovery Qwen + 4× Ultra), all `inCatalog=true`. Fresh-vs-persisted DIFF
on discovery is quality-vs-balanced mode difference (Super-free vs Qwen) — i.e. proof the modes
diverge meaningfully. Runtime trace re-verified unchanged: gateway → `resolveAnalysisRouting`
(`lib/ai/routing.ts:51`) reads `stage_overrides[task]` → `runWithFallback` first candidate;
openrouter credentials resolve, so all 5 overrides are live-runnable.

### 6. Conclusions A–H
A. No winner changed, but selection INPUTS transformed (chutes priced+ranked, OC free restored,
   deepseek 1M ctx, gemini filtered+limits, openai 1→64 eligible). B/C/D. Free: Super + 4×Ultra
   (all OR). Balanced: Qwen + 4×Ultra (all OR). Quality: Super + 4×Ultra (all OR). E. Yes where
   data justifies: Free≠Balanced on discovery ($0 vs $0.0052); Quality≡Free here by the 5-pt rule.
   F. Sameness is catalog-driven, not algorithm-driven: best paid leads (+3.75 discovery, +2.1
   evidence-chutes, +0.37 solution-chutes) all fall inside tolerance/cost-penalty defeat; no free
   model beats Nemotron scores. G. No material normalization issue left: static phantoms
   (`deepseek-v4-flash`, `glm-4.7-flash`) rank ≤73.0/≤62.38, 10+ pts off every win; openai/zai
   unknown-rows never reach top-4; cosmetic float dust (`0.09999999999999999` from ×1e6) noted for
   a future polish pass. H. YES — engine ready for product/UI work: deterministic, provenance-
   labeled, 7-provider verified, persistence/runtime consistent.

### Next recommended task (unchanged, now unblocked)
Surface provenance in /models UI (price source + observed/default capability badges). Optional
follow-ups (no selection changes): remove/refresh the 2 static phantom rows; round per-token
conversion dust; keep `input_cache_read` ignored until a cost slot exists. Do NOT tune selection.

---

## INVESTIGATION — Paid Chutes model displayed under Free after OpenRouter disconnect (Sept 25, 2026)

**Status:** ✅ INVESTIGATION COMPLETE, NO PRODUCTION LOGIC CHANGED (temp `buildAutomaticPool` export
reverted — `git diff` confirms `stageSelection.ts` untouched; temp probe `scripts/probe-free-pool.ts`
deleted; `npx tsc --noEmit` **0 errors**).

**Exact reproduction:** OpenRouter disconnected (its `provider_connections` row deleted; the other six
providers connected) → click **Free** in BugWiser Model Setup → all five stage rows populate:
File Discovery → Mimo v2.5 (free)/OpenCode, Root Cause → Nemotron 3 Ultra (free)/OpenCode,
**Evidence → Qwen3 235B A22B Thinking 2507/Chutes (PAID)**, Solution/Patch → Mimo v2.5 (free).
Reload shows the same ("Free selected" badge + paid Evidence row).

**Verdict: F.** The Free selector's *designed* paid fallback fired because the free candidate pool for
Evidence is genuinely EMPTY (all remaining free models are OpenCode @ 128K context, and Evidence's
200K context gate excludes them before free filtering); the `StagePick.isPaidFallback`/`isFree=false`
flags are then DROPPED at the persistence boundary (`stage_overrides` stores only `{provider, model}`),
so the UI renders the fallback as an ordinary Free pick with no disclosure. It is NOT stale data (B),
NOT a stage-id mismatch (C), NOT a strategy mapping bug (D), NOT wrong free metadata (E).

### 1. Connection state (DB truth — env vars do not connect providers)
`provider_connections` rows (user `9efb32ca…c3e`): opencode 10:48:23Z, chutes 10:57:39Z,
gemini 10:58:25Z, deepseek 12:05:21Z, zai 12:08:58Z, openai 12:09:59Z — **no openrouter row**.
`getProviderConnections` = exactly the expected state: `openrouter:false, opencode:true,
chutes:true, gemini:true, deepseek:true, zai:true, openai:true` ✓ (DB-only by design; env keys
would not keep openrouter connected).

### 2. Fresh catalog (real `getOrBuildCatalog(uid, force=true)` path — 3.4s)
`fingerprint=chutes:deepseek:gemini:openai:opencode:zai`, `classifiedByAi=false`, static 14 + live 200
merged → **202 models; OpenRouter contributes ZERO models ✓**.

| provider | models | priced (non-null) | free | unknown price | ctx-known (live/registry) |
|---|---|---|---|---|---|
| chutes | 14 | 14 | **0** | 0 | 12 |
| deepseek | 3 | 2 | 0 | 1 | 3 |
| gemini | 28 | 2 | 0 | 26 | 28 |
| openai | 64 | 0 | 0 | 64 | 0 |
| opencode | 81 | 4 | **4** | 77 | 4 |
| zai | 12 | 0 | 0 | 12 | 1 |
| **total** | **202** | **22** (incl. the 4 free-at-$0 registry rows) | **4** | **180** | **48** |

All 4 free models are OpenCode registry-confirmed (`mimo-v2.5-free`, `nemotron-3-ultra-free`,
`big-pickle`, `nemotron-3.5-lightning-free`) — every one has **contextWindow 128,000**.

### 3. Per-stage Free candidate pools (candidates entering Free selection → after free filter)
Full tables printed by the probe (available = connected + not-unavailable, 202 models; automatic pool
per stage = family grouping → context gate → provider cap):

| stage | ctx gate | BEFORE free filter | AFTER free filter |
|---|---|---|---|
| File Discovery | 32K | 28 (top: chutes Qwen235B 86.75 paid, Qwen397B 86.75 paid … then mimo 72.00) | **4** — mimo 72.00, ultra 70.75, big-pickle 69.00, lightning 60.63 (all opencode) |
| Root Cause | 128K | 28 (top: chutes 89.13 paid … then ultra-free 77.00) | **4** — ultra 77.00, mimo 76.50, big-pickle 72.75, lightning 54.75 |
| **Evidence** | **200K** | **12** (chutes ×5, deepseek ×2, gemini ×5 — ALL paid/unknown) | **0** |
| Solution | 32K | 28 (top chutes 90.38 paid … mimo 77.88) | **4** — mimo 77.88, ultra 77.63, big-pickle 74.13, lightning 60.00 |
| Patch | 32K | 28 (same shape as Solution) | **4** — mimo 77.88, ultra 77.63, big-pickle 74.13, lightning 60.00 |

**Explicit check — Chutes `Qwen/Qwen3-235B-A22B-Thinking-2507-TEE`** ("Qwen3 235B A22B Thinking 2507"):
`isFree=false`, `in=$0.2989`, `out=$1.1957` (non-zero, `priceSource=live`, `freeAuthority=none`,
ctx 262144). It appears in every BEFORE list (paid candidate) and in **zero** free-eligible lists
(`in-free-list=false` on all five stages) ✓. Evidence's BEFORE list has no free model of any kind:
the 4 free OpenCode models are structurally excluded (128,000 < 200,000) and every other connected
provider has **0 free models** (chutes 0, gemini 0, deepseek 0, zai 0, openai 0).

### 4. Actual Free selector run (`selectStageModels('free', …)` — the exact UI path)
| stage | pick | StagePick.isFree | isPaidFallback | invariant (isFree===true) |
|---|---|---|---|---|
| relevant_file_discovery | opencode/mimo-v2.5-free | true | false | PASS |
| root_cause_analysis | opencode/nemotron-3-ultra-free | true | false | PASS |
| **evidence_extraction** | **chutes/Qwen/Qwen3-235B-A22B-Thinking-2507-TEE** | **false** | **true** | **FAIL** |
| solution_generation | opencode/mimo-v2.5-free | true | false | PASS |
| patch_generation | opencode/mimo-v2.5-free | true | false | PASS |

**Exact violation point:** `selectForStage` in `lib/ai/catalog/stageSelection.ts` — free branch:
`freePool = pool.filter((m) => m.price.isFree)` (**:389**) yields `[]` for Evidence → paid fallback
path `chosen = bestPaid; isPaidFallback = true` (**:410–411**); the deeper fallback `chosen = pool[0]`
is at **:417**. The selector correctly flagged the pick (`isFree:false`, `isPaidFallback:true`) —
the fallback itself is documented Free behavior (Task 3: "no suitable free: best confirmed-paid
candidate"), chosen here because best-scoring confirmed-priced candidate = chutes Qwen235B (85.40,
valueScore tie-break over Qwen397B: blended $1.79 vs $3.90/1M).

### 5. Fresh vs persisted (critical staleness check)
Persisted `user_model_preferences` row: `selected_strategy='free'`, `selection_mode='auto'`,
`stage_overrides` = exactly {discovery opencode/mimo-v2.5-free, root opencode/nemotron-3-ultra-free,
**evidence chutes/Qwen/Qwen3-235B-A22B-Thinking-2507-TEE**, solution opencode/mimo-v2.5-free,
patch opencode/mimo-v2.5-free}.
Comparison: every stage's persisted override **matches fresh Free** (evidence also coincidentally
matches fresh Balanced AND fresh Quality — all three modes independently pick the same chutes model
for that stage on this catalog: quality best 85.40 with only the two chutes Qwen inside the 5-pt
tolerance, balanced penalizes nothing cheaper; the other four stages match Free ONLY).
→ **The UI is displaying a fresh Free calculation, not stale overrides (B ruled out).**

### 6. UI data source trace (`app/models/page.tsx`)
- **Click Free/Balanced/Quality** → `handleSetupSelect` (**:166**) → `selectStageModels(setup,
  libraryBaseModels)` (**:173**) → local stage rows + `setSetupChoice(setup)` (**:185–186**) →
  `PUT /api/models/preference` with `{selection_mode:'auto', selected_strategy: setup,
  stage_overrides}` (**:195–199**) → `applySavedPreference` from the response (**:202**).
  **Clicking Free DOES recalculate and persist fresh Free selections — proven by §5.**
  BUT `stageOverrides` is built as `{provider, model}` only (**:188–194**) — `StagePick.isFree` and
  `isPaidFallback` are dropped right here.
- **Reload / connect / disconnect** → `refresh` → `GET /api/models` → `applyData` (**:107**) →
  `loadStageModels(pref.stage_overrides)` (**:120**, `isOverride = !!override` **:138**) +
  `setSetupChoice(toSetupChoice(pref.selected_strategy))` (**:121**; free/balanced/quality pass
  through, legacy → null). Connect/disconnect does NOT re-run selection; reconcile
  (`app/api/models/route.ts:76`) only drops overrides whose model left the catalog.
- **Display:** stage rows render the persisted override's model/cost; badge "Custom Override" for
  ANY override (**:453**), status "Custom" (**:433**); setup card badge "{SETUP_TITLES[selected]}
  selected" purely from `selected_strategy` (`StageConfigPanel.tsx:28–32`).
  **`isPaidFallback` is consumed NOWHERE outside `stageSelection.ts`** (grep) — nothing marks the
  Evidence row as a fallback.
- **Can an old Balanced/Quality/manual override survive displayed as Free?** Structurally yes via
  two paths: (a) manual StageChangeModal edit + `handleSavePreference` (**:211–227**) persists
  `setupChoice ?? 'custom'` as strategy alongside the hand-picked override; (b) a failed PUT after
  local setState (transient, reverts on reload). **Neither occurred in this observation.**

### 7. Strategy routing — free → free, verified end-to-end
`handleSetupSelect` sends `selected_strategy: setup` verbatim (**:198**); preference PUT accepts
`SelectedStrategy` incl. balanced/quality; reload maps back via `toSetupChoice` (**:550–552**).
No `free → auto|balanced|quality` remapping exists anywhere on this path; persisted
`selected_strategy='free'` and badge "Free selected" both confirm routing. Runtime is
strategy-independent for the stage model: `resolveAnalysisRouting` (`lib/ai/routing.ts:51`) reads
`stage_overrides[task]` directly, so Evidence will actually RUN the chutes paid model too
(gateway's `analyses.model_strategy` only feeds the fallback chain).

### 8. Stage ID mapping — verified programmatically
`STAGE_WEIGHTS` keys == page `STAGES` ids, identical order: `relevant_file_discovery,
root_cause_analysis, evidence_extraction, solution_generation, patch_generation` ✓
(Evidence receives only `evidence_extraction` picks — no cross-stage bleed).

### 9. Root cause: **F** (concrete chain, code evidence)
1. OpenRouter (the only provider with explicit-zero free models ≥200K ctx) is disconnected →
   catalog free set = 4 OpenCode models, all ctx 128,000 (§2).
2. `buildAutomaticPool` applies `STAGE_CONTEXT_MIN.evidence_extraction = 200_000`
   (`stageSelection.ts:44–50`) BEFORE the free filter → all 4 free models excluded → `freePool = []`
   at **:389** → paid fallback `chosen = bestPaid` at **:410** (honest `isPaidFallback=true`).
3. `handleSetupSelect` persists only `{provider, model}` (**page.tsx:188–194**); reload +
   setup badge reconstruct "Free selected + paid model" with no fallback flag (**page.tsx:120–121,
   453; StageConfigPanel.tsx:28–32**).
Free filter, metadata, stage IDs, and strategy routing are all CORRECT (A/C/D/E ruled out with data
in §1–§8); there is no stale override (B ruled out in §5). This is structural: with only OpenCode
connected, Evidence will always paid-fallback (128K < 200K — also flagged in the multi-provider audit).

### 10. Recommended minimal fix (NOT implemented — investigation only)
Do not touch the Free filter/gates/fallback semantics. Surface what the selector already knows:
- **Preferred (UI-only):** when `setupChoice === 'free'` and the configured stage model has
  `price.isFree === false`, render a "Paid fallback" badge + reason ("No free model meets this
  stage's 200K context requirement") on that row — computable client-side from data already
  present, zero schema/selection change.
- **Alternative (additive persistence):** carry `isPaidFallback`/`isFree` through `stage_overrides`
  so runtime + reload both see it (schema/API additive field).
- **Data path:** reconnect OpenRouter (or any provider with free ≥200K-context models) — restores a
  non-empty Evidence free pool; no code change.
`npx tsc --noEmit`: 0 errors. Temp diagnostics removed; selection/pricing/normalization/UI behavior
all unchanged by this task.

---

## IMPLEMENTATION — Strict Free semantics + model-selection cleanup (Sept 25, 2026)

**Status:** ✅ IMPLEMENTED + VALIDATED + CLEANED UP.
`npx tsc --noEmit` 0 errors · `npm run build` ✓ (18 routes; /api/debug/selection gone, preflight kept)
· `npm run lint` 15 errors/52 problems vs **15/60 at HEAD** (stash-baseline compare: zero new
problems, 8 dead-file warnings removed; all 15 errors pre-existing at HEAD). Temp probes deleted
afterwards (fixture probe 38/38 PASS; live run ALL PASSED).

### PART A — strict Free (fixes verdict-F bug above)

**Selector (`lib/ai/catalog/stageSelection.ts`)** — only header + free branch changed:
- `StagePick`: `provider`/`model` → `string | null`; **removed `isPaidFallback`**; added
  `unavailable?: boolean` (Free NEVER falls back to a paid model).
- Free: `freePool = pool.filter(m => m.price.isFree)` unchanged (confirmed-free only, unknown
  price never free); empty → explicit unavailable pick `{provider:null, model:null, isFree:false,
  unavailable:true}`. Also when `buildAutomaticPool` yields 0 for Free (gates exclude everything).
  Old paid-fallback block (bestPaid scan + `pool[0]` last resort, former :393–423) deleted.
- Balanced/Quality branches, STAGE_WEIGHTS/STAGE_CONTEXT_MIN, pool construction, family grouping,
  provider caps, scoring, cost helpers: **untouched** (diff-verified).

**Persistence path (unavailable marker flow):**
- `overrideReconcile.ts`: `StageOverrideEntry.unavailable?`; reconcile KEEPS
  `{provider:null, model:null, unavailable:true}` verbatim (points at no model → can never be
  stale); real entries unchanged (stale still dropped, never rewritten).
- `preferences.ts` + PUT `/api/models/preference`: stage_overrides entry type carries `unavailable?`.
- `/api/models` + `/api/ai/models`: cast types updated; `/api/models` self-healing save preserves
  markers (kept includes them → `changed=false` when only markers exist → no spurious save/toast).
- `app/models/page.tsx`: `StageModel.unavailable`; `handleSetupSelect` persists markers + warning
  toast ("no free model available for N of 5 stages"); `handleSavePreference` re-persists markers;
  `handleApplyStageChange` CLEARS the marker (manual pick wins); `loadStageModels` restores it on
  reload; row UI: model cell **"No free model available"**, status pill **"No free model"** (amber,
  text-first — not color-alone), provider "—", guidance subline, "Custom Override" badge suppressed.
  Estimated cost: unconfigured stage ⇒ unknown total (existing semantics, honest).

**Engine (`lib/ai/strategy-selection.ts`) `free` mode:** paid-fallback branch (best-any when
registry-free pool empty) → `continue` (skip stage). Runtime error-fallback UNCHANGED:
`runWithFallback` still appends `autoChain` after the strategy candidate; stage overrides still
flow via `resolveAnalysisRouting` (`routing.ts:37` null-guard → marker = no override = existing
auto behavior); `applyStageOverrides` null-guard skips markers (no null injection — asserted).

### Validation (temp scripts deleted after run)
- **Fixture probe 38/38 PASS** (pure, no DB): A free-capable→5/5 free; **B REPRO→evidence
  unavailable + 4 free + chutes Qwen never picked**; B Balanced/Quality still concrete (Balanced
  evidence may be paid = unchanged); C no-free-at-all→5/5 unavailable (paid never chosen); D empty
  catalog→null; E free ≥200K restored→evidence free; persistence builder→exact marker shape;
  reconcile keeps marker / drops stale / keeps valid; engine: no paid assignment without a
  registry-free provider, all-free with opencode, marker never injects nulls.
- **Live run (stored catalog, user 9efb32ca…, real serving path):** openrouter:false + 6×true,
  202 models/4 free → Free = 4× opencode-free + **evidence NO FREE MODEL AVAILABLE**, chutes Qwen
  absent. Persisted row BEFORE = paid chutes evidence (the bug) → repaired with the exact UI
  payload (`saveModelPreference`) → AFTER: 4 real + evidence marker, strategy `free`/mode `auto`,
  reconcile kept 5/changed=false. ALL PASSED.
- **Leftover search:** `isPaidFallback` 0 hits; deleted modules 0 refs; free→paid fallback code
  remains only in `free_paid` (strategy-selection :112) + `fully_paid` (:159, paid-by-design) —
  scope notes below.

### PART B — cleanup (reference-audit before every deletion: import greps incl. relative/bare + fetch strings)
DELETED (zero references):
- **`lib/ai/model-catalog/*`** (6 files) — only refs were 2 TYPE imports of `ProviderName`;
  both swapped to `@/lib/ai/catalog/types` (the identical 7-member union that
  model-catalog/types merely re-exported) → duplicate catalog system gone
  (builder/cache/index/ranking/strategies/types).
- **`lib/ai/orchestration/*`** (3 files) — duplicate strategy system, zero refs.
- **`lib/ai/catalog/scoring.ts`** — old "BugWiser Fit" scorer, zero refs.
- **`lib/ai/catalog/index.ts`** — dead barrel (getModelCatalog/MODEL_REGISTRY re-export); live
  engine uses `lib/ai/model-registry.ts`.
- **`lib/ai/catalog/debugSelection.ts` + `app/api/debug/selection/`** — temp debug tooling
  (header: "remove when selection debugging is complete" — completed, recorded above).
- **`components/analysis/ModelSelector.tsx`** (zero importers; sole consumer of /api/ai/models)
  and **`components/analysis/StageModelBadge.tsx`** (zero importers).
- **`scripts/*`** — 4 temp probes incl. `debug-selection.ts` (header: "delete when investigation
  recorded in think/state.md" — recorded). scripts/ now empty.

KEPT (audit proved live):
- **`app/api/analysis/preflight/route.ts` + `components/analysis/ModelPreflight.tsx` — CORRECTION
  to the old note at state.md:277 (listed preflight as dead): it is LIVE** —
  `analysis/new` `handleStartAnalysis` → `setShowPreflight(true)` → POST /api/analysis/preflight.
- `components/analysis/ModelTierBadge.tsx` (imported by analysis/[id]).
- `lib/ai/catalog/{modelSignals,normalizers,overrideReconcile,types,registry,cost,live,stageSelection,stageTokenProfiles}.ts`
  (all imported); `lib/ai/model-registry.ts`, `lib/ai/strategy-selection.ts` (engine).
- `app/api/ai/models/route.ts` — no internal consumer after ModelSelector removal; retained as
  the strategy-assignment endpoint (distinct from /api/models) — revisit when a strategies UI exists.

### Scope notes / tech debt
1. `free_paid` engine mode still falls back to paid for its free-designated stages when no
   registry-free model is connected (strategy-selection.ts:112). Different strategy (not the Free
   setup), unreachable from the /models UI (setups = free/balanced/quality) — outside this task's
   strict-Free mandate; candidate for a follow-up.
2. Unavailable markers are snapshots: they persist until the user re-applies a setup or configures
   the stage; connecting a free ≥200K provider does NOT auto-clear them (re-run Free to pick the
   new model). Deliberate: reconcile must not re-run selection server-side (would risk clobbering
   deliberate manual paid overrides under Free — indistinguishable from old-fallback rows).
3. Legacy paid rows from the old fallback are not auto-mutated (indistinguishable from manual
   picks); the one observed live row was repaired above because the investigation proved it was
   fallback-produced, not manual.
4. Engine still ranks from static MODEL_REGISTRY with no context gates — pre-existing architecture,
   untouched (parity would be its own task).

**Next recommended task:** unchanged — surface provenance (price source / capability confidence) in
the /models UI; optional follow-ups: strict-free-ify `free_paid` free stages (scope note 1), clear
unavailable markers on free-pool recovery (scope note 2).

---

# Architecture Audit — remaining model system (READ-ONLY, post strict-Free + cleanup)

Repo state: work committed (`a213062`), tree clean; audit ran against HEAD. No code changed.
Validations: `npx tsc --noEmit` → 0 errors. Whole-repo string searches via ripgrep (all files,
incl. md/json; `.next`/`node_modules`/`.git` excluded). No test suite exists in the repo.

## A. `/api/ai/models` — CONSUMERLESS (deletion candidate)

- Search results for `api/ai/models` across the entire repo: only COMMENTS
  (`lib/ai/strategy-selection.ts:13`, `lib/ai/catalog/stageSelection.ts:31`) + historical
  `think/state.md` lines. Zero fetch/axios (axios unused in repo), zero imports of the route,
  zero `<Link>`/router/redirect/form/middleware references (`next.config.ts` has no
  redirects/rewrites), zero tests/scripts.
- Former sole consumer `components/analysis/ModelSelector.tsx` deleted in the cleanup task.
- Not called by Models page (`/api/models`), not during analysis (preflight uses
  `/api/analysis/preflight`), not by gateway/routing/model-router (runtime reads DB directly),
  not by any server-side code.
- All its imports (`getOrBuildCatalog`, `getModelPreference`, `getProviderConnections`,
  `buildStageAssignments`, `STAGE_WEIGHTS`, `reconcileStageOverrides`) are shared with live
  modules — deleting the route orphans nothing. Runtime consequence of deletion: none.
- Housekeeping on deletion: `stageSelection.ts:31` comment references the route; state.md
  references stay historical.

## B. `free_paid` — LIVE-BUT-DORMANT / COMPATIBILITY (retain)

- Code surfaces: engine mode `strategy-selection.ts:82-144`; `gateway.ts:61` reads
  `analyses.model_strategy`; `model-router` strategy union; `preferences.ts:13`,
  `page.tsx:67` type unions; `/api/ai/models:125` strategies list; migrations 006/006b/013
  CHECK constraints; `types/index.ts:257`.
- A. Reachable from current UI? NO — /models setups = free/balanced/quality only
  (`toSetupChoice`, `handleSetupSelect` sends `selected_strategy: setup`); no UI writes
  `free_paid`. B. Persisted by UI? NO.
- C. Runtime routing? Only if a preference row has `selected_strategy='free_paid'` (direct PUT
  to `/api/models/preference` — PUT does not validate enum membership — or legacy data) →
  `/api/analyses:55-71` copies it into `analyses.model_strategy` (balanced/quality→custom) →
  `gateway.ts:58-61` reads it → engine mode. Chain intact but UI-unreachable.
  Note: `analysis/new` sends `model_strategy` in the POST body — `/api/analyses` IGNORES it
  (reads preference instead). D. Tests: none (no test suite). E. Historical compatibility:
  yes (DB enums are immutable schema).
- F. Purpose: designed engine mode (discovery+evidence → free, rest → paid) + its free stages
  still carry the old paid fallback (`strategy-selection.ts:111-127`, scope note 1).
- Verdict: COMPATIBILITY — cannot be deleted without touching DB CHECK constraints + 5 type
  surfaces; keep. It is distinct from the `free-paid` filter key in `ModelControls.tsx`
  (different concept; that component is dead anyway).

## C. Canonical production flow (file → function → next)

1. Provider connection: `ProviderCard` → `app/models/page.tsx handleConnect:256` →
   `app/api/models/connect/route.ts POST` → `connection/service.ts saveUserConnection:160`
   (upsert `provider_connections`, credential-cache clear) → background
   `model-intelligence.rebuildCatalogOnce` (fire-and-forget). Disconnect:
   `connections/[provider]/route.ts DELETE` → `removeUserConnection:193` → same rebuild.
2. Live provider fetch: `model-intelligence/index.ts discoverModels:95` →
   `catalog/live.ts fetchLiveModels:121` (`resolveUserCredentials` → parallel
   `PROVIDER_FETCHERS` → per-provider failure isolated).
3. Normalization: `catalog/normalizers.ts normalizeProviderModel` — SINGLE boundary
   (`isExplicitlyFree:62`, `applyStaticFallback:113`, `finalize:178`).
4. Catalog discovery/classification: `discoverModels` merges STATIC_MODEL_REGISTRY
   (`catalog/registry.ts`) ∩ connected + live ∩ connected → `aiClassify` (a connected free
   model scores the catalog) or `deterministicRank`.
5. Catalog persistence/freshness: `storeCatalog:462` → Supabase `model_catalog` +
   `model_catalog_meta` (provider_fingerprint, last_analyzed_at);
   `getOrBuildCatalog:593` = load → fingerprint mismatch → SYNC `rebuildCatalogOnce:582`
   (single-flight) → TTL `CATALOG_TTL_MS` 1h → serve stale + BACKGROUND rebuild; empty/failed
   rebuild serves last-known catalog (not stored).
6. `/api/models GET` (`app/api/models/route.ts:10`): Promise.all(catalog, preference,
   connections) → `PROVIDER_DEFINITIONS` ∩ connected → `reconcileStageOverrides` → self-heal
   persist on drops → payload.
7. Models page: `loadData:95` → `applyData:107` → setModels/setProviders +
   `loadStageModels(reconciled incl. unavailable markers)`; `libraryBaseModels:90` =
   models ∩ connectedProviderIds.
8. Candidate pool: `stageSelection.ts buildAutomaticPool:219` (family grouping →
   `STAGE_CONTEXT_MIN` gate → per-provider top-N).
9. Stage selection: `selectStageModels/selectForStage:354/363` — free strict branch:409;
   balanced `pickBalanced:280`; quality `pickQuality:322`.
10. Preference persistence: `handleSetupSelect:166` / `handleSavePreference:224` →
    `PUT /api/models/preference` → `preferences.ts saveModelPreference:59` (upsert
    `user_model_preferences`, stage_overrides incl. `unavailable`).
11. Runtime routing: `lib/analysis/*` → `gateway.ts generate:48` →
    `routing.ts resolveAnalysisRouting:51` (credentials + preference +
    `resolveStageOverride:31` null-guard) + `analyses.model_strategy` read.
12. Gateway → `model-router/index.ts runWithFallback:204`: `buildAvailableProviders:191`
    (env ∪ tokens) → `strategy-selection.buildStageAssignments:379` + autoChain
    `config.ts selectModelsForTask:172` → chain [stage-override > manual > strategy-assignment
    > autoChain, deduped] → availability/error-aware fallback loop.
13. Execution: `getOrCreateProvider:180` → `providers/registry.ts
    createProviderInstanceWithApiKey:93` → `providers/<p>/client.generate`.

Competing implementations (informational only, none feeds persistence/runtime):
`app/api/analysis/preflight/route.ts pickForStage:40` (display scorer; LIVE via analysis/new
modal; its tier pick is display-only — `body.model_strategy` ignored by `/api/analyses`,
`selectedStrategy` state in analysis/new is write-only); `/api/ai/models` fit display (dead);
`config.rankModels` = runtime autoChain layer (different concern, not a duplicate).

## D. Duplicate/dead modules (no deletions performed)

| File | Classification | Evidence | Action |
|------|----------------|----------|--------|
| `app/api/ai/models/route.ts` | DEAD (consumerless endpoint) | zero callers repo-wide; sole caller deleted; no redirects/rewrites | deletion candidate (safest) |
| `app/api/model-intelligence/refresh/route.ts` | DEAD (callerless endpoint) | zero fetch refs; duplicates connect/disconnect force-rebuild path | deletion candidate |
| `lib/ai/presets.ts` | DEAD | zero importers; `selection_mode:'preset'` is type-only (nothing writes it) | deletion candidate |
| `components/models/ModelControls.tsx` | DEAD | zero importers/JSX | deletion candidate |
| `components/models/CategorySection.tsx` | DEAD | zero importers/JSX | deletion candidate |
| `components/models/ModelComparison.tsx` | DEAD | zero importers/JSX | deletion candidate |
| `app/models/page.tsx:682 ModelLibrary` + `libraryModels:281`/`recommendedModels:788` + `filter`/`search` state | DEAD (in-file island) | lint "defined but never used"; no `<ModelLibrary>` JSX anywhere | cleanup candidate (surgical) |
| `free_paid` engine mode + DB enums + type unions | COMPATIBILITY | schema CHECKs (006/006b/013); UI never writes; runtime only via direct PUT | RETAIN |
| `strategy-selection.ts:111-127` free→paid fallback in `free_paid` | COMPATIBILITY (scope note 1) | unreachable-from-UI as above | RETAIN (follow-up: strict-free-ify) |
| `preferences.ts:8 'preset'` + `/api/ai/models:199` preset branch | DEAD branch | type-only, unreachable | fold into presets cleanup |
| `model-intelligence:665 refreshCatalogIfNeeded` | DEAD export | zero callers | minor cleanup |
| `config.ts:238 getTaskModelChain` | DEAD export | zero callers | minor cleanup |
| `model-router:401 getModels` | DEAD export | zero callers | minor cleanup |
| `catalog/types.ts:138 StageAssignment`, `:38 ProviderConnection` | DEAD types | zero importers (engine's StageAssignment is strategy-selection's) | minor cleanup |
| `analysis/new:40 selectedStrategy` state | DEAD state | assigned (:184), never read | minor cleanup |
| `ProviderName` union defined twice (`providers/registry.ts:10`, `catalog/types.ts:4`) | COMPATIBILITY (structural duplicate) | identical literal unions, mutually assignable, both heavily used | consolidate later (low priority) |
| `components/analysis/ModelPreflight.tsx` + preflight route | LIVE | `analysis/new:180/337` gates analysis start; POSTs route | RETAIN (old state.md notes calling preflight "dead" are WRONG for current code) |
| `lib/ai/model-registry.ts` / `config.ts` / `cost.ts` / `stageTokenProfiles.ts` / `modelSignals.ts` / `normalizers.ts` / `live.ts` / `registry.ts` / `overrideReconcile.ts` / `stageSelection.ts` / `preferences.ts` / `routing.ts` / `gateway.ts` / `model-router` / `strategy-selection` / `model-intelligence` / `connection/*` / `providers/*` / `validation/*` / `context/*` / `analysis-selection` / `model-execution-tracker` | LIVE | importers verified | RETAIN |

Doc discrepancies found in this state.md's older entries: (1) "env-provider disconnect 409" never
existed in `connections/[provider]/route.ts` (git log -S '409' empty for all history) — the DELETE
route has NO env guard today; (2) preflight route listed as dead in older entries — it is LIVE.

## E. Free verification — all strict-Free invariants hold at HEAD

1. Free cannot select paid: `stageSelection.ts:409` filters `pool.filter(m => m.price.isFree)`;
   `:413` takes first. No paid-fallback branch exists (removed by strict-Free task).
2. Unknown pricing ≠ free: `normalizers.ts isExplicitlyFree:62` = pricing EXISTS ∧ input===0 ∧
   output===0; live payloads without pricing → `isFree:false`, `priceSource:'unknown'`.
3. Null pricing ≠ free: same guard (`input != null && output != null`); static null/null rows
   never stamped registry (applyStaticFallback:133-152); only exact static `isFree:true` rows
   grant `freeAuthority:'registry-confirmed'` (curated authority, not inference).
4. No suitable free model → unavailable: two markers — empty autoPool `:381` and empty freePool
   `:411` → `{provider:null, model:null, unavailable:true}`.
5. Markers persist: `page.tsx:192-195` (setup apply) + `:230-231` (save) write the marker;
   `overrideReconcile.ts:71-73` keeps markers verbatim; `/api/models` self-heal (`changed` =
   dropped real entries only) never strips them.
6. Reload preserves: `loadStageModels:138` reads `override?.unavailable === true`; `applyData`
   runs on mount and after connect/disconnect refresh.
7. Manual Configure clears: `handleApplyStageChange:354` sets `unavailable:false`, then Save
   persists the concrete provider/model entry.
8. Runtime never executes a marker: `routing.ts:37` returns null for null/missing
   provider|model; `runWithFallback` therefore receives `stageOverrides:null`;
   `applyStageOverrides:307` also null-guards (engine path).
   Nuance (pre-existing, documented): a marker stage falls through to the strategy/auto chain
   exactly like an unconfigured stage — autoChain is free-agnostic; under a saved Free strategy
   the engine assigns a registry-free model first when one is connected. AutoChain's lack of
   free gating is the engine-parity debt (scope note 4), not a marker execution.

## F. Provider add/remove dynamics

- Fingerprint: `buildProviderFingerprint:65` = sorted SET of DB-connected providers (not model
  contents). DB-only by design (`service.ts:76-79` — env must not keep a provider "connected").
- A/B connect: mutation → background `rebuildCatalogOnce` (single-flight) → UI `refresh()` →
  `/api/models` GET; if background rebuild hasn't landed, GET's fingerprint check triggers the
  SAME deduped rebuild synchronously → catalog reflects new set before response.
  Saved overrides/markers are NOT re-evaluated (no new staleness — catalog only grew).
- C disconnect: same rebuild path → model rows for A removed (storeCatalog deletes
  by-fingerprint rows) → `reconcileStageOverrides` drops overrides pointing at A's models →
  self-heal persists kept set → UI toast lists dropped stages. Markers kept (modelless).
- D reconnect: dropped overrides do NOT resurrect (correct — stages return to automatic until
  the user re-applies a setup); new catalog includes A again.
- E all disconnected: `discoverModels` returns [] → rebuild result empty → NOT stored →
  `getOrBuildCatalog` serves the LAST-KNOWN catalog (deliberate: keeps working when provider
  APIs fail); every GET retries the rebuild. Providers list = all disconnected (from
  `provider_connections`); `libraryBaseModels` = ∅ (page filters by connected ids) → setup
  apply blocked with toast. Overrides reconcile against the stale-served catalog → KEPT until
  a rebuild succeeds. Runtime: override provider lacks credentials → `runWithFallback:292`
  skips it → falls through the chain; if no provider at all is executable → clean error
  ("No configured providers available").
- F catalog/model drift: upstream model removals inside the 1h TTL stay in the served catalog
  (reconcile can't drop what catalog still lists; runtime execute fails → normal fallback).
  Live fetch has HTTP `revalidate: 3600` too. Provider-set changes bypass TTL (fingerprint).
- Env asymmetry (documented design, not a bug): env keys execute at runtime
  (`resolveUserCredentials` env-first, `buildAvailableProviders` env counts) and feed live
  fetch, but an env-only provider shows Disconnected in the catalog/UI. Mixed env+DB
  disconnect: DB row deleted → catalog drops provider while env key still executes at runtime.
- Where stale persisted overrides can remain: (1) `unavailable` markers after a free-capable
  provider connects — DELIBERATE (scope note 2; re-run Free to clear); (2) real overrides while
  a failed/empty rebuild serves the last-known catalog (cleared by the next successful
  rebuild's reconcile); (3) ≤1h against upstream model-level removals. Stages without
  overrides are never stale at runtime (resolved fresh per run).

## G. Next safest cleanup task (ONLY)

Delete `app/api/ai/models/route.ts` (consumerless endpoint) + update the stale reference in
`lib/ai/catalog/stageSelection.ts:31`'s comment. Single file, zero callers verified repo-wide,
no import orphaning (all its imports are shared with live modules), no DB/schema touch, no
behavior change for Models page, preflight, or runtime. Verify with `npx tsc --noEmit` +
`npm run build`.
