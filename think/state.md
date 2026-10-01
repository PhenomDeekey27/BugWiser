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

---

# AUDIT — /models selection → runtime provider calls, all 5 stages (READ-ONLY, Sept 26, 2026)

**Status:** ✅ COMPLETE. No code changed (report-only entry). Validation: `npx tsc --noEmit` → 0
errors. Ran against branch `feature/ui-redesign` working tree (commit `db6455e` + uncommitted
UI edits — audit touched none of them).

## A. Persisted model configuration (/models → DB) — VERIFIED
- Setup click: `handleSetupSelect` (app/models/page.tsx:144) → `selectStageModels` → local rows →
  `PUT /api/models/preference` `{selection_mode:'auto', selected_strategy, stage_overrides}` (:178-181);
  strict-Free markers persisted as `{provider:null, model:null, unavailable:true}` (:170-173).
  Manual save: `handleSavePreference` (:202) → same PUT, strategy `setupChoice ?? custom|auto` (:219).
- Server: `saveModelPreference` (lib/ai/preferences.ts:59) upserts `user_model_preferences`;
  `getModelPreference` (:32) is the runtime read. Reload restores overrides + markers and
  `toSetupChoice(selected_strategy)` (page.tsx:99/112-116/138).

## B. Analysis creation loads preference — VERIFIED
- analysis/new `handleStartAnalysis:171` → `handleSaveModel` (:80, auto/manual pref) → preflight
  modal (:179) → `startAnalysisWithStrategy` POSTs `/api/analyses` with `model_strategy` in body
  (:199-203) — **`/api/analyses` IGNORES that body field** (route types only {repository, issue},
  route.ts:18-28). Route instead reads `user_model_preferences.selected_strategy` (:47-51) and maps
  `balanced|quality → 'custom'` (:55-56) — forced by `analyses.model_strategy` CHECK
  ('free','free_paid','fully_paid','custom','auto' — migrations 006:5, 013). Concrete picks are NOT
  copied onto the analysis row; they flow fresh per stage at runtime (C).
- POST `/api/analyses/:id/run` → `runAnalysisInitialization` (runner.ts — GitHub/tree/fingerprint,
  no AI calls).

## C. Runtime resolution — VERIFIED (fresh per stage, per run)
1. Stage route (auth + ownership + status gate) → `run*` — 5/5 wired (relevant-files:66,
   root-cause:51, evidence:51, solution:51, patch:51) → `generate({task})` with exact keys
   (relevant-files:171, root-cause:126, evidence:126, solution:131, patch:137).
2. `gateway.generate` (gateway.ts:48) → `resolveAnalysisRouting(userId, task)` (routing.ts:51):
   credentials (env-first, then DB decrypted keys — service.ts:115-151) + `getModelPreference` →
   `resolveStageOverride` (:31-39); **null-guard :37 — unavailable markers → no override**.
3. Gateway reads `analyses.model_strategy` per call (:56-61) → `runWithFallback` (model-router:204).
   Chain built at :232-280: **stage-override > manual > strategy-assignment > autoChain** (deduped).
4. Availability gate :292 (provider must be env-configured or hold a user token, :191-202); error
   loop :291-389 — auth/invalid-request THROW (no silent swap, :343/:353), model-not-found,
   context-too-large, rate-limit, server errors fall through; chain exhausted → lastError or clean
   "No configured providers available" (:391-396).
5. `provider.generate` (:310) → `providers/registry.createProviderInstanceWithApiKey`.
6. Bookkeeping both sides: `recordStageAssignment` → `analyses.model_selection` (gateway:95) and
   `recordModelExecution` (actual provider/model/tokens/fallbackCount — e.g. root-cause.ts:162).

## D. Five-stage end-to-end — VERIFIED
Task keys identical at every layer: routing `ANALYSIS_TASK_IDS` (:22-28) == config `TASK_TYPE_MAP`
(:27-33) == /models STAGES == the 5 stage-file literals (grep 5/5). Each stage resolves its own
override and executes through the same gateway path.

## E. Free-unavailable marker at runtime — VERIFIED (never executes; engine re-picks)
- Marker → routing:37 null → chain = strategy assignment + autoChain.
- `analyses.model_strategy='free'` (Free passes the B-map) → engine free build
  (strategy-selection:45-78) skips a stage ONLY when no registry-free model is on an available
  provider (:56-62). **The engine has no stage context gate** — it can assign the 128K opencode
  free model to the 200K evidence stage (the gate that created the marker in /models selection).
- Runtime fallback tail is NOT free-gated: `rankModels` sorts free-first (config.ts:97), but the
  Chutes-preferred PAID list heads autoChain whenever chutes is available (config.ts:195-217).
  → strict-Free is enforced at selection + chain-head; NOT during runtime error-fallback
  (engine-parity debt, scope note 4 — re-confirmed here).

## F. Provider disconnect at runtime — VERIFIED
- Env asymmetry re-confirmed: env key alone keeps a provider executable (service.ts:117-121;
  buildAvailableProviders counts env) while UI shows Disconnected.
- Override whose provider disconnected: routing still returns it (no credential check in routing),
  model-router skips at :292 → next candidate runs; /api/models reconcile drops it from the UI.
- Nothing executable → clean "No configured providers available" (:391).
- Revoked/expired key at call time → `auth` category throws immediately (:343-351): stage
  hard-fails rather than silently switching models (by design).

## G. Manual configuration — VERIFIED, ONE DISCREPANCY (Finding 1)
- Manual set via analysis/new `handleSaveModel:80` (selection_mode manual + provider/model);
  runtime routing.ts:69-92: provider connected → `manualModel` heads the chain, fallback only on
  recoverable failures.
- **Finding 1 — intent ≠ behavior: manual + provider DISCONNECTED returns `runArgs:{providerTokens}`
  (no manualModel) with reason "No fallback to a different model" (:77), yet runWithFallback then
  takes the strategy+autoChain branch (model-router:251-280) and RUNS OTHER MODELS.
  `manualFallbackOccurred` cannot fire (selected=null → gateway:84-85 false), so it is silent.**

## H. Competing/dead resolvers — VERIFIED gone/contained
- `lib/ai/model-catalog/*`, `lib/ai/orchestration/*`, `app/api/debug/selection` — deleted (globs 0).
- Preflight (`app/api/analysis/preflight/route.ts pickForStage`) is LIVE as a modal but its tier
  pick is display-only (body ignored — B; `selectedStrategy` state in analysis/new is write-only).
- `/api/ai/models` still consumerless (deletion candidate, §G above).

## I. Verified findings (report-only; nothing changed)
1. **Manual+disconnected fallback discrepancy** (G) — message promises no fallback; code falls
   back silently to the strategy chain. Decide intent, then align message or behavior.
2. **Strict-Free not enforced in runtime fallback tail / engine context gates** (E) — known
   parity debt (scope note 4), re-confirmed with the chutes-first autoChain detail.
3. **Preflight tier pick cosmetic** (B/H) — wire deliberately or drop from the flow's mental model.
4. **Chutes-preferred PAID models head autoChain** whenever chutes is connected (config.ts:195-217)
   — affects fallback order for every non-overridden/marker stage (by design, Free-relevant).
5. **Late enum validation**: direct PUT with an out-of-enum `selected_strategy` is rejected only at
   analysis insert (DB CHECK → 500), not at the preference API — robustness gap, pre-existing.
**Overall verdict: the /models → preference → analysis → task → gateway → routing → model-router →
provider chain is INTACT and end-to-end for all five stages; every selection and actual execution
is persisted (`user_model_preferences`, `analyses.model_strategy`, `analyses.model_selection`,
per-attempt execution rows).** Findings 1–5 are the only deltas; none blocks the flow.

---

# STRICT FREE RUNTIME ENFORCEMENT — IMPLEMENTED + VALIDATED (2026-09-26)

## Design (as implemented)

- `strictFree = routing.selectedStrategy === 'free' && routing.selection.mode === 'auto'`
  (LIVE preference, not `analyses.model_strategy` — because analysis starts used to reset the
  stored strategy; see PUT fix below). Manual mode intentionally outside strict Free.
- Enforcement boundaries: gateway (`prepareStrictFreeRun` drops paid/unknown stage overrides)
  + `buildRunChain` (strict branch ignores autoChain/strategy assignments) + availability gate
  at model-router:292 (unchanged). Single canonical free source = `price.isFree`
  (`isConfirmedFreeModel`); candidates = canonical `buildAutomaticPool` + `STAGE_CONTEXT_MIN` →
  `scoreOrderedPool` → free filter (`getFreeStageCandidates`).
- Marker (null/null + `unavailable`) + strictFree → structured `noFreeModelError`:
  "No free model is available for this stage (task: X) — detail. The Free strategy never falls
  back to paid models." Chain exhaustion → "All eligible free models failed … Last error: …".
  Auth errors still throw immediately (no paid escape). Non-strict paths byte-for-byte unchanged.

## Files changed

- `lib/ai/catalog/stageSelection.ts` — extracted `scoreOrderedPool()` (shared with
  `selectForStage`); added `getFreeStageCandidates`, `isConfirmedFreeModel`,
  `prepareStrictFreeRun` + `StrictFreeRunPlan`.
- `lib/ai/catalog/toCatalogModel.ts` — NEW shared `ClassifiedModel → CatalogModel` mapping.
- `app/api/models/route.ts` — uses shared mapper.
- `lib/ai/routing.ts` — `ResolvedRouting` += `selectedStrategy`, `stageOverrideUnavailable`;
  marker filled (auto mode only) in both return branches.
- `lib/ai/gateway.ts` — strictFree gate; marker skips catalog; `prepareStrictFreeRun` plan;
  passes `strategy:'free'`, `strictFree`, `freeCandidates`, `stageOverrideUnavailable`.
- `lib/ai/model-router/index.ts` — `RunRequest` += strict-free fields; exported pure
  `buildRunChain` (strict branch + verbatim non-strict logic); `noFreeModelError`; strict
  end-of-loop errors; log line adds `(STRICT FREE)`.
- `app/api/models/preference/route.ts` — **PUT now preserves stored `selected_strategy` when the
  body omits it** (`body.selected_strategy ?? (await getModelPreference(user.id)).selected_strategy`).
  Required: `handleSaveModel` (analysis/new) PUTs without the field, and old code reset it to
  `'auto'` — the live row proved it (`selected_strategy:'auto'` + free overrides + evidence
  marker, updated 06:18). Without this fix strict Free would never engage.

## Validation (all recorded 2026-09-26)

- `npx tsc --noEmit` → **0 errors** (with and without probe files present).
- `npm run build` → ✓ Compiled, TypeScript pass, 16/16 pages.
- `npm run lint` → 12 errors / 28 warnings; ALL 12 in untouched files
  (analyses/route.ts ×4, models/page.tsx ×7, model-intelligence/index.ts ×1) — zero new
  (baseline 15 → 12; old inline `any` mapping removed with toCatalogModel).
- Fixture probe `scripts/probe-strict-free.ts` (temp, deleted after this record):
  **28/28 PASS** — A1–A5 candidate pool (evidence 200K gate → free-only / [] when none;
  first candidate === `selectForStage('free')` pick), B1–B4 canonical free check
  (paid/unknown/missing → false), C1–C4 plan (free override kept; paid & unknown override
  DROPPED; unknown task safe), D1–D9 chain composition (TEST1 override-first + whole strict
  chain free + autoChain never present; TEST2 marker → structured throw, empty pool → throw;
  TEST3 remaining candidates all free; TEST4 disconnected provider skipped, no paid
  substitution, paid override dropped; TEST5/6 non-strict override/strategy chains unchanged;
  TEST7 non-strict manual chain unchanged; PART6 marker without strictFree unchanged),
  E1 global invariant (every entry of every strict chain is confirmed-free).
- Live read-only probe on the REAL preference row + freshly built catalog:
  discovery/root-cause/solution/patch → 4-entry chains, override first, **all opencode free
  models**; evidence (marker) → STRUCTURED FAILURE with the exact no-free-model message;
  `LIVE RESULT: 4 free chains (all-free: true), 1 structured unavailable`.
- Probe files deleted after recording (scripts/ left empty); post-deletion tsc + build re-run clean.

## Runtime behavior summary (strict free)

- free + valid override → chain = [free override, …free candidates], autoChain/engine skipped.
- free + marker → immediate structured stage failure (relevant-files/root-cause/evidence/
  solution/patch all catch → `status:'failed'` + `error_message` — verified at
  relevant-files.ts:283-291, evidence.ts, root-cause.ts, solution.ts, patch.ts).
- free + primary failure → next free candidate only; exhaustion → structured
  "All eligible free models failed …"; disconnect → skipped (no paid replacement);
  auth → immediate throw. Balanced/Quality/manual → byte-for-byte unchanged chains.

## Remaining issues (post-implementation)

1. Existing wiped rows (`selected_strategy:'auto'` + free overrides): re-apply Free on /models
   once; recurrence prevented by the PUT fix. Self-heal migration deliberately NOT added.
2. Manual + disconnected (audit Finding 1) unchanged — out of scope.
3. Auth-error short-circuit under free throws (no paid escape) — by design, documented.
4. Strict Free overrides are not re-gated by stage context (Configure design); overflow →
   error loop → next free candidate.
5. Late enum validation at preference API (audit Finding 5) unchanged.

---

# GITHUB SESSION-EXPIRATION CONSISTENCY FIX — IMPLEMENTED + VALIDATED (2026-09-26)

## PART 1 — Source of truth (audit result)

- Canonical auth: Supabase session via `@supabase/ssr` (`lib/supabase/{client,server}.ts`,
  cookie-based). `proxy.ts` middleware = route protection (`supabase.auth.getUser()`).
- Canonical GitHub-session condition (already used by repos route:19, issues route:32,
  dashboard:81, old SessionExpiryCheck): **session exists && `session.provider_token` present**.
  Verified in `@supabase/auth-js` source: `provider_token` is set only in
  `_getSessionFromURL` (OAuth sign-in); refresh (`_callRefreshToken` → `_sessionResponse`)
  never carries it — so after a Supabase token refresh the GitHub connection is unusable and
  the app's existing answer is "sign in again".
- Stale UI sources (root cause): (a) Sidebar "GITHUB CONNECTED" was HARDCODED (Sidebar.tsx:88,
  always rendered); (b) header/sidebar received `user` from one-shot page state derived from
  `user.user_metadata`, which outlives `provider_token`; (c) no global detector — expiry was
  handled piecemeal (/analysis/new inline card, dashboard `redirect('/')`, home-only
  SessionExpiryCheck); (d) no auth-event subscription anywhere (nothing reacted to
  TOKEN_REFRESHED/SIGNED_OUT).

## Implementation (files changed)

- NEW `lib/supabase/auth-session.ts` — single module: `isGitHubSessionValid()` (canonical
  predicate), `invalidateGitHubSession(router)` (the ONE flow: signOut + remove
  `analysis-selection` + `router.replace('/auth/github?error=…')`; guard: never redirects when
  already on /auth/github; in-flight dedupe), `useGitHubAuthValidity()` hook (initial `true` to
  avoid hydration flash; `getSession` + `onAuthStateChange`; SIGNED_OUT → false, TOKEN_REFRESHED
  re-evaluated).
- `components/landing/SessionExpiryCheck.tsx` — rewritten as GLOBAL detector: mounts in root
  layout, initial check + auth-event subscription; triggers only when `session &&
  !provider_token` (null session = signed-out, NOT expiry); SIGNED_OUT skipped (own sign-out /
  invalidation in progress).
- `app/layout.tsx` — mounts `<SessionExpiryCheck />` for every page; `app/page.tsx` — local
  instance removed (was home-only).
- `proxy.ts` — existing protection extended: protected paths + `session && !provider_token` →
  307 `/auth/github?error=…` BEFORE page render (no stale flash). `!user` → bare
  `/auth/github` (unchanged). No signOut in middleware (client clears on the auth page).
- `components/layout/Sidebar.tsx` — status row gated on `useGitHubAuthValidity()`; invalid →
  existing unauthenticated pattern ("Continue with GitHub" button, HomepageHeader style);
  avatar/@login row only when connected + user present.
- `components/layout/TopBar.tsx` — same gate: valid → existing avatar/dropdown/@login; invalid
  → "Continue with GitHub" (no stale avatar/username; dropdown unmounts).
- `components/landing/HomepageHeader.tsx` — `displayUser = authValid ? user : null` (home header
  reacts too).
- `app/analysis/new/page.tsx` — repos 401 and issues 401 → `invalidateGitHubSession(router)`
  (shared flow); inline `authExpired` card + `handleReLogin` + Button import removed; effect
  deps += `router`.
- `app/dashboard/page.tsx` — `tokenExpired` → `/auth/github?error=…` (was `/`); `!user`
  fallback → `/auth/github` (was `/`).

## Validation (2026-09-26)

- `npx tsc --noEmit` → 0 errors. `npm run build` → exit 0 (compile + TS + 16/16 pages).
- `npm run lint` → 12 errors / 28 warnings = EXACT baseline (zero new; +2 warnings during
  work were fixed by adding `router` deps).
- **Live probe (temp script, deleted; temp Supabase user, deleted): 10/10 PASS** against dev
  server with crafted cookies (`sb-<ref>-auth-token` = `base64-`+base64url(session JSON)):
  1. no session: /dashboard → 307 /auth/github (bare) [existing behavior kept]
  2-4. session WITHOUT provider_token: /dashboard, /analysis/new, /analysis/[id] →
     307 /auth/github?error=Your+GitHub+session+has+expired… (TEST 3 prompt, pre-render)
  5. same session on /auth/github → 200 (no loop, TEST 7)
  6-7. same session on public / and /models → 200 (middleware untouched there)
  8. session WITH provider_token: /analysis/new → 200 (TEST 1 server-side)
  9. GitHub rejects token (api.github.com 401 from dummy token): /dashboard →
     307 /auth/github?error=… (GitHub-API-401 detection path)
  10. /models with valid-looking session → 200 (no false redirect)
- Manual (browser) tests — client-side flows, documented for verification: TEST 2/4 (header +
  sidebar clear on expiry: SessionExpiryCheck signOut → useGitHubAuthValidity false →
  connected row/avatar replaced by Continue-with-GitHub → redirect), TEST 5 (re-auth:
  SIGNED_IN with provider_token → hooks true + fresh server render), TEST 6 (repos/issues 404/
  403/500/network → generic error only; code branches on `status === 401` exclusively).

## Flow (as implemented)

session expired (provider_token gone, incl. after token refresh)
→ detected by: middleware (protected paths, pre-render) | SessionExpiryCheck (global, mount +
  TOKEN_REFRESHED) | GitHub API route 401 handlers (/analysis/new) | dashboard GitHub /user 401
→ `invalidateGitHubSession`: signOut (Supabase session only — model prefs, AI providers,
  user data untouched) + remove `analysis-selection` + validity hook flips false (sidebar/
  header clear instantly, same tab)
→ `router.replace('/auth/github?error=…')` (AuthCard shows the message via its existing
  `?error=` mechanism; no Sonner needed on the auth page)
→ loop-safe: /auth/github never redirected (middleware doesn't protect it; client clears but
  returns early); after signOut no session → predicates false; SIGNED_OUT never re-triggers.

## Diff safety (this task)

- AI model selection/routing/Free-Balanced/Quality, stage selection, provider connections,
  pricing/catalog, runtime fallback, local LLM: NOT touched (lib/ai/* and app/api/models/*
  diffs in the tree are the previous strict-Free task's uncommitted work).
- No new auth library (still only @supabase/ssr + @supabase/supabase-js); OAuth flow
  (`AuthCard`, `auth/callback`) unchanged; no UI redesign — reused `btn-bw-primary` and the
  existing HomepageHeader unauthenticated pattern.
- Route-protection SCOPE unchanged (same protectedPaths; /models still not middleware-
  protected — pre-existing).

## Known limitations / notes

1. Client-side flows (SessionExpiryCheck redirect, sidebar/header clearing) require a real
   browser session — verified by code-path review + build; server matrix probe-verified.
2. GitHub-revoked token WHILE cookie still holds provider_token: dashboard server check
   catches it → /auth/github (cookie cleared only after re-auth there) — rare edge, re-auth
   resolves; no stale page ever renders (server redirect is pre-render).
3. Hourly-ish expiry cadence (provider_token dropped on Supabase refresh) is the app's
   pre-existing auth semantics — deliberately NOT redesigned per task constraints.
4. Background analysis runners hitting GitHub 401 mid-run record stage errors (existing
   architecture); they do not trigger global logout — navigation/middleware catches it next.

---

# MODEL SELECTION CORRECTNESS AUDIT — READ-ONLY (2026-09-26)

**Status:** ✅ COMPLETE (report-only; zero production code changes). Branch `feature/ui-redesign`,
HEAD `6372dbb`, tree clean. Validation: `npx tsc --noEmit` → 0 errors; `npm run build` → exit 0
(✓ Compiled); `npm run lint` → 12 errors / 28 warnings = EXACT baseline. Temp probes
(`scripts/probe-selection-audit.ts`, `scripts/probe-live-mismatch.ts`) run → recorded → DELETED;
scripts/ empty. Live access was read-only (getOrBuildCatalog on the existing 27-min-fresh row —
no rebuild triggered; same load as /models GET).

## Method

- Full re-read of the current selection system: stageSelection (weights/gates/pool/picks/strict-free),
  strategy-selection (engine modes), config (autoChain/rankModels/TASK_WEIGHTS), cost +
  stageTokenProfiles, modelSignals, catalog registry, normalizers (free authority),
  model-intelligence (discovery/scoring/classification/persistence), toCatalogModel,
  overrideReconcile, preferences, routing, gateway, model-router, models page, /api/models.
- Probe contained an INDEPENDENT spec re-implementation (grouping → gate → cap → score-order → setup
  pick, written from the spec comments) compared cell-by-cell against the real implementation;
  plus fixture scenarios A–H, boundary/pricing/tie/family/reconcile/runtime-chain cases, and the
  live catalog. 53 checks: **52 PASS / 1 FAIL** (the FAIL = Finding 1 below).

## Probe results (recorded evidence)

- **PART 7 scenarios A–H** (A: 1 provider mixed; B: 2 providers free only on p1; C: free on both;
  D: flood 12 near-dups + 8 distinct + rival provider; E: no free; F: unknown-pricing only;
  G: empty catalog; H: free all below context gate): impl===spec **120/120** cells
  (8 × 3 setups × 5 stages); Free never selected a non-isFree model (0 violations).
  Notable outcomes: A/evidence Free = UNAVAILABLE (131K free < 200K, paid sibling never used);
  E+H Free = UNAVAILABLE on all 5; G → null everywhere; D flood → 11 near-dups collapse to 1 pool
  representative, provider cap pF=5, free winner = pG/rival-free; F balanced/quality pick best
  stage score (all-unknown cost tier, documented); D/F evidence (paid setups) = null (pool empty
  after 200K gate — null semantics kept for Balanced/Quality).
- **PART 9 boundaries:** gate is exact `>=` at 31,999/32,000/32,001 (discovery/solution/patch),
  127,999/128,000/128,001 (root cause), 199,999/200,000/200,001 (evidence) — 15/15 PASS;
  unknown-context (default 128K) correctly excluded from evidence.
- **PART 10 pricing:** cost helper 6/6 (isFree→$0; null→unknown never $0; linear formula exact;
  zero-input/nonzero-output → priced; negative → unknown; isFree+null numerics → $0);
  Balanced: known-priced beats unknown at +1 quality (worst-tier penalty); Quality: cheaper wins
  within the 5-pt tolerance, 35-pt capability gap → strong model wins; Free ranking ignores price.
- **PART 11 determinism:** 1,050 shuffled runs (7 scenarios × 3 setups × 50 seeds) byte-identical;
  live 6 shuffled runs × 3 setups identical; all ties break by `localeCompare(provider/model)` asc
  (equal-score/value/cost → earliest pool entry wins — free, balanced, quality all verified).
- **PART 12 family grouping:** 7/7 key expectations (tier/quant/date/instruct suffixes group with
  base; `-pro` vs `-flash`, `glm-4.6` vs `glm-4.7` stay distinct; keys provider-scoped);
  flood family → exactly 1 pool entry; cap ≤5; rep priority available > cheaper > longer-ctx > ID;
  **rep-then-gate demo**: free 65K `:free` rep wins family → 128K gate drops THE FAMILY →
  qualified paid 264K sibling never eligible (gate-first control keeps it) — Finding 3.
- **PART 8 add/remove:** removing provider pB → balanced/quality re-pick from pA (free unchanged);
  reconcile drops ONLY the pB override, keeps the unavailable marker + healthy entry verbatim
  (`changed:true`); re-adding pB does NOT resurrect the dropped override (`changed:false`) —
  stage correctly stays automatic.
- **PART 14 runtime consistency (pure):** freeCandidates[0] === setup Free pick 5/5 (fixture) and
  5/5 (live); prepareStrictFreeRun drops paid override (warn logged) / keeps confirmed-free;
  strict chain = [free override, …free candidates] with paid autoChain ignored; marker and
  empty-pool both throw the structured "No free model is available for this stage …" error;
  non-strict chain unchanged (stage override > autoChain, deduped: `p1/alpha-pro >
  chutes/chutes-paid-1 > p2/beta-max`); engine free mode assigns 128K opencode model to evidence
  while setup Free on same data = UNAVAILABLE (Finding 4); non-strict autoChain heads paid
  chutes/Qwen3.5-397B-TEE with 7 registry-free models present (Finding 5).
- **PART 13/16 live catalog** (user 9efb32ca-ed01-44c5-bae6-6e6202653c3e, 202 models,
  classifiedByAi=false, byProvider {opencode:81, openai:64, gemini:28, chutes:14, zai:12, deepseek:3};
  priceSource live 14 / registry 8 / unknown 180; isFree=4; ctx exact-128K=159, range 40,960–1,048,576):
  impl===spec **15/15**; distinct score tuples **24/202**; dominant default tuple (30,21,50,55)
  = **153/202 (75.7%)**, 152 of them live/unknown-price; flat tuples 0; exactly-50/50/50/50 = **0**
  (historical zip-fill corruption is gone). Live winners: Free → mimo-v2.5-free (4 stages),
  nemotron-3-ultra-free (root cause), evidence UNAVAILABLE (all 4 confirmed-free are 128K < 200K);
  Balanced = Quality = chutes/Qwen3-235B-A22B-Thinking-2507-TEE on all 5 stages (one model wins
  every stage on genuine score+value dominance — allowed, not a diversity violation).

## Findings (report-only; nothing changed)

1. **`MODEL_REGISTRY.free` ≠ canonical `price.isFree` — 5 live mismatches (the probe's only FAIL).**
   - `chutes/Qwen/Qwen3-32B-TEE`: registry `free:true` vs catalog live price **$0.104/$0.416** AND
     static **$0.08/$0.24 (isFree false)** — hard conflict, two price sources agree it is paid.
   - `zai/glm-4.7-flash`, `zai/glm-4.7`: registry true; catalog unknown pricing → not free
     (static glm-4.7-flash null/null, isFree false).
   - `opencode/ling-3.0-flash-fin-free`, `opencode/muse-spark-1.2-contributor-free`: registry true;
     live price unknown; absent from static registry.
   Scale: MODEL_REGISTRY carries 32 `free:true` flags; only 9 are present in this catalog and only
   **4 catalog-confirmed**. Reach: (a) engine free mode (`strategy-selection.ts` free build) when
   `analyses.model_strategy='free'` snapshot outlives a live strategy change (strictFree=false →
   engine runs); (b) `config.rankModels` free-first sort — autoChain ordering on every non-strict
   run. NOT reachable under engaged strict Free (gateway/model-router use the catalog as canonical).
   Fix direction: derive engine/chain free status from the catalog-confirmed set (single truth) or
   reconcile `registry.free` at catalog load; correct the chutes 32B flag first.
2. **Score trust: 75.7% of the live catalog shares one identical tuple (30,21,50,55).**
   152/153 are live rows with unknown pricing → identical stageScore AND identical valueScore (40)
   → their relative order is pure provider/model ID. Only ~49 rows (static-registry blend or
   distinctive metadata) discriminate (24 distinct tuples total); AI classification skipped by design
   (>80 models). Impact: on providers lacking static entries (opencode: 81 models) Balanced/Quality
   can only rank curated static models above the interchangeable default-tuple mass. Scores are
   metadata-honest but mostly NON-discriminating; ties resolve deterministically but capability-blind.
3. **Family rep-then-gate ordering can exclude a qualified sibling** (`stageSelection.ts
   buildAutomaticPool` order: grouping → STAGE_CONTEXT_MIN → cap): representative chosen by
   available > confidence > cost > ctx > ID BEFORE the gate; verified experimentally that a cheaper
   65K `:free` variant wins the family over its paid 264K sibling, then the 128K gate removes the
   whole family from a root-cause pool (gate-first control leaves the sibling eligible). The order is
   spec-documented; impact limited to Balanced/Quality pools of near-dup same-family models (Free
   unaffected — sibling is paid anyway). Low severity; fix direction: choose the representative among
   gate-passing members (or gate first, then group).
4. **Engine context-gate divergence quantified** (known debt, scope note 4):
   `buildStageAssignments('free', {opencode})` assigns `opencode/nemotron-3-ultra-free` (128K) to the
   200K evidence stage while setup Free on the same catalog = UNAVAILABLE. Reachable only when the
   row snapshot says 'free' but strictFree is disengaged (path shared with Finding 1a).
5. **Non-strict autoChain heads PAID** `chutes/Qwen/Qwen3.5-397B-A17B-TEE` for root-cause while 7
   registry-free models exist on chutes+opencode (chutes-preferred list, config.ts:195-217) —
   known debt, re-quantified; engaged strict Free unaffected (autoChain skipped).
6. **Name-vs-truth (UX note):** 9 `-free`-named models in catalog, 6 NOT confirmed free (all
   opencode, price unknown) — correctly excluded from Free by the canonical unknown≠free rule;
   users may still expect them selectable as free.
7. **Empty catalog under Free returns `null`, not an unavailable marker** (`selectForStage` early
   return before the setup branch) — unreachable via UI (page blocks with a toast when
   libraryBaseModels is empty). Documented edge, no action needed.

## Verdict

Free/Balanced/Quality selection is deterministic, spec-conformant (**135/135 impl===spec cells**,
120 fixture + 15 live), context-gate- and pricing-correct, family-grouping-correct, provider add/
remove-consistent, and runtime-consistent with setup (strict-free chains and non-strict override
chains byte-match what /models persisted). One real correctness defect (Finding 1: split free-truth
between registry and catalog), one structural limitation (Finding 2: 76% score tie mass), and five
documented edge/debt items (Findings 3–7).

---

# FREE AUTHORITY UNIFICATION — catalog price.isFree is THE source (2026-09-26)

**Status:** ✅ COMPLETE. Fixes audit Finding 1 ONLY (conflicting Free metadata sources); all other
audit findings deliberately untouched (PART 8). Branch `feature/ui-redesign`.
Files changed (5): `lib/ai/model-registry.ts`, `lib/ai/config.ts`,
`lib/ai/strategy-selection.ts`, `lib/ai/model-router/index.ts`, `lib/ai/gateway.ts`
(plus this entry). `stageSelection.ts`, `overrideReconcile.ts`, `cost.ts`, normalizers,
setup algorithms, Balanced/Quality logic: UNTOUCHED.

## Root cause

`MODEL_REGISTRY.free` (runtime routing registry, hand-maintained) and catalog `price.isFree`
(normalizer-stamped from live/static pricing) were TWO independent free authorities. Runtime paths
(engine `free`/`free_paid`/`fully_paid` filters, `rankModels` free-first autoChain sort, assignment
`isFree` labels) read the registry; setup/strict-Free read the catalog. 5 live models disagreed
(worst: `chutes/Qwen/Qwen3-32B-TEE` free:true vs static $0.08/$0.24 AND live $0.104/$0.416).

## What changed

1. **`model-registry.ts`** — header now states free status is NOT defined here; 5 conflicting
   flags corrected to `free: false` AFTER probe verification (chutes 32B: static 0.08/0.24 +
   live 0.104/0.416 both isFree:false; zai glm-4.7-flash/glm-4.7 + opencode ling-3.0/muse-spark:
   catalog pricing unknown → not confirmed free). Dead parallel-authority export
   `getFreeModels()` deleted (zero callers). Unverifiable entries left as metadata only:
   21 openrouter registry-free rows + `zai/glm-4.7-flashx` + `opencode/hy3-free` are ABSENT from
   this user's catalog → never treated as free (absent ⇒ not in canonical set).
2. **`config.ts`** — `rankModels`/`selectModelsForTask` gained optional `confirmedFreeIds`
   (provider/model keys); free-first autoChain sort now keys off that set. No set ⇒ no free
   preference (conservative). `MODEL_REGISTRY.free` no longer read.
3. **`strategy-selection.ts`** — all five modes (`free`, `free_paid`, `fully_paid`, `custom`,
   `auto`) + `applyStageOverrides` + `buildAutoAssignments` + `buildStageAssignments` take
   `confirmedFreeIds` and classify free exclusively via `isConfirmedFree()` (set membership).
   No set ⇒ nothing confirmed free. No registry reads remain.
4. **`model-router/index.ts`** — `RunRequest.confirmedFreeIds` plumbed into `selectModelsForTask`
   (autoChain) and `buildStageAssignments` (engine) on non-strict runs; ignored under strictFree
   (chain comes from `freeCandidates` — unchanged).
5. **`gateway.ts`** — ONE catalog load per generate (the load strict Free already did) now also
   runs for non-strict modes; derives `confirmedFreeIds` from `price.isFree` and passes it down.
   Strict-Free semantics identical: marker stage still skips the load (fail fast); strict load
   errors still propagate; non-strict load errors are caught → warn → empty set (nothing counts
   as confirmed free; stage never fails). Cost note: non-strict generate now pays the same
   cheap persisted-catalog read strict Free already paid (rebuild only on fingerprint mismatch/
   absence, as before).

**Free authority (single definition):** catalog model → `price.isFree`, stamped by the pricing
normalizers (live payload, static fallback via `isExplicitlyFree`/`applyStaticFallback`), read
through `toCatalogModel`. Setup (`stageSelection`) already used it; runtime now receives the same
truth as a Set. No second flag created; no name/provider/missing/unknown pricing inference.

## Probe (temp `scripts/probe-free-authority.ts` — run pre-fix AND post-fix, DELETED; scripts/ empty)

- **PRE (verification before editing): 30 checks, 0 failures.** chutes 32B static {0.08,0.24,
  isFree:false} + live {$0.104,$0.416, live, isFree:false} vs registry.free=true → conflict
  verified from both pricing authorities. Census reproduced audit exactly: 5 conflicts
  (chutes 32B; zai glm-4.7-flash/glm-4.7; opencode ling/muse), 32 registry-free total,
  4 catalog-confirmed (opencode mimo/nemotron-ultra/big-pickle/nemotron-3.5-lightning).
  Golden recorded: Free picks mimo ×3 + nemotron-ultra(root) + evidence UNAVAILABLE;
  Balanced=Quality=chutes/Qwen3-235B-A22B-Thinking-2507-TEE ×5; PRE autoChain root head showed
  registry-free-boosted zai rows after the chutes-preferred block.
- **POST: 30 checks, 0 failures.** Census **0 conflicts / 0 reverse** (table below); registry-free
  count 32 → 27 (5 corrected). Setup goldens BYTE-IDENTICAL (Free/Balanced/Quality). Strict-Free:
  paid override dropped, confirmed-free override kept, marker + empty chains throw structured
  errors, strict chain ⊆ canonical set (paid autoChain ignored). Engine `free` picks all
  canonical, empty-set ⇒ 0 assignments, never selects a known conflict. autoChain: chutes-first
  head unchanged; no conflict free-boosted; **filter-equality proof** — non-free chain order
  identical with vs without the canonical set (conflicts gained zero privilege). `fully_paid`
  excludes canonical-free (set-driven), `free_paid` free stages canonical + unknown-priced zai
  now isFree=false. Manual/override chain heads + reconcile (keep/drop/marker) unchanged.
  First POST run had 2 FAILs — both invalid probe assertions (chutes-preferred head misread as a
  free boost; fully_paid winner asserted instead of pool membership) — assertions corrected,
  code unchanged.

### Provider conflict table (after fix; live catalog, user 9efb32ca, 202 rows)

| Provider | Registry free entries | Catalog-confirmed free | Conflicts | Registry-free absent from catalog |
|---|---:|---:|---:|---:|
| chutes | 0 | 0 | 0 | 0 |
| deepseek | 0 | 0 | 0 | 0 |
| gemini | 0 | 0 | 0 | 0 |
| openai | 0 (no registry entries) | 0 | 0 | 0 |
| opencode | 5 | 4 | 0 | 1 (`hy3-free`) |
| openrouter | 21 | 0 | 0 | 21 (provider not in this catalog) |
| zai | 1 (`glm-4.7-flashx`) | 0 | 0 | 1 |

"Absent" ≠ conflict: no catalog row means no disagreement — and absent models are NEVER treated
as confirmed free (not in the set). OpenRouter rows unverifiable without a connected catalog;
runtime unaffected (set governs).

## Validation (2026-09-26)

- `npx tsc --noEmit` → **0 errors** (also clean with probe present pre-deletion).
- `npm run build` → exit 0 (✓ Compiled successfully).
- `npm run lint` → **12 errors / 28 warnings = EXACT baseline** (40 problems, zero new).
- Probe PRE 30/30 PASS, POST 30/30 PASS (recorded above), deleted; `scripts/` empty.
- `git status`: exactly the 5 listed lib/ai files + this state.md.

## Scope discipline (this task)

- NOT changed (deferred per task): 153/202 identical tuples, family rep-then-gate,
  free_paid compatibility semantics, engine context-gate parity, chutes-first autoChain,
  `-free` naming UX, empty-catalog marker edge, late enum validation.
- Setup Free/Balanced/Quality algorithms, stage weights, context thresholds, pricing,
  provider cap, grouping, tie-breaks: untouched. Strict-Free contract: byte-identical
  (probe §E + gateway control flow).
- Behavioral delta vs PRE (intended): non-strict autoChain free-first boost now only for
  catalog-confirmed free (zai/ling/muse/chutes-32B lost the boost — verified order-identical
  otherwise); engine free/free_paid/fully_paid classify via the set (unknown/absent ⇒ paid,
  conservative); non-strict runs load the catalog (cheap persisted read; failure ⇒ empty set).

---

# FAMILY GROUPING vs CONTEXT GATE — ORDERING FIX (2026-09-26)

**Status:** ✅ COMPLETE. Fixes audit Finding 3 ONLY (rep-then-gate can drop an eligible sibling);
all other audit findings deliberately untouched. Branch `feature/ui-redesign`.
Files changed (this task): `lib/ai/catalog/stageSelection.ts` only (plus this entry).
Free semantics, confirmedFreeIds, pricing authority, Balanced/Quality formulas, stage weights,
context minimums, provider cap, scoring order, runtime routing, normalization, catalog
architecture, UI: UNTOUCHED.

## Root cause

`buildAutomaticPool` ordered its gates as family grouping → STAGE_CONTEXT_MIN → provider cap.
The family representative was chosen (available > confidence > cost > ctx > ID) BEFORE the
context gate, so a cheaper/less-contextual variant (e.g. a 65K `:free` twin) could win the
family and then be gated out at a 128K/200K stage — removing the WHOLE family while its
qualified 264K sibling remained on the shelf (audit PART 12 "rep-then-gate demo").

## What changed

1. **Order swap in `buildAutomaticPool`** — now: (1) context sufficiency gate on the full
   available set, (2) family grouping among ELIGIBLE models only (same `modelFamilyKey`,
   same `betterFamilyRepresentative` priority), (3) provider top-N cap (unchanged scoring/
   tiebreaks). Eligibility precedes dedup: an ineligible rep can no longer delete an eligible
   sibling; a family with no eligible member is still excluded entirely (unchanged).
2. **`buildAutomaticPool` exported** (pure function; mirrors the `prepareStrictFreeRun`
   testability precedent) so pool composition can be asserted directly.
3. **Doc comments updated** (StagePick.unavailable, section header, selectForStage pool
   comment, strict-free gates comment) to the new order.

## Edge cases (probe, temp scripts/probe-family-gate.ts, DELETED; scripts/ empty)

1. family 65K+264K @200K → PRE: family dropped (bug); POST: 264K sibling = sole rep ✓
2. family 64K+128K @200K → family excluded (no eligible member), unchanged ✓
3. family 200K+264K → exactly one valid rep (ctx tiebreak → 264K), unchanged ✓
4. same family name on two providers → provider-scoped keys, 2 reps, unchanged ✓
5. generations (`delta-4.6` vs `delta-4.7`) → distinct keys, 2 reps, unchanged ✓
6. Free: eligible confirmed-free 264K sibling now reachable (PRE: UNAVAILABLE);
   Free with only an ineligible free model → UNAVAILABLE marker, unchanged ✓
7. Balanced fixture (all pool members pass gate) → winners byte-identical PRE/POST ✓
8. Quality fixture → winners byte-identical PRE/POST ✓

## Live regression (user 9efb32ca, 202 rows, same catalog for PRE and POST)

- at-risk families (straddling the gate) = **0 on every stage** → no family could have been
  lost on this catalog; as predicted, pools and winners are byte-identical.
- Pool sizes PRE = POST: discovery 28, root cause 28, evidence 12, solution 28, patch 28;
  free pool counts 4/4/0/4/4. All 15 winners (5 stages × Free/Balanced/Quality) identical:
  Free → mimo-v2.5-free ×3 + nemotron-3-ultra-free (root) + evidence UNAVAILABLE;
  Balanced = Quality = chutes/Qwen/Qwen3-235B-A22B-Thinking-2507-TEE ×5 (golden match).
- The fix changes behavior ONLY where a family actually straddled a stage gate (T1/T6a
  fixtures); the live catalog has no such family — zero winner churn.

## Validation (2026-09-26)

- `npx tsc --noEmit` → **0 errors**.
- `npm run build` → exit 0 (✓ Compiled successfully).
- `npm run lint` → **12 errors / 28 warnings = EXACT baseline** (zero new).
- Probe PRE: 0 failures (bug reproduced: T1 pool empty, T6a UNAVAILABLE); POST: 0 failures
  (all 8 edge cases + live golden assertions pass). Probe deleted; `scripts/` empty.
- `git status`: stageSelection.ts (this task) + the 5 free-authority files + state.md
  (previous uncommitted task).

## Scope discipline (this task)

- NOT changed: audit Findings 1 (done separately), 2, 4–7; family rep priority rules;
  `modelFamilyKey` behavior; gate thresholds; provider cap; Free unavailable-marker semantics;
  runtime engine/strategy selection (Finding 4 engine gate parity still deferred).
- Only newly-gate-eligible models can enter a pool (T1/T6a); no existing live candidate was
  removed (pool deltas all 0).

---

# CAPABILITY-SCORE QUALITY AUDIT — READ-ONLY (2026-09-26)

**Status:** ✅ COMPLETE (report-only; ZERO production code changes). Temp probe
`scripts/probe-capability-audit.ts` (direct DB SELECTs only — never getOrBuildCatalog, no
rebuild/store) run → recorded → DELETED; scripts/ empty. Tree = exactly the 6 previously
uncommitted lib/ai files + this state.md.

## Findings (evidence)

1. **(30,21,50,55) provenance: deterministic fallback scoring over default metadata — the
   recomputed formula matched stored scores 202/202.** `deterministicRank` +
   `computeCoding/Reasoning/Speed/LongContextScore` (`model-intelligence/index.ts:220-339`)
   over models with: no STATIC_MODEL_REGISTRY exact match, all capability flags false,
   contextWindow = 128_000 (the `finalize()` default, normalizers.ts:199), no `NNNb`
   param token in the ID. Arithmetic: coding 25 base +5(ctx≥128K) = 30; reasoning 20−10(no
   reasoning) +round(contextToScore(128K)=55 ×0.2)=11 → 21; speed: activeParamBillions
   null → base 50, ctx penalty 0 → 50; longContext = contextToScore(128K) = 55.
   valueScore = 40 for unknown pricing (index.ts:343). NOT classifier output (classifier
   never ran), NOT registry values, NOT the historical zip-fill 50/50/50/50 (gone).
2. **Convergence quantified:** 153/202 exactly (30,21,50,55) = opencode 77 + openai 64 +
   zai 11 + chutes 1. 24 distinct tuples total; tiers: curated 14 / partial 36 /
   total-fallback 152. priceSource live 14 / registry 8 / unknown 180; ctx==128K 159.
   Provider payload reality (normalizers): opencode/openai/zai expose NO capability,
   pricing, or context fields → flags false + 128K default + unknown price by design
   ("no silent-true defaults").
3. **Classifier: 0/202 AI-classified.** `AI_CLASSIFY_MAX_MODELS = 80` hard cap
   (index.ts:373,376-378) → 202>80 → immediate deterministicRank, applied=false;
   meta.classified_by_ai=false, 0 rows 'ai_classified'. All-or-nothing (no subset
   selection); cap exists because max_tokens 4096 provably truncates >~80 entries (the
   historical 50/50/50/50 corruption source). Secondary gates: no free model ctx≥8000 →
   deterministic; any incomplete output → whole-catalog fallback.
4. **Unused-but-available signals:** 133/152 tuple models on opencode/openai/zai/gemini
   have IDs matching `codingFamilySignal ≥0.5`, but the derivation is wired ONLY into
   openrouter/chutes/deepseek normalizers (normalizers.ts:252/321/484); gemini hardcodes
   coding=false (line 460). 8 tuple models have explicit reasoning tokens (o1/o3/o4) —
   `reasoningFamilySignal` has ZERO callers repo-wide. Registry `scores.speed` is never
   used (`computeSpeedScore` blends no registry data — asymmetry vs coding/reasoning/
   longContext, confirmed: stored 235B speed=73 ≠ curated 3/5 blend). Build-time
   `contextSource`/`capabilityProvenance`/`metadataConfidence` are NOT persisted;
   `CatalogModel.stageFit` always {} (toCatalogModel.ts:39).
5. **Balanced/Quality → chutes Qwen3-235B ×5 is a correct consequence of scoring on this
   metadata, not an algorithm bug.** Balanced: unknown pricing ⇒ penalty +Infinity ⇒ the
   152 unknown-priced tuple models are categorically excluded whenever any known-priced
   candidate exists (stageSelection.ts:299-302; 13/28 known-priced in pool). Quality:
   threshold best−5 excludes the flat mass (e.g. discovery 86.75−5=81.75 vs mass 39.5);
   cheapest-qualified = 235B in all 5 stages (probe: costs $0.0048/$0.0096/$0.0239/$0.0084/$0.0108).
   Its tuple (100,90,73,85) tops every stage (86.75/89.13/85.40/90.38/90.38); runner-up
   397B ties scores but costs more. Free differentiates legitimately (nemotron 77.0 >
   mimo 76.5 root; mimo > nemotron discovery; evidence UNAVAILABLE at 128K<200K).
6. **Stage differentiation:** pools contain 7–15 distinct stageScores (15/28 discovery,
   7/12 evidence); weights differentiate (Free picks differ by stage), but the 153-mass is
   flat 39.5 everywhere, unknown-pricing exclusion removes 180 from Balanced/Quality, and
   one registry model leads coding+reasoning+speed on every stage — so paid setups resolve
   identically. Structure supports legitimate differentiation; metadata coverage does not.
7. **Incidental:** meta.model_count=163 ≠ rows=202, all rows share one fingerprint →
   ~39 stale leftover rows (upsert + fingerprint-delete never prunes vanished models when
   the provider set is unchanged; storeCatalog.ts:489-523) — inferred, separate concern.

## Root cause classification: F = B + C + D (+E)

B capability-metadata generation (ID-derived coding not wired for 4 providers;
reasoningFamilySignal dead code), C classifier coverage (0/202 due to hard cap),
D fallback/default metadata (128K default + false-by-default flags → exact tuple),
E provider payload poverty (opencode/openai/zai genuinely carry nothing) — A scoring bug
NOT supported (formulas deterministic, reproduce 202/202; unknown-worst-tier is deliberate
documented design), G not applicable (code comments state the discrimination goal the
current state contradicts).

## Recommended next task (NOT implemented)

Extend deterministic ID-derived capability signals (coding + reasoning family, same
conservative rules as openrouter/chutes/deepseek) to the opencode/openai/zai/gemini
normalizers; then re-enable AI classification in ≤80-model batches keeping the
complete-output-only rule. No scoring changes, no name-based free inference, no fake
benchmarks.

## Validation

Read-only: no tsc/build run (nothing to verify — probe deleted, scripts/ empty,
git diff shows only the pre-existing 6 files + state.md).

## TASK: Improve deterministic capability-signal coverage (COMPLETED 2026-09-26)

### What / why

Wired the two existing deterministic ID signals (lib/ai/catalog/modelSignals.ts)
into the four provider normalizers that previously hardcoded false capability
flags. Only lib/ai/catalog/normalizers.ts changed. Thresholds are the
established/defensible ones - no new heuristics invented:

- codingFamilySignal(modelId) >= 0.5 - the SAME threshold the openrouter
  (normalizers.ts:252), chutes (:321) and deepseek (:484) consumers already use.
- reasoningFamilySignal(modelId) >= 1 - the explicit reasoning/thinking tier
  only. No prior consumer existed; per the function's own docs, 1 = explicit
  reasoning family while 0.6/0.7 = strong general/coding family (must NOT
  qualify), so >= 1 is the only evidence-backed tier.

Targets and wiring:
- normalizeOpenCodeModel: coding+reasoning from signals; provenance 'derived'
  only when a signal fires, else 'unknown'.
- normalizeOpenAIModel: same pattern (fires on gpt/claude/qwen coding IDs and
  the o1/o3/o4 series for reasoning).
- normalizeZAIModel: same pattern (glm coding IDs).
- normalizeGeminiModel: coding was hardcoded false -> shared signal; reasoning
  = payload thinking flag (observed, stays authoritative) OR explicit-ID signal
  (derived when the payload is silent).

Why conditional provenance ('derived' only when fired): applyStaticFallback's
curated() fill only applies to 'unknown'-provenance flags, so all 14 static
registry rows stay byte-identical (mimo/big-pickle sig=0.4 still receive their
curated coding; unconditional 'derived' as in openrouter would strip it). This
mirrors the existing deepseek reasoning pattern (observed|unknown). Pricing,
free authority, context, tool/vision/structured flags, stage weights, grouping,
gates, caps, classifier limits - all untouched.

### Before -> after (direct DB reads around rebuildCatalogOnce; rebuild wrote
### 164 fresh rows in 4.1s, classifiedByAi=false)

- rows 202 -> 203 (+1 genuinely new live model opencode/longcat-2.5-preview-free;
  still NOT free despite its '-free' name - free is never inferred from names).
- flags: coding 22 -> 135 (+113 / -0), reasoning 43 -> 51 (+8, all openai
  o1/o3/o4 series; -0); tools 21, vision 7, structured 21 unchanged.
- distinct score tuples 24 -> 25; flat tuple (30,21,50,55) 153 -> 51;
  (65,21,50,55) x95 (coding 30 -> 65); gemini thinking rows (45,74,43,95) ->
  (80,74,43,95). valueScore/overallScore moved only where flags moved.
- priceSource live 14 / registry 8 / unknown 180 -> 181; ctx==128k 159 -> 160
  (the +1 is the new row); availability changes 0; scoreChangedSameFlags 0;
  free set 4 -> 4 identical (+0/-0); price/context/availability drift ZERO.
- winners: all 15 stage x setup picks IDENTICAL (Free: mimo discovery/solution/
  patch, nemotron root, evidence UNAVAILABLE; Balanced = Quality = chutes
  Qwen3-235B-A22B-Thinking-2507-TEE x5). HARDFAIL=false.
- registry 14/14 rows: identical capability flags, free flags, price sources.

### Threshold integrity (fresh 164 rows only; read-only follow-up probes)

- coding=true with signal<0.5: exactly 2 - opencode/mimo-v2.5-free + big-pickle
  (sig=0.4, curated fills) - proves the conditional-provenance design works.
- coding=false with signal>=0.5: 0 live rows. The 38 opencode IDs that looked
  like misses ALL carry the 2026-09-25 clock: they are the 39 pre-existing
  same-fingerprint stale rows (absent from today's live fetch; storeCatalog's
  cleanup only deletes fingerprint mismatches). Pre-existing issue, not caused
  by this change.
- reasoning=false with signal>=1: 0. reasoning=true with signal<1: 28 - all
  pre-existing from stronger evidence (gemini payload thinking='observed',
  opencode registry 'curated') - unchanged, correct.

### Validation

- npx tsc --noEmit -> 0 errors. npm run lint -> 12 errors / 28 warnings exact
  baseline (all in untouched files). npm run build -> exit 0.
- Probe convention honored: 3 temp probes ran, results recorded here, deleted;
  scripts/ ends empty.
- git: this task changed only lib/ai/catalog/normalizers.ts (plus the
  pre-existing 6 uncommitted lib/ai files + state.md from earlier tasks).

### Remaining issues (NOT in this task)

1. AI classifier batching: 0/202 rows AI-classified - AI_CLASSIFY_MAX_MODELS=80
   is a single batch and 202 > 80 falls straight to deterministic. Re-enable in
   <=80-model batches keeping the complete-output-only rule. Separate task
   (explicitly forbidden here); classifier determinism/quality is otherwise sound.
2. ~39 same-fingerprint stale rows never cleaned up (storeCatalog only deletes
   on fingerprint mismatch); their flags stay at the previous build's values.

## TASK: Re-enable AI capability classification using bounded batches (COMPLETED 2026-09-26)

### Batching implementation (only file changed: lib/ai/model-intelligence/index.ts)

- AI_CLASSIFY_MAX_MODELS = 80 KEPT as the per-REQUEST cap (NOT raised); catalogs
  larger than 80 are no longer skipped (the old early-return was the only behavior change).
- splitClassificationBatches<T>(models) (exported probe hook): pure index
  arithmetic, order-preserving chunks of <=80. Measured: 203 rows -> 80/80/43;
  edge sizes 0/1/79/80/81/160/161 all correct; run-twice deep-equal (same input
  -> same boundaries); flattened output index-wise identical to input (no
  shuffle, no dup, no loss). Batch index never enters prompt or score.
- aiClassify: resolves creds/endpoint ONCE before any request (missing key still
  throws to the caller - whole-catalog deterministic, classified_by_ai=false,
  identical to pre-batching), then runs batches SEQUENTIALLY (no concurrency,
  no rate-limit fan-out; request count = ceil(n/80)). Each batch reuses the
  existing prompt/schema/temperature 0.1 with its own max_tokens 4096 budget
  for <=80 entries (the proven-safe envelope). One stable global sort at the end.
- applyBatchScores (exported probe hook): existing validation verbatim - no
  JSON array -> reject; JSON.parse error -> reject; non-array or
  scores.length < batch.length -> reject (the truncation/zip-fill case); entry
  gap at index i -> THAT model's own deterministic score (never a constant);
  clamp(non-finite) -> 0 (never a fake mid score). Overlong responses: first N used.
- classifyBatch: same fetch/!ok-throw as before, now caught per batch.

### Batch behavior / failure semantics

- Each batch independently validated and accepted only if complete for that batch.
- Identity association = prompt index = array index = batch order (positional);
  probe verified entry i maps to model i exactly across fetch->parse->merge.
- Batch fails/truncates -> deterministicRank(batch) for ITS models ONLY.
  Successful batches stay applied and are never re-scored (no cross-batch corruption).
- applied=true iff >=1 batch accepted (same partial tolerance the entry-gap
  fallback already had); applied=false only when ZERO batches usable ->
  classified_by_ai=false, classificationModel=null. Caller (getOrBuildCatalog)
  untouched.
- Probe mock e2e (all PASS): B1 mixed (batch1 AI / batch2 truncated / batch3
  garbage) -> 80 AI + 123 deterministic, identity exact, no zip-fill, sorted
  merge; B2 all-HTTP-500 -> applied=false, all (30,21,50,55), no fabricated
  scores; B3 garbage batch1 + AI batches 2,3 -> mixed outcome with successful
  AI scores intact. 3 sequential requests each. No dup/missing IDs anywhere.

### Metadata precedence (confirmed by code + probe)

- AI writes ONLY score fields + recommendedCategories. Never flags, pricing,
  context, or isFree (live rebuild drift measured: priceDrift=0 ctxDrift=0
  freeDrift=0; flag T->F anomalies=0). Free authority untouched - prompt carries
  free= as data only; "free" in an ID never becomes price.isFree.
- Pipeline unchanged: live provider metadata -> static registry -> deterministic
  signals -> AI scores (AI replaces deterministic SCORES only; registry score
  blending stays inside the deterministic compute* path, as before).

### Before/after statistics (LIVE, two rebuilds during validation)

- Task baseline BEFORE: 203 rows, 0 AI-classified, flat(30,21,50,55)=51,
  coding=135, reasoning=51, distinct tuples=25, price live14/registry8/unknown181,
  ctx==128k=160, free=4, classified_by_ai=false.
- Run1: discovered=203 (opencode live returned 82 that call) -> batches 80/80/43.
  Classification hit HTTP 401 - PROBE BUG (my fake OPENCODE_ZEN_API_KEY shadowed
  the real DB key; resolveUserCredentials prefers ENV) -> 0/3 applied, all
  deterministic. Side effects of the rebuild itself (provider drift, not
  batching): +2 opencode rows (claude-sonnet-4, deepseek-v4-flash-free) and the
  38 stale 2026-09-25 rows were re-normalized by the signal-coverage code
  (coding F->T=38) -> rows 203->205, coding 135->175, flat 51->13.
- Run2 (final state, fake key removed): discovered=164 (opencode live returned
  43 that call - provider endpoint variance measured) -> batches 80/80/4.
  Classification with the REAL DB key -> HTTP 403 from the zen chat endpoint ->
  0/3 applied -> classified_by_ai=false, 0/164 AI-scored, deterministic fallback
  =164 (all). Rebuild duration 3.2s.
- Final catalog: 205 rows, distinct tuples=25, flat=13, coding=175, reasoning=51,
  price live14/registry8/unknown183, ctx==128k=162, free=4, dupKeys=0,
  added=0/removed=0 in run2, ALL drift 0.

### Selection regression

- winnerDiffs=0 across BOTH live rebuilds (15/15 picks identical): Free =
  mimo discovery/solution/patch + nemotron root + evidence UNAVAILABLE;
  Balanced = Quality = chutes Qwen3-235B-A22B-Thinking-2507-TEE x5.
  No winner changes -> nothing to attribute.

### Validation

- npx tsc --noEmit -> 0 errors. npm run build -> exit 0. npm run lint -> 12
  errors / 28 warnings exact baseline (untouched files). No test framework exists.
- Temp probe scripts/probe-classifier-batching.ts: ALL CHECKS PASSED, then
  deleted; scripts/ ends empty (0 files).
- Exported probe hooks follow the buildAutomaticPool precedent: splitClassificationBatches,
  applyBatchScores, aiClassify.

### Remaining issues (NOT in this task)

1. Live classifier endpoint rejects the selected free classifier model: real DB
   opencode key -> HTTP 403 on /chat/completions (run1's 401 was the probe's
   fake env key, since removed). Batching/fallback fully proven via mock e2e;
   live AI scores need a working chat credential/model for the existing
   selectFreeModelForClassification choice (no provider/model preference added).
2. Pre-existing: input order to batching derives from PARALLEL provider-fetch
   completion order - measured different group order across the two rebuilds
   (run1 deepseek,zai,chutes,opencode,gemini,openai vs run2
   gemini,zai,deepseek,chutes,opencode,openai) -> same catalog set can yield
   different batch boundaries/tie order across runs. split is pure given input;
   stabilizing discovery order = separate task.
3. Pre-existing: ~41 same-fingerprint stale rows never cleaned (storeCatalog
   deletes only fingerprint mismatches); meta.model_count=164 vs 205 rows.
   Stale-row cleanup is explicitly out of scope per task instructions.
4. Pre-existing: storeCatalog stamps source='ai_classified' for ALL rows when
   outcome.applied - on partial batch success this over-credits fallback rows;
   per-model provenance would need a schema change (separate issue).
5. Pre-existing: opencode /models returned 82 models in one call and 43 in the
   next (measured) - provider-side listing variance.

---

# AI CLASSIFIER HTTP 403 — READ-ONLY DIAGNOSIS (2026-09-26)

**Status:** ✅ Diagnosis COMPLETE. READ-ONLY task: NO fix implemented, NO production
code changed (git status identical to pre-task: 8 prior lib files + this entry).
Three temporary probes run from scripts/ then deleted; scripts/ ends empty (0 files).

## Root cause — CONFIRMED, category F (account/model access restriction)

`POST https://opencode.ai/zen/v1/chat/completions` with the REAL decrypted DB key
(51 chars, source=db-connection, NO env override — OPENCODE_ZEN_API_KEY unset) returns
**HTTP 403** with the literal body:

    {"type":"error","error":{"type":"FreeTierError",
     "message":"OpenCode's free tier can only be used from within OpenCode"}}

Zen's FREE-tier models are gated to requests originating from the OpenCode client.
This app's server-side fetch (classifier AND normal generation path) is not "within
OpenCode" → policy denial. NOT a key/auth/endpoint/model/config bug.

## Probe evidence (2026-09-26; same key + default base URL throughout; MEASURED)

| Test | Request | Result |
|---|---|---|
| T1 | classifier-shape POST (small, exact prompt template, model=nemotron-3-ultra-free) | **403 FreeTierError** |
| T1b | classifier-shape POST (~10.8KB, 80-entry list) | **403 FreeTierError** — identical ⇒ not payload/WAF |
| T2 | GET /models (healthCheck shape) | **200**, 43 models, selected model listed |
| T3 | OpenCodeZenProvider.generate (normal path, selected model, tiny prompt) | **403 FreeTierError** ⇒ not classifier-specific |
| T4 | same path, alt free model mimo-v2.5-free | **403 FreeTierError** ⇒ not model-specific |
| T5 | checkProviderHealth('opencode') with EMPTY env key | **true** ⇒ /models answers 200 with no key |
| T6 | GET /models id list | 43 ids; 10 free-named, 33 paid-named (claude/gpt/…); fields=id,object,created,owned_by (no pricing) |
| T7 | paid model (deepseek-v4.1-flash, 8-token cap) | **402 "Insufficient account funds"** ⇒ key authenticates; gate is model-tier-scoped, account unfunded |

Headers: content-type=application/json, server=cloudflare, cf-ray present.

## Root-cause classification (task categories)

- **F (account/model access restriction): SELECTED** — server literally restricts the
  free tier to OpenCode-originated requests; account has no funds for paid models (402).
- Ruled out WITH EVIDENCE: A invalid credential (same key → /models 200; paid call
  reaches billing → 402, not 401), C wrong endpoint (valid zen error type), D wrong auth
  format (identical Bearer works on /models), E wrong model identifier (selected model
  listed in /models; alt model identical 403), H env/config mismatch (no opencode env
  keys; base URL default consistent across classifier, provider client, registry),
  G generic rate/policy (it IS policy, but typed FreeTierError = access restriction ⇒ F).

## Selected classifier (CONFIRMED from code + registry)

`selectFreeModelForClassification` → **opencode/nemotron-3-ultra-free** (score 5 =
coding2+reasoning2+tools1; three-way tie with mimo-v2.5-free + big-pickle=5, broken by
stable sort over STATIC registry insertion order: nemotron, lightning, mimo, big-pickle).

## Health check vs chat completion (CONFIRMED — the check is blind)

- healthCheck = GET {baseUrl}/models; chat = POST {baseUrl}/chat/completions.
- /models returns 200 EVEN WITH AN EMPTY Bearer (T5) → proves connectivity only; zero
  signal about generation permission or tier.
- Consequence: app/api/models/connect validateCredentials (healthCheck) marks opencode
  "connected" while EVERY generation call 403s; checkProviderHealth caches the false
  positive 60s (registry.ts HEALTH_CACHE_TTL).

## Discovery-order impact on classifier selection (FINDING — do not fix)

- **None currently.** All 4 free rows (registry AND catalog free=4) are STATIC entries
  merged BEFORE live rows; Map keeps first-insert position, so parallel fetch completion
  order cannot reorder free candidates; ties break by fixed registry order ⇒ selection
  deterministic (nemotron-3-ultra-free).
- INFERENCE: a future live-only free model (explicit 0/0) scoring ≥ tie would insert
  after statics at a discovery-dependent position and could shift selection.
- Discovery order DOES still vary (measured group-order drift) and affects batch
  boundaries / equal-score tie order for non-free rows (pre-existing issue #2 above).

## Recommended fix (REPORT ONLY — explicitly NOT implemented)

1. Treat zen free models as unusable server-side: exclude opencode from
   selectFreeModelForClassification / strict-Free stage pools (or expose an explicit
   "available only within OpenCode" state) so selection stops choosing a dead endpoint.
2. Connect-time validation must exercise the GENERATION path/tier, not GET /models.
3. Paid zen models are not a strict-Free option anyway (confirmed-free rule) and this
   account is unfunded (402) — funding/plan change is a user decision, out of scope.
4. Interim behavior is already safe: classifier falls back to deterministic ranking
   (classified_by_ai=false, classificationModel=null) — as designed.

## Validation / cleanup

- No production code changed this task; git status = pre-task state exactly.
- Probes probe-zen-403.ts / probe-zen-models.ts / probe-zen-tier.ts: run, recorded,
  deleted; scripts/ empty (0 files).
- No build/lint run (read-only diagnosis, none required). No secrets printed (key only
  as length; all bodies redacted).

---

# CLASSIFIER SERVER-SIDE ELIGIBILITY — PROVIDER-AWARE (2026-09-26)

**Status:** ✅ COMPLETE. Follow-up to the 403 diagnosis above. Scope: classifier
eligibility ONLY + health-check documentation. Files changed (this task):
`lib/ai/model-intelligence/index.ts` (eligibility + export) and
`lib/ai/providers/opencode/client.ts` (JSDoc only, behavior unchanged) + this entry.

## What changed

- `CLASSIFIER_BLOCKED_PROVIDERS: ReadonlySet<ProviderName> = new Set(['opencode'])`
  (module-local, model-intelligence/index.ts) + `selectFreeModelForClassification`
  now filters `m.isFree && ctx >= 8000 && !CLASSIFIER_BLOCKED_PROVIDERS.has(m.provider)`.
  Provider-identity rule scoped to the SERVER-SIDE CLASSIFIER — no model-ID
  hardcoding, no provider ranking, no replacement model. Score formula, stable
  sort, input order untouched. Exported as a probe hook.
- Null selection → existing getOrBuildCatalog null branch → deterministicRank
  (unchanged code path, fires BEFORE any HTTP request).
- OpenCode `healthCheck()` behavior UNCHANGED; added JSDoc documenting the
  measured limitation (/models 200 proves reachability only — answers 200 with
  no Bearer; generation-tier probe deliberately NOT performed: a free-tier
  probe is always 403-rejected and would fail connect → drop OpenCode from
  user-facing discovery; paid inference forbidden in health validation).

## Health-check decision (requirement 5)

A generation-tier check cannot safely exist behind the current boolean: connect
route treats healthCheck()===false as "reject save", so an honest "generation
unavailable" result would block saving the opencode key and remove all its
models from user-facing Free selection (prohibited). Escape hatch used:
**left behavior unchanged, documented the limitation in code.** Only consumer of
healthCheck is app/api/models/connect/route.ts:80 (checkProviderHealth has no
production callers).

## Probe (temporary, deleted; scripts/ ends empty) — 14/14 PASS

1. opencode free rows still is_free=true (all 4). 2. Free stage candidates still
include opencode (4/4). 3. opencode excluded from classifier → next eligible
(zai fixture) selected. 4. Existing score/stable-tie logic picks highest-scoring
eligible; 4b equal-score tie → first in input order. 5. Paid fixture → null
(strict-free). 6. Only-opencode-free input → null (fallback trigger). 7. Batching
203 → [80,80,43] unchanged. 8. LIVE rebuild: 0 pricing/context/free drift on all
205 common rows (added=0 removed=0); stats identical before/after (rows 205,
coding 175, reasoning 51, flat4 13, distinct4 25, price 14/8/183, ctx128k 162,
free 4). 9. Eligibility region source scan: no hardcoded model IDs.

## LIVE result (2 rebuilds, both identical outcomes)

- Confirmed-free set = 4 models, ALL opencode → selection = **null** → no
  classifier HTTP request issued at all (no batch logs) → deterministic fallback:
  classified_by_ai=false, classificationModel=null, 0 AI-classified.
- No non-opencode confirmed-free model exists in the catalog (openrouter has 21
  registry-free entries but is not connected; zai glm-4.7-flashx registry-free
  but absent) — so "alternate provider reachable" is impossible today; reported
  honestly rather than assumed.
- Free/Balanced/Quality winners: 15/15 IDENTICAL before vs after (Free = mimo
  discovery/solution/patch + nemotron root + evidence UNAVAILABLE; Balanced =
  Quality = chutes Qwen3-235B-A22B-Thinking-2507-TEE x5).

## Validation

- `npx tsc --noEmit` → 0. `npm run build` → exit 0. `npm run lint` → 12 errors /
  28 warnings = exact baseline. Probe deleted; scripts/ empty (0 files).
- Unchanged (verified): price.isFree/confirmedFreeIds/stageSelection/buildAutomaticPool,
  strict-Free runtime, batching (split/classifyBatch/applyBatchScores), scoring
  formulas, context gates, family grouping, stage weights, normalization.

## Remaining issues (NOT in this task)

1. While no non-opencode confirmed-free model is connected, classifier AI scoring
   is permanently in deterministic fallback (by design now — correct behavior).
2. Stale same-fingerprint rows (~41), discovery-order variance, meta count
   164 vs 205 rows: pre-existing, explicitly out of scope.
3. Zen connection health check still cannot prove generation access (documented
   limitation above) — would need a non-boolean health state or a connect-flow
   redesign to surface honestly.

---

# READ-ONLY AUDIT — zai/glm-4.7-flashx ABSENCE + SERVER-SIDE USABILITY (2026-09-26)

**Status:** ✅ Audit COMPLETE. STRICTLY READ-ONLY: no production code, registry,
pricing, classifier, or connection changes (git status identical to pre-task).
Two temporary probes run + deleted; scripts/ ends empty (0 files).

## Q1 Registry status (CONFIRMED — two different "registries")

- `lib/ai/model-registry.ts:478-490` MODEL_REGISTRY (runtime ROUTING): id
  `zai/glm-4.7-flashx`, free: true, ctx 128K, scores 4/4/4/4, structuredOutput,
  recommendedFor [code_generation, debugging, complex_reasoning]. NO price fields.
  Its `free` flag is metadata only — NEVER consulted for free authority
  (model-registry.ts:21-26; config.ts:98-101; strategy-selection.ts:10-13,65-66).
- `lib/ai/catalog/registry.ts` STATIC_MODEL_REGISTRY (pricing authority): zai has
  exactly ONE entry — `glm-4.7-flash` price{null,null,isFree:false}. **No flashx
  entry at all.** => NOT confirmed-free by price.isFree authority.

## Q2 Live Z.AI discovery (MEASURED)

- GET `https://api.z.ai/api/paas/v4/models`, Bearer = DB zai key (len 49, no env)
  → **200**, 11 models: glm-4.5, glm-4.5-air, glm-4.6, glm-4.7, glm-5,
  glm-5-turbo, glm-5.1, glm-5.2, glm-5.3, glm-5.3-flash, **glm-5.3-flashx**.
- **`glm-4.7-flashx` ABSENT** from the live listing (near-misses: `glm-5.3-flashx`
  different generation; `glm-4.7` exists without the `flashx` suffix).
- Payload shape: id/object/created/owned_by only — 0/11 entries carry pricing
  fields (so live can never mark any zai model free).
- Credential CAN read discovery (200). openrouter: connected=false, env absent.

## Q3/Q9 Why it disappears — category **A (provider does not advertise it)**

Pipeline trace: live /models (no flashx) → normalizeAll (never fed) → merge →
storeCatalog (upserts everything received; deletes only fingerprint mismatches —
no per-model drop). Disappearance point = THE LIVE RESPONSE ITSELF.
- D ruled out by test: `normalizeZAIModel({id:'glm-4.7-flashx'})` returns a valid
  row (isFree=false, freeAuthority 'none', ctx default 128K) — normalizer would
  keep it if advertised.
- B ruled out for discovery (200), G/H ruled out (no rows to persist/drop;
  catalog zai rows = 11 live + 1 static = 12, all free=false src=unknown).
- Contributing structural fact: flashx has no STATIC_MODEL_REGISTRY row either,
  so the static-loop fallback (which keeps opencode free models present) cannot
  cover it. C (ID mismatch): registry `glm-4.7-flashx` matches no live ID —
  likely stale/retired generation (INFERENCE; exact-match-only merge by design,
  normalizers.ts:545-546).

## Q4 Free authority (CONFIRMED)

- MODEL_REGISTRY.free alone: NEVER establishes price.isFree (measured: flashx
  free:true yet absent/non-confirmed; prior conflict table counted it as
  "registry-free absent from catalog", conflicts=0).
- STATIC_MODEL_REGISTRY alone: CAN — two paths stamp isFree=true with
  freeAuthority 'registry-confirmed': (1) static-loop row creation
  (model-intelligence/index.ts:131) without any live data; (2) applyStaticFallback
  exact-match fill (normalizers.ts:145-147). Prices pair isFree with 0/0 →
  priceSource 'registry'.
- Live alone for zai: impossible (no pricing fields in payload — MEASURED 0/11).
- Prior conflicts (state.md table): set governs; absent ≠ conflict; absent
  models NEVER treated as free. => Adding to MODEL_REGISTRY alone would NOT make
  it confirmed-free; adding a STATIC_MODEL_REGISTRY price(0,0,true) entry WOULD
  (static-loop, connected zai) — NOT DONE (see Q5 before ever considering).

## Q5 Server-side generation (MEASURED, 2 rounds × 4 models, 8 tokens each)

- POST /chat/completions auth=Bearer(DB key): every attempt returned **HTTP 429**
  (business codes, NOT 401 — **authentication succeeds**, same pattern as
  opencode's 402 = reaches billing):
  - `glm-4.7-flashx` → 429 code **1113 "Insufficient balance or no resource
    package. Please recharge."** (reproducible 2/2).
  - `glm-4.7-flash` → 429 code 1305 "temporarily overloaded" (2/2).
  - `glm-5.3-flashx` → 429/1113; `glm-5.3-flash` → 429/1113.
- **0/8 probes returned 200** — NO model generated successfully with this
  account. Verdict: glm-4.7-flashx is NOT usable server-side right now
  (billing/package-gated). Model existence upstream: INFERENCE (error is
  billing-type, not model-not-found; billing may be checked before existence).

## Q6 OpenCode vs Z.AI — two INDEPENDENT axes

- OpenCode: catalog-registry static rows price(0,0,true) → always present in
  catalog → confirmed-free (registry-confirmed) → BUT generation blocked by
  free-tier policy (403 FreeTierError) → classifier-excluded (deliberate).
- flashx: only non-authoritative MODEL_REGISTRY flag → no static catalog row →
  not advertised live → NEVER in catalog → never confirmed-free → never a
  classifier candidate; AND generation billing-gated (429/1113). Axis 1 =
  catalog/free-authority presence; Axis 2 = server-side generation permission.
  flashx fails both; opencode passes axis 1, fails axis 2.

## Q7 OpenRouter (CONFIRMED)

openrouter connected=false (getProviderConnections), env OPENROUTER_API_KEY
absent → fetchLiveModels skips it (live.ts:132-133). Its MODEL_REGISTRY-free
models cannot be used by this user's server-side classifier (or any catalog
Free selection) while connectivity is absent. NOT modified, NOT recommended to
connect in code.

## Validation

- No production changes (git status = pre-task exactly); no registry/pricing/
  classifier/connection edits. Probe1 (listing+normalizer+DB+2 gen) and probe2
  (4 gen retries): recorded above, both deleted; scripts/ = 0 files. Secrets
  never printed (key as length only; bodies code+message only).

## Recommended next implementation (NOT done — evidence first per task)

Do NOT add flashx via MODEL_REGISTRY (no effect) and do NOT add a catalog static
free entry yet: the model is not advertised by Z.AI and its server-side
generation is billing-gated (429/1113). If Z.AI later advertises it AND the
account gains balance/package, eligibility would then hinge on a
STATIC_MODEL_REGISTRY price(0,0,true) entry (the only authority path that works
without live pricing). Separate blocker: even glm-4.7-flash (app default) did
not return 200 (429/1305 twice) — zai generation health for this account
deserves its own check before any classifier candidacy work.

---

# READ-ONLY AUDIT — Z.AI SERVER-SIDE GENERATION PATH (2026-09-26)

**Status:** ✅ COMPLETE. STRICTLY READ-ONLY: no code/config/connection/credential/
pricing/classifier changes (git status identical to pre-task). No probes needed —
no generation requests allowed and every path fact was established from code plus
the two prior audit probes' measurements. No secrets printed.

## Exact call path (CONFIRMED from code)

Analysis/manual stage → `gateway.generate` (gateway.ts:122 `runWithFallback`) →
`resolveAnalysisRouting` (routing.ts:59-67: providerTokens from
`resolveUserCredentials` — env ZAI_API_KEY absent ⇒ DB key len49) →
model-router chain build (strict-Free can NEVER contain zai — no confirmed-free
zai model; non-strict: manual > stage override > strategy/MODEL_REGISTRY pool >
autoChain CAN contain zai) → per entry `getOrCreateProvider` (index.ts:391) →
`createProviderInstanceWithApiKey('zai', key)` (registry.ts:117: baseUrl =
ZAI_BASE_URL || `https://api.z.ai/api/paas/v4`, model = ZAI_MODEL || `glm-4-flash`)
→ `provider.generate({model: entry.model, ...})` (index.ts:399-405) →
`ZAIProvider.generate` (providers/zai/client.ts:19-40): POST `${baseUrl}/chat/completions`,
headers `Content-Type: application/json` + `Authorization: Bearer <key>`, body
`{model, messages, temperature, max_tokens, response_format?}` → !ok ⇒ throw
`Z.AI API error <status>: <body>` → `classifyError` (index.ts:103-110): '429' ⇒
`rate_limit` ⇒ fallback-worthy (line 475) → next chain entry; chain exhausted ⇒
throw lastError (line 504). `response_format` included only when gateway passes
`responseFormat` (gateway.ts:127; json_object) — JSON.stringify omits undefined.

Env check (MEASURED, key names only): .env.local = NEXT_PUBLIC_SUPABASE_URL,
NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY — **no
ZAI_API_KEY / ZAI_BASE_URL / ZAI_MODEL** ⇒ all Z.AI config = code defaults,
credential = DB only.

## Evidence vs established facts (MEASURED from prior probes + CONFIRMED code)

- Discovery GET /models with same key → 200 (auth accepted for reads).
- Generation probes (manual, byte-equivalent to ZAIProvider's request minus
  response_format): `glm-4.7-flashx` 429/1113, `glm-4.7-flash` 429/1305 (2/2),
  `glm-5.3-flash`+`glm-5.3-flashx` 429/1113 — 0/8 returned 200.
- 429s carry Z.AI's OWN structured error JSON ⇒ the request reached Z.AI, passed
  HTTP auth (not 401/403), and failed at Z.AI's billing (1113 "Insufficient
  balance or no resource package") or capacity (1305 "temporarily overloaded")
  checks. Endpoint/headers/key/body are thereby demonstrated accepted upstream.
- Classifier vs normal differences: classifier posts to
  `getBaseUrl` zai entry = HARDCODED `https://api.z.ai/api/paas/v4`
  (model-intelligence/index.ts:550 — does NOT read ZAI_BASE_URL; provider/live
  do — latent divergence, INACTIVE while env unset ⇒ identical URL today);
  classifier body has no response_format (temp 0.1/max_tokens 4096) and is
  CURRENTLY NEVER CALLED for zai (no confirmed-free zai ⇒ selection null ⇒
  deterministic fallback before any request).

## Root-cause classification

**Evidence supports an upstream/account-side restriction ONLY** — account
balance/resource-package shortfall (1113, 3/4 models) + upstream overload
(1305, glm-4.7-flash). NO app code/config defect is established as the cause:
the implementation's URL, auth header, key resolution, and body shape are
proven accepted far enough for Z.AI to apply its own billing/service logic.
The429→`rate_limit`→fallback handling means the app degrades to other chain
providers rather than hard-failing (behavior, not a defect for this failure).

Latent observations (CONFIRMED, NOT causes): (a) provider default model
`glm-4-flash` (registry.ts:44/118) is absent from the live /models list — dead
default, router always passes entry.model; (b) classifier getBaseUrl env
divergence (inactive); (c) connect healthCheck = GET /models reachability-only
(200) — blind to billing/generation, same documented blind spot as OpenCode;
(d) billing-blocked 429 is treated as transient rate_limit — every zai chain
hop can re-hit 1113 until the chain moves on.

## Remaining uncertainty (NOT established)

1. 1113 does not prove glm-4.7-flashx exists upstream (billing may be checked
   before model existence) — INFERENCE only that it likely does.
2. 1113 does not distinguish account-wide balance vs per-model package
   entitlement (glm-4.7-flash escaping 1113 twice suggests per-model gating or
   a different gate) — unresolved.
3. 1305 wording is transient; reproduced only 2/2 minutes apart — no claim
   about duration.
4. `response_format: json_object` behavior on Z.AI untested (would require a
   generation request — forbidden this task).
5. No production server logs accessible — cannot confirm whether historical
   app runs hit these429s and how their chains fell back.

## Smallest justified next action (NOT taken — read-only)

Account-side only: open the Z.AI console, verify balance/resource packages for
the intended models, recharge (or confirm entitlements), then verify with ONE
minimal user-initiated generation. No code change is justified by this
evidence; if post-recharge generation returns 200, the app path is proven
correct as-is. (A future, separate task could surface 1113 billing messages to
the user instead of the generic fallback path — not required by current
evidence.)

---

# READ-ONLY AUDIT — DETERMINISTIC CAPABILITY CLASSIFICATION (2026-09-26)

**Status:** ✅ COMPLETE. Read-only: no production code, schema, pricing/free
authority, connections, or selection formulas touched; no generation requests;
zero files created (no probe needed — every question answered from code plus
prior measured results). `skills.md` absent (re-confirmed).

## Context (MEASURED, prior probe)
No eligible classifier exists today (all 4 confirmed-free models are on the
blocked opencode provider → selectFreeModelForClassification returns null) →
`deterministicRank` IS the live classification path for every catalog build;
meta.classified_by_ai=false / classification_model=null in the current state.

## Findings (CONFIRMED from code unless labeled otherwise)

**F1 — Scoring is honest-by-design.** deterministicRank (index.ts:244-263) +
scorers (:281-373): every point maps to evidence — capability flags (provider
metadata), context bands (contextToScore :281-291), active-params-from-ID speed
(:293-309), registry-curated blend 70/30 when a static entry exists (:325-330).
Comment block :265-278 explicitly forbids invented benchmarks. Unknowns are
conservative, not optimistic: no size signal → speed base 50 (:297); unknown
price → valueScore 40 "worse than any known price" (:367); unknown flags are
never defaulted true (types.ts:75 CapabilityProvenance 'unknown' ⇒ false);
unknown context → 128_000 default (normalizers.ts:200, contextSource 'default').
Only mildly optimistic default: 128K context passes the root-cause 128K stage
gate exactly (stageSelection:50).

**F2 — Defaults per field:** context 'default' 128K (normalizers:200); prices
null + priceSource 'unknown'; capabilities false + provenance 'unknown';
metadataConfidence 'low' only when price unknown + ctx default + 0 observed
caps (normalizers:98-100); FreeAuthority 'none' (never free by name).

**F3 — Provenance/confidence are write-only (dead plumbing).**
capabilityProvenance, metadataConfidence, contextSource, freeAuthority are
computed at normalize time (normalizers:219-222) and carried through discovery
(index.ts:130-139,:177-180) but: NOT persisted (storeCatalog rows :574-586),
NOT restored (loadCatalog :646-659), NOT mapped to CatalogModel
(toCatalogModel.ts:9-41 maps priceSource only, :20), never read by selection.
Lost on every load. Only priceSource survives end-to-end.

**F4 — Fallback distinguishable at catalog level, invisible to users, wrong at
row level on partial batches.** storeCatalog: source='ai_classified' for ALL
rows iff classifiedByAi, else registry/live (:584); meta honest when no batch
applied (getOrBuildCatalog :742/:747 sets false/null; ClassificationOutcome doc
:375-390). API exposes classifiedByAi/classificationModel (route.ts:110-111)
but the page drops both (page.tsx:85-110) → no UI signal that scores are
metadata-derived. Partial-batch success stamps deterministic-fallback rows
'ai_classified' too (catalog-wide flag :584) — pre-existing issue #4.

**F5 — Dead confidence tie-breaks in family grouping.**
betterFamilyRepresentative (stageSelection:186-199) documents priority
"better metadata confidence" via tags.includes('live'), but toCatalogModel:37
sets tags=recommendedCategories (score-threshold vocabulary only) and drops the
entry-level tags where normalizers:217 puts 'live' → aConf===bConf always (both
1) → tie-break never fires; falls straight to price. Similarly `available` is
hardcoded true (toCatalogModel:40) while m.availability ('unknown' for all
registry rows) is mapped but unused → availability priority (:193) inert.

**F6 — Selection distortion risks (CONFIRMED mechanics; magnitude INFERENCE).**
stageScore (stageSelection:79-88) reads only scores — confidence/provenance
never influence Free/Balanced/Quality (so no distortion FROM confidence, but
also no protection by it).
- Free: strict price.isFree only (:429) — eligibility cannot be distorted by
  unknown metadata (unknown ⇒ not free). Ranking: all free models share
  valueScore=95 (computeValueScore :366) → scoreOrderedPool's secondary key
  (:369) is degenerate inside the free pool → free ties resolve alphabetically
  by provider/model ID (INFERENCE from code).
- Balanced: unknown price → costPenalty Infinity → -Infinity; wins only if all
  candidates unknown (then first-by-stageScore) — explicit, documented
  (:299-307).
- Quality: unknown price → last-resort within ±5 tolerance (:346-347).
- Evidence-extraction 200K context gate (stageSelection:49): defaulted-128K
  models are silently excluded from the automatic pool AND strict-Free runtime
  candidates (getFreeStageCandidates) — unknown context disqualifies (CONFIRMED
  logic; how many rows affected = INFERENCE).
- Score collapse for metadata-poor rows is MEASURED: flat
  (coding30, reasoning21, speed50, longContext55) = 13 rows, distinct4=25
  (prior probe) — identical unknown metadata ⇒ identical scores ⇒ ordering
  falls to valueScore/ID.

**F7 — Failure modes → persisted records (CONFIRMED, getOrBuildCatalog
:730-752 + storeCatalog :574-637).** No eligible classifier → deterministicRank,
classifiedBy_ai=false, classificationModel=null, rows registry/live (honest).
aiClassify throws → catch → same (:744-749, honest). Malformed/unusable
response → applyBatchScores returns null → that batch deterministicRank; ALL
batches bad → applied=false → catalog-level honest. Partial batch → applied
true → flags claim AI but per-row origin over-credited (F4/#4). Store failure →
upsert keeps old rows, meta not advanced (last) → old honest state served
(:588-602).

## Verdict (assessment)
Deterministic classification is **adequate and honest as scoring**: evidence-
mapped, conservative on unknowns, never invents prices/free/benchmarks. Honesty
gaps are in **representation/surfacing**, not score values: origin invisible to
users (F4), per-row over-credit on partial batches (F4/#4), provenance/confidence
fields computed but dead (F3), documented confidence tie-breaks inert (F5).
Existing types (MetadataConfidence, CapabilityProvenance, ContextSource,
FreeAuthority — types.ts:59-88) CAN represent confidence without a schema
migration for the in-memory path, but full persistence of them would need new
columns (context live-vs-default is unrecoverable from the stored number);
catalog-level origin needs NO migration (classified_by_ai already exists).

## Minimal implementation proposal (NOT implemented — read-only task)
P1 (small): carry per-row score origin ('ai'|'deterministic') from
applyBatchScores/deterministicRank into storeCatalog and stamp `source` per row
instead of catalog-wide (:584) — fixes F4/#4 using the existing TEXT column; no
schema, pricing, or selection change.
P2 (small): render the already-sent classifiedByAi/classificationModel on the
/models page as a "AI-scored / metadata-scored" indicator — closes F4's
visibility gap using fields already in the payload (route.ts:110-111).
F3/F5/F6 are reported as observations only; touching F5/F6 would change
selection behavior (out of scope by task rules).

---

# IMPLEMENTATION — CLASSIFICATION-PROVENANCE FIXES P1 + P2 (2026-09-29)

Implements the two evidence-backed proposals from the deterministic-
classification audit above. No schema migration; no pricing/free-authority,
selection, formula, or provider changes; no generation requests.

## Changed files

1. `lib/ai/model-intelligence/index.ts` (P1 core)
2. `lib/ai/catalog/scoringStatus.ts` (NEW, P2 pure helper)
3. `lib/ai/catalog/toCatalogModel.ts` (scoreOrigin passthrough, 1 line)
4. `app/models/page.tsx` (P2 badge wiring, 18 lines)

## P1 — exact provenance semantics (persisted `source` column, no migration)

- New `ScoreOrigin = 'ai' | 'deterministic'` on `ClassifiedModel`
  (`scoreOrigin`, REQUIRED — tsc enforces every construction site;
  mirrors the existing `RelevantFile.source` convention in types/index.ts).
- Origin stamping:
  - `deterministicRank` → every row `deterministic` (full fallback path,
    per-entry gaps in `applyBatchScores`, failed batches in `aiClassify`).
  - `applyBatchScores` AI-scored entries → `ai`.
  - `aiClassify` applied/not-applied (`getOrBuildCatalog` catch, null
    freeModel) flows unchanged — flags still describe the catalog, not rows.
- Encoded domain written by `persistedSource(m)` (exported):
  - `ai_classified:registry` / `ai_classified:live` — AI-scored rows, entry
    provenance preserved after the colon (this replaces the old catalog-wide
    stamp, fixing audit issue #4: partial batches no longer over-credit).
  - `registry` / `live` — deterministic rows, byte-identical to the pre-fix
    writer (entry provenance intact).
  - `ai_classified` — legacy pre-fix catalog-wide stamp; still readable via
    `parsePersistedSource` and re-persists unchanged.
- `parsePersistedSource(raw)` (exported) is the exact inverse: composite →
  {entry, ai}; bare `ai_classified` → {ai_classified, ai} (legacy);
  registry/live → deterministic; ANY unknown/null value → deterministic +
  conservative entry (never claims AI). Corrupt composite (`ai_classified:x`)
  keeps the AI claim (prefix proves it) but invents no entry provenance.
- Round-trip extraction: `toCatalogRow(model, ctx)` / `fromCatalogRow(row)`
  (both exported, typed `ModelCatalogRow`) now contain the exact
  store/load mapping — storeCatalog rows and loadCatalog mapping are one-line
  call sites; everything else in those functions (upsert chunking, meta-last,
  fingerprint cleanup, registry enrichment) untouched.
- `NormalizedModel.source` widened `'registry' | 'live' | 'ai_classified'` —
  the union now tells the truth about what loadCatalog can return (it was
  already returning 'ai_classified' before this task, contradicting the type).
- Meta comment updated: `classified_by_ai` = "at least one classifier batch
  accepted" (catalog-level); per-row origin never derived from it.
- Unchanged: scores, ordering (`merged.sort`), classifiedByAi/classificationModel
  computation, pricing/free authority, selection formulas.

## P2 — /models transparency

- `lib/ai/catalog/scoringStatus.ts`: pure `describeScoringStatus(
  {classifiedByAi, classificationModel, rows})` → `{kind,label,detail}`;
  kinds: hidden | metadata | ai | partial | ai-assisted. Honesty rules:
  - classifiedByAi absent/null OR empty rows → hidden (badge not rendered);
  - false → "Metadata-scored";
  - true + per-row counts: all-ai → "AI-scored" (detail names the model);
    mixed → "{ai}/{total} AI-scored" (NEVER claims full coverage);
    rows missing origins or flag-only/ai===0 → non-claiming
    "AI-assisted scoring".
- `app/models/page.tsx`: new `scoring` state set in `applyData` from the
  EXISTING `/api/models` fields (`classifiedByAi`, `classificationModel` —
  route.ts untouched); `useMemo` derives the status from `models` rows' new
  optional `scoreOrigin` (mapped by `toCatalogModel`); compact badge under
  the page header reuses `Badge variant="outline"` + `text-bw-peach` (the
  same token pattern as "Compact View"), detail exposed via `title`.
  Light/dark via existing CSS variables; no new colors.

## Validation

- Temp probe `scripts/probe-score-provenance.ts` (fetch mocked, NO network,
  NO DB writes) — ALL CHECKS PASSED, then DELETED; scripts/ ends 0 files:
  T1 full-valid batch → all ai; T2 malformed/truncated → null; T3 per-entry
  gap → ['ai','deterministic','ai']; T4 aiClassify all-fail → applied=false,
  all deterministic; T5 mixed 85-model run → exactly 80 ai + 5 deterministic
  (fallback = batch 2 ids probe-model-80..84), global ordering preserved;
  T6 toCatalogRow/fromCatalogRow round-trip 4 combos (origin+entry+scores+
  categories survive); T7 legacy/corrupt/unknown source values; T8
  toCatalogModel passthrough; T9 describeScoringStatus 10 branch assertions
  (hidden×3, metadata, ai±model attribution, partial "2/3", ai-assisted×2).
- npx tsc --noEmit → 0. npm run build → exit 0. npm run lint → 12 errors /
  28 warnings exact baseline. git status: only the 4 task files (+state.md)
  beyond the pre-existing dirty set; scripts/ empty.

## Limitations (recorded, not addressed)

1. DB-level I/O round-trip not executed (no test DB; user_id FK constraints
   forbid sentinel rows) — the round-trip tested is the exact encode/decode
   mapping layer store/load now share.
2. Legacy rows stamped `ai_classified` pre-fix keep reading as ai (their true
   per-row split is unknowable without re-classification); badge for such a
   full-legacy catalog shows "AI-scored" per the historical claim. It
   self-corrects on the next catalog rebuild.
3. `classified_by_ai` meta semantics unchanged (at least one batch) — the
   badge never reads it as per-row truth.
4. Row-origin exposure adds `scoreOrigin` to the /models payload (informational
   only; no consumer other than the badge).

---

# READ-ONLY AUDIT — MISSING Z.AI MODEL ELIGIBILITY: zai/glm-4.7-flashx (2026-09-29)

**Status:** ✅ COMPLETE. Read-only: no code/registry/pricing/classifier/
connection changes (git status identical to pre-task 13-line dirty set from
prior tasks). One temp probe run twice (first run had 3 probe-local type
errors → fixed → tsc 0 + clean rerun) then DELETED; scripts/ = 0 files.
`skills.md` absent (re-confirmed). Follow-up/re-measurement of the 2026-09-26
audit (state.md:2432) with fresh discovery evidence.

## Q1 Registry entry (CONFIRMED, code)

- MODEL_REGISTRY (runtime routing) `lib/ai/model-registry.ts:478-490`: id
  `zai/glm-4.7-flashx`, model `glm-4.7-flashx`, `free: true`, ctx 128K,
  scores 4/4/4/4, structuredOutput, recommendedFor [code_generation,
  debugging, complex_reasoning]; NO price fields (MEASURED via probe
  hasPriceFields=false). Its `free` flag is metadata only — never free
  authority (model-registry.ts:21-26 doc; consumers config.ts:99,
  strategy-selection.ts:12,34, gateway.ts:89 all cite price.isFree).
- STATIC_MODEL_REGISTRY (pricing authority) `lib/ai/catalog/registry.ts`:
  zai has exactly ONE row — `glm-4.7-flash` price{null,null,isFree:false},
  ctx 128K (registry.ts:268-269). **No flashx entry** (probe-confirmed).

## Q2 Provider + discovery (MEASURED fresh, 2026-09-29)

- zai connected=true; credential len 49 (env ZAI_API_KEY/ZAI_BASE_URL/
  ZAI_MODEL all absent → code defaults). GET
  `https://api.z.ai/api/paas/v4/models` (live.ts:90-100) → **200**, 11 ids:
  glm-4.5, glm-4.5-air, glm-4.6, glm-4.7, glm-5, glm-5-turbo, glm-5.1,
  glm-5.2, glm-5.3, glm-5.3-flash, glm-5.3-flashx — **flashx ABSENT**
  (near-misses: glm-5.3-flashx = different generation; glm-4.7 = no suffix).
  0/11 rows carry pricing fields → live can never mark any zai model free.
  Identical to 2026-09-26 → stable over 3 days.

## Q3 Exclusion point (CONFIRMED, category **A: provider does not advertise**)

Pipeline trace (current line numbers):
1. `fetchZAI` live.ts:90-100 returns only what Z.AI lists → normalizeAll
   never receives a flashx row.
2. `discoverModels` model-intelligence/index.ts:120-154 static loop feeds
   ONLY STATIC_MODEL_REGISTRY (zai → glm-4.7-flash only) — no flashx row.
3. live merge :156-190 (exact-match static fill :166) + `storeCatalog`
   :710-748 upserts everything received and deletes only fingerprint
   mismatches — no per-model drop step exists.
=> The model is lost at THE LIVE RESPONSE ITSELF; no downstream step could
drop a row that never arrived. D (normalizer) ruled out again by probe:
`normalizeZAIModel({id:'glm-4.7-flashx'})` → kept=true, price.isFree=false,
freeAuthority 'none', priceSource 'unknown', ctx default 128000. Structural
contributor: no STATIC row → the static-loop fallback that keeps other
models present cannot cover flashx. C (stale/retired upstream id): INFERENCE
from exact-match-only design (normalizers exact-match fill), not provable
from our side.

## Q4 Free evidence (CONFIRMED: NOT free, never treated as free)

- Unknown pricing must never read as free — live payload has no pricing
  (0/11), static has no flashx row, MODEL_REGISTRY.free is non-authoritative
  → authority path `price.isFree` yields **false** (probe: isFree=false,
  freeAuthority=none). Flashx therefore never enters any confirmed-free set
  (gateway.ts:106, stageSelection.ts:429/471, model-intelligence.ts:247).
- Classifier eligibility inputs (derived, not executed): isFree=false →
  `selectFreeModelForClassification` cannot select it (model-intelligence/
  index.ts:247 `m.isFree && ctx>=8000 && !CLASSIFIER_BLOCKED_PROVIDERS`) —
  failure is on free authority, not on the opencode blocklist (zai not
  blocked there).

## Q5 Server-side generation (MEASURED 2026-09-26; NOT re-probed today)

- Prior: 2 rounds × 4 models — every POST /chat/completions → HTTP 429
  (auth succeeds, business codes): flashx → 429/1113 "Insufficient balance
  or no resource package" (2/2); glm-4.7-flash → 429/1305 (2/2);
  glm-5.3-flash(x) → 429/1113. 0/8 → 200.
- Today's probe deliberately made **no generation requests**: any successful
  POST could consume paid credits if the account was recharged since (task
  forbids credit consumption), and a failing POST would add nothing beyond
  the 3-day-old measurement. => freshness of the billing state is
  UNRESOLVED (see limitations).

## Q6 OpenRouter (CONFIRMED, status only)

- connected=**false** (fresh probe), env OPENROUTER_API_KEY absent →
  `fetchLiveModels` skips it (live.ts:132-133). NOT connected, NOT modified.

## Root-cause category

**A — provider does not advertise the model** (live listing lacks it; exact-
match pipeline correctly keeps the catalog truthful), with two independent
downstream blockers that would each still prevent classifier use even if A
were fixed: (1) no free authority (Q4), (2) billing-gated generation (Q5).

## Files inspected (read-only)

skills.md (absent) · AGENTS.md · think/state.md:2432-2545 ·
lib/ai/model-registry.ts:21-26,455-514 · lib/ai/catalog/registry.ts:89,268-269 ·
lib/ai/catalog/live.ts:85-139 · lib/ai/model-intelligence/index.ts:115-189,247,
706-762 · lib/ai/catalog/normalizers.ts:136-147,552,574-587 ·
lib/ai/connection/service.ts · free-authority refs in config.ts:99,
strategy-selection.ts:12,34, gateway.ts:89,106, stageSelection.ts:419-429 ·
lib/ai/providers/zai/client.ts (path audit). **Changed: only think/state.md**
(plus temp probe, deleted).

## Validation

- npx tsc --noEmit → 0 (with probe, post-fix). Probe run → all fields
  captured, "no generation requests made", then deleted; scripts/ = 0.
- git status → 13 lines, byte-identical to pre-task baseline (prior tasks'
  uncommitted work untouched); no pricing/classifier/connection edits.

## Limitations / unresolved

1. Generation/billing state not re-measured today (credit constraint);
   429/1113 evidence is 3 days old.
2. Upstream existence of `glm-4.7-flashx` remains INFERENCE (billing error,
   not model-not-found; billing may be checked first).
3. 1113 scope (account-wide balance vs per-model package) still unknown.
4. No Z.AI console access from here → balance/packages cannot be verified.

## Recommended next step (NOT taken)

Account-side first: check Z.AI console balance/resource packages, then —
only with explicit approval — ONE minimal generation probe per candidate
model to refresh Q5. Do NOT add flashx to MODEL_REGISTRY (no effect on
eligibility) and do NOT add a STATIC_MODEL_REGISTRY free entry yet (would
grant registry-confirmed free status to a model that is neither advertised
nor generation-capable — free authority must follow evidence, not intent).

---

# READ-ONLY AUDIT — AI CLASSIFIER PROVIDER ELIGIBILITY (2026-09-29)

**Status:** ✅ COMPLETE. Read-only: no production code / connections / pricing /
free rules / selection changes (git status identical to pre-task 13-line dirty
set). One temp probe (DB SELECT-only + ONE $0-model POST) run once, DELETED;
scripts/ = 0. `skills.md` absent (re-confirmed). Follow-up to the 2026-09-26
403 diagnosis (state.md:2262) and classifier-eligibility fix (state.md:2352).

## Q1 — Selection logic (CONFIRMED, code)

- `CLASSIFIER_BLOCKED_PROVIDERS = new Set(['opencode'])` —
  model-intelligence/index.ts:234.
- `selectFreeModelForClassification` (index.ts:245-256): filter
  `isFree && contextWindow >= 8000 && !blocked` (:247), score =
  coding2+reasoning2+tools1 (:252), stable-sort desc, take first; null when
  empty. Caller `getOrBuildCatalog` (:842-864): null → deterministicRank
  fallback, NO request made (:862-864).
- Execution (`aiClassify` :513-554): credentials = DB `resolveUserCredentials`
  || env (`envKeyForProvider`, service.ts:16-24,40-42) (:520-522); endpoint =
  `getBaseUrl(provider)` (:523, :556-567) — OpenAI-compatible URL for ALL 7
  providers (gemini → `generativelanguage.googleapis.com/v1beta/openai`);
  request = POST {baseUrl}/chat/completions + Bearer + temperature 0.1 +
  max_tokens 4096 (:500-503). Closed 7-provider union
  (providers/registry.ts:10) ⇒ the `|| api.openai.com/v1` fallback (:566) is
  unreachable. **No endpoint/auth incompatibility for any candidate.**

## Q2 — Fresh inventory (MEASURED 2026-09-29, probe)

- Connections (DB-only; env does NOT connect — service.ts:76-79):
  `chutes=true openrouter=false opencode=true gemini=true deepseek=true
  zai=true openai=true`.
- Env keys: only `GEMINI_API_KEY` present; OPENROUTER_API_KEY absent.
- Credential lengths (secrets never printed): chutes=102 openrouter=0
  opencode=51 gemini=53 deepseek=35 zai=49 openai=164.
- Catalog (SELECT, no rebuild): 205 rows, meta {count 164, free 4,
  classifiedByAi **false**, classificationModel null, lastAnalyzedAt
  2026-09-26T16:12Z}. Per provider: chutes 14m/0free, openrouter **ABSENT**,
  opencode 84m/**4free**, gemini 28m/0free, deepseek 3m/0free, zai 12m/0free,
  openai 64m/0free.
- The 4 free rows: opencode `nemotron-3.5-lightning-free`,
  `mimo-v2.5-free`, `nemotron-3-ultra-free`, `big-pickle` — all ctx 128000,
  priceSource=registry (registry-confirmed ⇒ `price.isFree=true`).
- Selection on persisted rows → **null (deterministic fallback)** — matches
  meta classifiedByAi=false. No request would fire on rebuild today.

## Q3 — Per-candidate evidence matrix (connected first)

| provider | conn | creds | confirmed-free models | ctx≥8K | endpoint/auth | free-tier generation evidence | verdict |
|---|---|---|---|---|---|---|---|
| opencode | ✓ | DB 51 | **4** (registry) | ✓ 128K | zen/v1 OpenAI-compat ✓ | **403 FreeTierError, FRESH 2026-09-29** (see below) | **blocked: policy** (CLASSIFIER_BLOCKED_PROVIDERS:234) |
| chutes | ✓ | DB 102 | 0 (all priced; 32B registry-free PROVEN paid, state.md:1823) | n/a | llm.chutes.ai/v1 ✓ | not probeable within constraints (paid models → charge risk) | ineligible: no free model |
| gemini | ✓ | env 53 | 0 (2 priced + 26 unknown ⇒ isFree=false) | n/a | /v1beta/openai ✓ | UNVERIFIED (no repo evidence ever; billing status unknown → charge risk) | ineligible: no free model |
| deepseek | ✓ | DB 35 | 0 (priced) | n/a | api.deepseek.com/v1 ✓ | not probeable (charge risk) | ineligible: no free model |
| zai | ✓ | DB 49 | 0 (registry `free` flags non-authoritative; flash/flashx isFree=false) | n/a | api.z.ai/.../v4 ✓ | MEASURED 429/1113 + 1305, 0/8 (2026-09-26, state.md flashx entry) | ineligible: no free model + billing gate |
| openai | ✓ | DB 164 | 0 (all unknown/priced) | n/a | api.openai.com/v1 ✓ | not probeable (charge risk) | ineligible: no free model |
| openrouter | **✗** | **0** | not in catalog (historically 21 live 0/0-priced free models, state.md:883) | — | openrouter.ai/api/v1 ✓ | never called from repo | **blocked: missing credentials** (not connected) |

## Q4 — Blocked-by categories

- **Policy:** opencode — zen free tier restricted to OpenCode-originated
  requests; refreshed TODAY (charge-impossible POST on confirmed-$0
  `nemotron-3-ultra-free` → **403 FreeTierError**, identical to 2026-09-26
  T1/T3/T4). Policy unchanged; block correctly prevents the dead endpoint.
- **Credentials:** openrouter — no DB row + no env key ⇒ discovery skips it
  (live.ts:132-133); contributes zero catalog rows.
- **Billing:** zai — 429/1113 "Insufficient balance" (2026-09-26) on its
  would-be classifier models; moot anyway (0 confirmed-free).
- **No confirmed-free model:** chutes, gemini, deepseek, openai — unknown or
  priced ≠ free (constraint); filter rejects them BEFORE any request, so
  generation permission is moot/unverifiable without charge risk.
- Health-check blindness persists (state.md:2313-2320): GET /models 200 ≠
  generation permission (opencode answers 200 with an EMPTY key).

## Q5 — Does any connected provider qualify without paid credits? **NO**

- opencode: only connected provider with confirmed-free models; fails ONLY on
  fresh-measured policy 403.
- All other connected: 0 confirmed-free models ⇒ `selectFreeModelForClassification`
  can never return them ⇒ no request, no charge — by design.
- Net: today selection → null → deterministic fallback (safe; matches prior
  "by design now" finding state.md:2422-2423). Catalog AI scoring stays off.
- Potentially available: **openrouter** is the only provider with a historical
  live-0/0 free pool; eligibility gap is purely credentials (connect = user
  action, out of scope here). Its server-side free-generation permission is
  UNVERIFIED in-repo (strongly implied by 0-price, but never called).

## Data observation (known, out of scope)

meta.model_count=164 vs 205 rows = the pre-existing stale same-fingerprint
rows issue (~41, state.md:2424-2425); free=4 consistent in both; no effect
on this audit (selection inputs identical).

## Files inspected (read-only)

skills.md (absent) · AGENTS.md · think/state.md:946-1000, 2262-2351,
2415-2430, 2432-2977 · lib/ai/model-intelligence/index.ts:234-256, 415-554,
556-567, 676-779, 836-867 · lib/ai/connection/service.ts (full) ·
lib/ai/catalog/live.ts:9, 130-133 · lib/ai/providers/registry.ts:10 ·
think/state.md free-count/evidence rows (703, 883, 957-997, 1738-1762, 1823,
2047). **Changed: only think/state.md** (+temp probe, deleted).

## Validation / cleanup / freshness

- `npx tsc --noEmit` → 0 (with probe). Probe → all fields captured, then
  DELETED; scripts/ = 0 files. git status → 13 lines, unchanged baseline.
- Fresh (2026-09-29): connections, credentials, catalog SELECT, selection
  simulation, zen 403. Stale-but-unchanged: zai 429/1113 + OR free-count +
  403 T-table (2026-09-26, 3 days). No secrets printed (lengths only; error
  body reduced to type).

## Unresolved questions

1. gemini free-tier generation permission: UNVERIFIED — cannot probe without
   charge risk; moot until a gemini model gains confirmed-free pricing.
2. openrouter free-model server-side permission: UNVERIFIED (no key).
3. Would opencode unblock if the request originated "within OpenCode"?
   (product/policy question, not code).
4. meta 164-vs-205 stale rows — pre-existing, out of scope.

## Recommended next task (smallest step, report-only — NOT taken)

Connect OpenRouter (user action: env `OPENROUTER_API_KEY` or DB connect) —
the only candidate whose free pool is live-priced 0/0 — then run ONE
charge-impossible `$0` classifier-shape probe against its free pool to verify
server-side generation before any code relies on it. No code change is
required or recommended meanwhile: selection→null→deterministic is correct,
do NOT lift the opencode block (fresh 403), do NOT treat unknown pricing as
free. Follow-up hygiene candidates (separate, pre-existing): connect-time
generation-aware validation (state.md:2338) and the meta/rows reconciliation
(state.md:2424).

---

# READ-ONLY AUDIT — OPENROUTER FREE CLASSIFIER READINESS (2026-09-30)

**Status:** ✅ COMPLETE. Read-only: no production code / credentials /
connections / Free-mode rules / opencode block touched (git status identical
to pre-task 13-line dirty set). One temp probe (public GET, NO key, NO
generation) run once then DELETED; scripts/ = 0. `skills.md` absent.

## Q1 — Existing paths (CONFIRMED, code)

- Discovery: `fetchOpenRouter` live.ts:26-35 (GET {OPENROUTER_BASE_URL||
  openrouter.ai/api/v1}/models, Bearer, 1h revalidate) via PROVIDER_FETCHERS
  live.ts:110; key = creds[openrouter] || envKey live.ts:132; gated by
  connectedIds (model-intelligence:121 static / :161 live).
- Pricing normalization: `normalizeOpenRouterModel` normalizers.ts:234-291 —
  pricing.prompt/completion → `toPriceNumber` (:55-60, negative sentinels →
  null) → per-million (:44-47) → `isExplicitlyFree` (:62-65): **free ⇔ pricing
  exists AND both sides exactly 0; null/missing ⇒ never free**; freeAuthority
  'explicit-zero' (:272); priceSource 'live' when pricing fields exist (:271);
  ctx from context_length (:273); caps observed from supported_parameters +
  derived codingFamilySignal (:245-253); non-text guards (:238-243).
- Static registry: **ZERO openrouter model rows** (only PROVIDER_DEFINITIONS
  entry registry.ts:29-39) ⇒ all OR catalog rows are live-derived; no static
  free flags to trust or distrust.
- Credentials: `OPENROUTER_API_KEY` env map service.ts:18; resolveUserCredentials
  env-first, DB-second (:115-151); classifier uses creds||env (index.ts:521).
  Connection status is DB-ROW-ONLY — env does NOT connect (service.ts:76-79).
- Classifier request: `getBaseUrl` openrouter → openrouter.ai/api/v1
  (index.ts:558); classifyBatch POST /chat/completions + Bearer only (no
  HTTP-Referer/X-Title, index.ts:500-503; OpenRouterProvider.generate DOES
  send them, client.ts:33-34 — optional per docs, see limitations).
- Selection: openrouter NOT in CLASSIFIER_BLOCKED_PROVIDERS ({opencode},
  index.ts:234); filter isFree && ctx≥8000 (:245-256).

## Q2 — Currently available zero-priced models (MEASURED 2026-09-30, public
keyless GET /api/v1/models → 200, 464 raw)

- Raw pricing: 464 have pricing fields; **20 explicit 0/0**; 6 negative
  sentinels (variable-price pseudo-models); 0 missing/NaN; 438 paid.
- Production normalizer: 459 survive; **`isExplicitlyFree` confirms 17 free**
  (all ctx≥8000, freeAuthority 'explicit-zero', priceSource 'live'). The 6
  negative sentinels normalize to unknown-priced and are **NOT free**
  (constraint: unknown rejected — MEASURED check 6/6).
- The 17 (id · ctx): stealth/space-bunny-alpha 1M · inclusionai/
  ling-3.0-flash-sante:free 262K · qwen/qwen3.8-27b:free 262K · dots-studio/
  dots-3-note-preview:free 512K · liquid/lfm-2.5-2.6b 64K · nvidia/
  nemotron-3.5-lightning:free 1M · thinkingmachines/inkling-small:free 1M ·
  poolside/laguna-s-2.1:free 262K · thinkingmachines/inkling:free 1M ·
  poolside/laguna-xs-2.1:free 262K · cohere/north-mini-code:free 256K ·
  nvidia/nemotron-3-ultra-550b-a55b 1M · nvidia/nemotron-3-nano-omni-30b-a3b-
  reasoning 256K · google/gemma-4-26b-a4b-it:free 262K · google/
  gemma-4-31b-it:free 262K · nvidia/nemotron-3-super-120b-a12b 262K ·
  openrouter/free 200K.
- 11/17 carry the `:free` suffix (platform rate-limit scope, Q3); 6 are
  0-priced WITHOUT `:free` (stealth, lfm, nemotron×3, openrouter/free).
- Delta 20 raw-zero → 17 confirmed: 3 zero-priced entries among the 5
  normalizer-dropped (non-text/modality guards) — attribution NOT established
  (limitation below; non-blocking).

## Q3 — Documentation (fetched 2026-09-30)

- Free access: FAQ — `:free` "always provided for free and has low rate
  limits"; new users get "a small free allowance"; pricing page Free tier =
  50 req/day, "Get Started For Free". No client-origin restriction exists
  (nothing analogous to OpenCode's FreeTierError) — the API is designed for
  server-side calls (OpenAI-compatible).
- Rate limits (docs/api_reference/limits): `:free` variants → **20 req/min**;
  **50 req/day** if <10 credits purchased all-time, **1000 req/day** if ≥10
  (tier via GET /api/v1/key `free_model_daily_requests`); prepaid-spend
  budget gating explicitly "does not apply to requests to free models";
  negative account balance → 402 even for free models; upstream provider 429s
  carry `error.metadata.provider_code` and auto-fallback retries.
- Privacy: some 0-priced entries log prompts (stealth/testing offers:
  "prompts and completions are logged by the model creator") — classifier
  prompts contain only public model metadata, no user data.
- Tension: ToS (2026-08-31) says "requires users to purchase Credits to make
  API calls" while FAQ/pricing document a no-cost allowance — actual
  zero-credit account behavior UNVERIFIED (needs generation; forbidden here).

## Q4 — Can the existing classifier use a confirmed-free OR model with NO
production-code changes? **YES** — all six legs verified

discovery (:26-35/:110/:132) → connection gate (:121/:161, after connect) →
0/0 pricing→isFree (:62-65, MEASURED 17) → selection (not blocked :234,
ctx≥8000 all 17 pass :247) → credentials (service.ts:18,:115-151;
index.ts:521) → endpoint (index.ts:558 + :500-503 OpenAI shape). Failure
paths degrade safely: batch throw → per-batch deterministic fallback
(index.ts:533-546); selection null → whole-catalog deterministic (:862-864).

## Q5 — Minimum user action + generation-free validation

Action: obtain an OpenRouter API key → app connect flow
`POST /api/models/connect {provider:'openrouter', apiKey}`
(connect/route.ts:17-75) → `validateCredentials` = healthCheck
**GET /models** (client.ts:72-81, no generation) → `saveUserConnection` DB
row (service.ts:160-191) → background rebuild (connect/route.ts:59-63).
Env `OPENROUTER_API_KEY` alone is INSUFFICIENT (connection flag is DB-only,
service.ts:76-79; live group would be dropped at index.ts:161).
Validate without generation: connect-time healthCheck 200 (pre-save) +
`GET /api/v1/key` (docs: `free_model_daily_requests.limit/remaining`,
`limit_remaining` — read-only quota check) + catalog evidence after rebuild
(openrouter rows present, free count ≥17, `priceSource=live`,
`freeAuthority=explicit-zero`). Known blindness: healthCheck ≠ generation
permission (state.md:2313-2320) — applies here too.

## Q6 — How selection resolves once connected (COMPUTED by production code)

discoverModels merges static (no OR rows) + live OR (API order preserved by
normalizeAll) → rows with isFree=true enter `selectFreeModelForClassification`
(:245-256): score = coding2+reasoning2+tools1. MEASURED pick on the fresh
list: **`openrouter/inclusionai/ling-3.0-flash-sante:free`** (score 5).
~10 candidates tie at 5 (coding+reasoning+tools) — tie-break is stable sort
over input order = live/API order, so the pick is position-dependent and can
drift if the API list reorders (same discovery-order caveat as
state.md:2322-2331). All other current free models are opencode (blocked) ⇒
OR rows would be the only eligible free pool. Batch math: ~630-row catalog →
8 sequential batches/rebuild (≤80 each, index.ts:415) ≈ well inside 20/min;
daily rebuilds fit the 50/day free tier (~8) but NOT with headroom for many
manual refreshes; ≥10 credits raises to 1000/day.

## Files inspected (read-only)

skills.md (absent) · AGENTS.md · think/state.md (2262-2351, 2415-2430,
2432-2977, 2978-3110) · lib/ai/catalog/normalizers.ts:44-75, 234-291 ·
lib/ai/catalog/live.ts:14-35, 99-148 · lib/ai/catalog/registry.ts:14-73 ·
lib/ai/catalog/types.ts:79-141 · lib/ai/model-intelligence/index.ts:234-256,
500-554, 556-567, 836-867 · lib/ai/connection/service.ts (full) ·
lib/ai/providers/registry.ts · lib/ai/providers/openrouter/client.ts (full) ·
app/api/models/connect/route.ts (full) · OpenRouter docs (see Q3).
**Changed: only think/state.md** (+temp probe, deleted).

## Validation / cleanup / evidence freshness

- `npx tsc --noEmit` → 0 (with probe). Probe → public GET only (NO key, NO
  credits, NO generation), DELETED; scripts/ = 0. git status → 13 lines,
  unchanged baseline. No secrets involved (no key exists).
- Fresh (2026-09-30): OR model list + pricing + production normalizer/selection
  simulation; docs pages (limits/FAQ/free-variant/pricing; ToS dated
  2026-08-31). Unchanged prior evidence: health-check blindness
  (state.md:2313-2320), discovery-order variance (state.md:2322-2331).

## Unresolved questions

1. 20→17 zero-priced delta: which 3 were normalizer-dropped (non-text guard) —
   not attributed (needs a diff print; non-blocking).
2. Rate-limit scope for the 6 NON-`:free` 0-priced ids: docs cap `:free`
   specifically; FAQ speaks of "free models" generally — conservative
   planning assumes 50/day free tier.
3. Zero-credit account behavior (ToS "purchase required" vs FAQ "free
   allowance") — unverifiable without a generation request.
4. Generation permission on the target `:free` model — UNPROVEN (no
   generation allowed this task); HTTP-Referer/X-Title optionality not
   confirmed in docs (classifier omits them; attribution-only per docs
   context, unverified).

## Recommended next step (report-only — NOT taken)

User connects OpenRouter via the existing UI (zero credits needed for free
models per FAQ) → validate generation-free (healthCheck + /api/v1/key +
catalog free rows) → THEN, with explicit approval, ONE charge-impossible
classifier-shape POST to the selected `:free` model to prove generation
before any rebuild relies on it. No code changes: selection/discovery/
normalization already handle OR correctly; do NOT hardcode model IDs, do
NOT touch Free-mode rules or the opencode block.

---

# READ-ONLY VERIFICATION — OPENROUTER CLASSIFIER AFTER CONNECTION (2026-09-30)

**Status:** ✅ COMPLETE. Generation-free ONLY: DB SELECTs, `resolveUserCredentials`
(lengths only), GET /api/v1/key (read-only quota), public GET /models, and pure
exported functions (`selectFreeModelForClassification`, `applyBatchScores`,
`parsePersistedSource`, `describeScoringStatus`). NO generation, NO rebuild,
NO /api/models, NO aiClassify, NO credential/production-code changes. One temp
probe run once → DELETED; scripts/ = 0. git status = 13-line baseline, tsc 0.
`skills.md` absent.

## 1. Connection (MEASURED)

- `getProviderConnections` → **openrouter=true**; chutes/opencode/gemini/
  deepseek/zai/openai unchanged. env OPENROUTER_API_KEY absent; DB credential
  length **73** (never printed).

## 2. Key quota — GET /api/v1/key → 200 (read-only)

- `limit=null, limit_remaining=null` (no per-key cap), **usage=0 credits**
  (zero credits ever consumed), `is_free_tier=true` (no credits purchased),
  **`free_model_daily: used=8, limit=50, remaining=42`** (UTC-day counter).

## 3. Catalog rebuild result (SELECT only — NOT triggered by this audit)

- meta: fingerprint `chutes:deepseek:gemini:openai:opencode:openrouter:zai`
  (OR present ✓), model_count **623**, free **21**, paid 602,
  price_source 'live', **last_analyzed_at 2026-09-30T06:52:53Z** (today —
  the connect-triggered rebuild completed).
- rows=623 = meta count; **stale rows: fingerprintMismatch=0,
  analyzedAtMismatch=0**. (The old 164-vs-205/~41-stale issue is CLEAN for
  this cycle: the fingerprint change made delete-by-fingerprint remove all
  prior rows. The same-fingerprint staleness MECHANISM is unchanged —
  pre-existing, state.md:2424.)

## 4. OpenRouter pricing evidence (explicit zero ⇔ free)

- OR rows=**459** (464 raw − 5 normalizer drops, matches audit), all
  `price_source=live`; free=**17**; **freeOK (in=0 AND out=0 AND live)=17,
  violations=0, zeroPricedButNotFree=0** ✓. Catalog free by provider:
  {openrouter: 17, opencode: 4}. All 17 ids/ctx listed by probe (ctx
  64K–1M; ids match the readiness audit's 17, incl. 6 non-`:free` zero-priced).
- Public cross-check: GET /models 200, 464 total, explicit 0/0 = 20 (3
  normalizer-dropped as before) — stable vs audit.

## 5-6. Classification outcome — RAN, ZERO batches applied

- meta: **classified_by_ai=false, classification_model=null**; per-row:
  scoreOrigin **ai=0, deterministic=623**; raw source {live:621,
  registry:2}; `describeScoringStatus` → **"Metadata-scored"** (app's own
  verdict — honest, no AI claim).
- Partial/failure accounting: expected batches = ceil(623/80) = **8**;
  quota used = **8** → the rebuild's classifier ATTEMPTED all 8 batch
  requests (aiClassify only runs when selection is non-null — it is, see §7)
  and **0/8 produced usable output** → whole-catalog deterministic fallback
  fired exactly as designed (index.ts:533-546, :846-864). 8 of 50 daily
  free requests consumed; 0 credits.
- WHY 0/8 applied is UNRESOLVED generation-free — two branches: (a) HTTP
  failures (4xx/429/5xx), or (b) HTTP-ok but unusable/truncated output
  (80 entries × ~40-50 tokens vs max_tokens=4096 sits at the edge —
  HYPOTHESIS only, not demonstrated).

## 7. Selection + fallback verification (pure functions)

- `selectFreeModelForClassification` on current rows →
  **`openrouter/nvidia/nemotron-3-ultra-550b-a55b:free`** (confirmed-free,
  in=0/out=0/live, ctx 1M). Pick differs from the readiness-audit pick
  (ling) because score-5 ties break by input order (position-dependent —
  documented caveat, readiness Q6; probe SELECT had no ORDER BY).
- Simulated selection failure (OR rows removed → pre-connect state) →
  **null → deterministic fallback** (index.ts:862-864) ✓.
- `applyBatchScores(unusable output)` → **null → per-batch deterministic
  fallback** (index.ts:543-546) ✓. Both failure paths proven without any
  request.

## Files inspected / changed

skills.md (absent) · AGENTS.md · think/state.md (tail) ·
components/models/ProviderCard.tsx (full) · app/models/page.tsx:44, 76-140,
241-266, 352-376, 584-633 · app/api/models/route.ts (full) ·
app/api/models/connect/route.ts (from prior task) ·
lib/ai/catalog/scoringStatus.ts (full) · lib/ai/model-intelligence/
index.ts:623-674 (+ prior refs) · lib/ai/connection/service.ts (prior).
**Changed: only think/state.md** (+temp probe, deleted).

## Evidence freshness

Fresh 2026-09-30: connection, quota, catalog meta/rows, OR pricing audit,
selection, fallback proofs, public model list. No generation evidence exists
by design (none made).

## Unresolved questions

1. Root cause of 0/8 applied batches (HTTP failure vs unusable output) —
   the two branches are indistinguishable generation-free.
2. Rate-limit scope for the 6 non-`:free` zero-priced ids (carried from
   readiness audit).
3. Same-fingerprint stale-row mechanism (state.md:2424) — clean this cycle
   only because the fingerprint changed.

## Recommended next step (generation-free first, then STOP before any
generation test)

Ask the user for the dev-server console lines from the ~06:52Z rebuild —
`[model-intelligence] AI classification batch … failed:` (throw branch =
HTTP error + status) vs silent `… deterministic-fallback` (parse branch =
unusable output). That single readout resolves Q1 without any request.
Only AFTER that diagnosis — and with explicit approval — a one-off
generation test (free model, $0) may be considered. Do NOT rebuild,
reconnect, or change code before then.

---

# READ-ONLY DIAGNOSIS — OPENROUTER CLASSIFICATION FAILURE FROM EXISTING LOGS (2026-09-30)

**Status:** ✅ COMPLETE. No generation, no rebuild, no credential/production-code
changes, NO probe added (justified below — no read-only probe can answer this).
Only `think/state.md` changed. git baseline untouched.

## 1. Log availability — **DEV-SERVER LOGS UNAVAILABLE ON DISK (stated clearly)**

- Verified: `**/*.log` → none in repo; 10h recent-file scan (excl. node_modules/
  .next/.git) → only `next-env.d.ts`, `tsconfig.tsbuildinfo`, `think/state.md`.
- Process tree: `Code.exe → powershell.exe (PID15572) → npm run dev (11948) →
  next dev (13780) → start-server (16744) → worker (21488)`; `package.json`
  `"dev": "next dev"` — **no redirection, no tee, no log file**. The rebuild's
  console output exists ONLY in the user's **VS Code terminal scrollback**,
  which this audit cannot read.
- Persisted diagnostics exhausted: `model_catalog_meta` carries NO error
  fields (storeCatalog writes only counts/flags/clock — index.ts:756-762);
  rows carry only `source`/scores (toCatalogRow index.ts:623-639). Migrations
  (supabase/migrations/*.sql) contain no classifier-diagnostics table.
- OpenRouter side: no usable per-request history — `/api/v1/generation?id=`
  needs a generation id (only returned inside successful response bodies, docs
  2026-09-30); the analytics endpoint "Get user activity grouped by endpoint"
  requires a **management key** (we hold only a regular key) and is aggregated
  anyway. ⇒ A read-only probe COULD NOT answer the question → **none was
  added** (per constraint), and a replay would be a generation request (forbidden).

## 2. Failure cause — **UNDETERMINED** (quota NOT used as cause evidence)

HTTP/API error vs rate limit vs parsing/schema vs incomplete output vs token
limit: **cannot be distinguished from surviving artifacts.** Quota
`used=8` corroborates only that 8 free-model requests occurred — per task
rules it is explicitly NOT read as cause. Known: 0/8 batches applied →
deterministic fallback (already established, state.md §verification entry).

## 3. Failure-handling branches + distinguishing evidence
(model-intelligence/index.ts, exact lines)

| Branch | Trigger | Code path | Console signature (scrollback) |
|---|---|---|---|
| A. HTTP/transport | fetch throw; `!response.ok` (400/401/402/403/**429**/5xx) → `throw 'AI classification call failed: <status>'` (:505); `res.json()` throw | catch :535-537 | **`warn('[model-intelligence] AI classification batch N/M failed:', err)`** + status text |
| B. Silent unusable output | `applyBatchScores` → null: no `[…]` (truncated/prose) :455-457; JSON.parse throw :458-461; `scores.length < batch.length` :463 — **or 200-response whose body holds only `error` and no `choices`** (OpenRouter docs: failures after header-accept arrive inside a 200 body) → `content=''` :507 → null | no throw; :543-546 | **NO warn** — only `batch N/M (80 models): deterministic-fallback` (:547) + `total: 0/623 … (0/8 batches applied)` (:549) |
| C. Credentials | no key for provider → throw :522 | caught at getOrBuildCatalog :856-857 | different message: `AI classification failed:` (no 'batch N/M') |
| D. Selection-null | `selectFreeModelForClassification` → null | :862-864 | no classifier logs at all |

- **Evidence that separates A from B:** presence/absence of the
  `batch N/M failed:` warn line (A) vs silent `deterministic-fallback` (B).
  B's sub-causes (truncation at max_tokens=4096 vs short array vs
  200-error-body) are **invisible in all current logging** — the code logs
  neither the rejection reason of `applyBatchScores` nor `data.error`.
- **Diagnosability defects demonstrated (by code+docs mismatch, not by
  guess):** (i) classifyBatch checks only `response.ok` (:505) and reads
  `choices` without testing for an `error` body (:507) — OpenRouter documents
  that post-accept failures arrive as **HTTP 200 with an error-only body**;
  (ii) `applyBatchScores` null-reasons are never logged; (iii) nothing about
  batch outcomes is persisted to `model_catalog_meta`. Whether any of these
  CAUSED the 0/8 is unknown.

## 5. Smallest fix supported by evidence (RECOMMENDED, NOT implemented —
stopped per task)

1. **Zero-code, first:** user pastes the VS Code terminal `npm run dev`
   scrollback for `[model-intelligence]` lines around 2026-09-30 06:52Z —
   the A-vs-B signature above resolves the branch in one readout.
2. **If scrollback is gone:** the only fix currently evidence-supported is
   *failure-reason visibility* — throw/report when a 200 response carries an
   `error` body or missing `choices` (classifyBatch :505-508), and log WHY
   `applyBatchScores` rejected (:455-463), optionally persisting the last
   batch error to meta. This fixes PROVEN diagnosability gaps, not an
   unproven cause.
3. **Explicitly NOT yet evidence-supported (do not do):** lowering
   `AI_CLASSIFY_MAX_MODELS` (:415), model swap, header additions, retry/
   backoff — each presumes a branch not yet identified.

## Side finding (readiness-audit open question, resolved by docs)

`HTTP-Referer` / `X-Title` are **optional** (OpenRouter API reference,
2026-09-30: "Optional … for rankings") — the classifier's omission of them
(index.ts:500-503) is NOT a defect.

## Files inspected / changed

skills.md (absent) · AGENTS.md · think/state.md · package.json (scripts) ·
process list (node/next tree) · repo-wide *.log + 10h recent-file scan ·
supabase/migrations/*.sql (names) · lib/ai/model-intelligence/index.ts:454-549,
505-507, 623-639, 756-762, 846-864 · OpenRouter docs (error-handling,
generation/analytics endpoints). **Changed: only think/state.md.**

## Evidence freshness / limitations / next task

- Evidence: process/log scan + code trace + docs, all 2026-09-30; rebuild
  facts from the same-day verification entry.
- Limitations: terminal scrollback unreadable from here; B-sub-causes
  indistinguishable even WITH console lines; OpenRouter per-request status
  not retrievable with a regular key.
- **Next recommended task:** obtain the terminal lines (step 1) → re-run this
  diagnosis → only then design the cause-specific fix. STOP here — no fix
  implemented, no generation, no rebuild, no probes, no secrets/prompt
  contents printed.

---

# TASK — SAFE DIAGNOSTICS FOR OPENROUTER CLASSIFICATION FALLBACK (2026-09-30)

**Status:** ✅ COMPLETE per task scope. Root-cause fix deliberately NOT
implemented (stopped after diagnostics + report). **Files changed:**
`lib/ai/model-intelligence/index.ts` (surgical), `classify-diagnostics.spec.ts`
(new, root), `think/state.md`. Nothing else; no credentials, no API calls.

## Evidence driving the change

User-supplied terminal evidence for the 06:52Z rebuild: all 8 batches logged
`deterministic-fallback` with **NO `batch N/M failed` warnings** → the failure
sat in the silent output-rejection path (previous entry §3, Branch B). Exact
sub-cause (HTTP-200-error-body vs empty vs malformed/truncated vs incomplete)
unknown → goal is to make the NEXT occurrence self-describing, not to guess.

## Changes (index.ts only)

1. `applyBatchScores` (now :460-503): optional `onIssue(note)` callback.
   Sanitized reject categories (fixed literals / plain counts only):
   `nonstring-content`, `empty-content`, `no-json-array`, `json-parse-error`,
   `not-an-array`, `incomplete:<received>/<expected>`; non-fatal
   `schema:<n>-of-<m>-entries` when per-entry deterministic gaps fire.
   Return values unchanged.
2. `safeErrorCategory` (:512-523): error object → `code=<num|whitelisted>` /
   `type=<whitelisted ≤64>` / `category=unknown`. Error `message` and raw body
   are NEVER extracted (deliberately discarded).
3. `classifyBatch` (:531-563): now exported (probe hook, same pattern as
   aiClassify). HTTP 200 + `error` body + no `choices` → throw
   `classifier http200 api error: <cat>`; no choices/no error →
   `classifier http200 missing choices`; passes `onIssue` to applyBatchScores.
   Status path unchanged: `AI classification call failed: <status>`.
4. `aiClassify` loop (:587-605): per-batch `onIssue` keeps FIRST category;
   the existing fallback log line gains a ` [<category>]` suffix; thrown
   errors still surface via the existing `batch N/M failed:` warn.

**Sanitization guarantee:** log/throw payloads carry only HTTP status codes,
fixed category tokens, batch numbers, model counts. Never keys, headers,
response bodies, prompts, or model-generated content. (Pre-existing
`No API key for <provider>` message unchanged — provider name only.)

## Behavior preservation (verified by tsc + 16 tests)

Fallback, clamp/scoring, per-entry deterministic gaps, free-model selection,
batching (80), provider selection, no retries, max_tokens 4096 — all
untouched. Sole behavioral delta: HTTP-200-with-error-body now THROWS into the
existing catch (same deterministic-fallback outcome, now visible).
`applyBatchScores(batch, content)` without callback remains byte-compatible.

## Tests (mocked responses only — no network/creds/rebuild)

`classify-diagnostics.spec.ts` (root; run
`npx --no-install tsx classify-diagnostics.spec.ts`): global fetch stubbed
with canned `Response` objects, dummy key + `https://mock.invalid` base URL.
**16/16 PASS:** 429/401 status-only messages · 200+error code → `code=529` ·
type → `type=rate_limit_exceeded` · hostile type → `category=unknown` ·
missing choices · empty / no-json-array / json-parse-error /
`incomplete:0/2` / nonstring-content notes · valid output scores + `ai`
origin intact, no notes · schema gap → applied + per-entry `deterministic` +
`schema:1-of-2-entries` · choices-win-over-error · no-callback compat ·
key/sentinel leak scan (no TEST_KEY, no `RAW_*_SENTINEL` in any output).
Runner note: repo has NO test framework (package.json scripts = dev/build/
start/lint; TESTING.md:320) — spec uses the established npx-tsx idiom.

## Validation

- `npx tsc --noEmit` → **exit 0** (after one spec type fix)
- spec → **exit 0, ALL PASS (16/16)**
- `npm run lint` → **40 problems (12 errors, 28 warnings) = exact baseline**
- git: unchanged 13-line modified baseline + `?? classify-diagnostics.spec.ts`
  (new deliverable) + pre-existing `?? lib/ai/catalog/scoringStatus.ts`;
  scripts/ = 0.

## Remaining unknowns

- Which sub-cause hit the 06:52Z run is STILL unknown; the new diagnostics
  speak only on the next real classification (expected console: either
  `batch N/M failed: … <status|category>` or
  `deterministic-fallback [<reason>]` + `total: X/Y …`).
- Batch-error persistence to `model_catalog_meta` NOT added (kept minimal).
- No speculative root-cause fix (batch size / model swap / retry / token
  limit) — awaits the diagnostic output from a real run.

---

# TASK — VERIFY CLASSIFIER DIAGNOSTICS WITHOUT TRIGGERING REQUESTS (2026-09-30)

**Status:** ✅ COMPLETE. Static wiring confirmed, security audit passed,
**runtime verification PENDING** (reported honestly; nothing fabricated,
nothing triggered). **Files changed: this task → `think/state.md` only** (temp
read-only probe created, run, deleted; scripts/ = 0; no production code
touched).

## 1. Wiring confirmation — new categories ARE on the actual fallback path

Exact production chain (static, current code):
`getOrBuildCatalog` :906 `await aiClassify(...)` → per-batch loop :584-606:
- :592 `classifyBatch(batch, freeModel, apiKey, baseUrl, onIssue)` — `onIssue`
  closure captures FIRST category (:587-590);
- inside classifyBatch: HTTP status throw :551
  `AI classification call failed: <status>` → caught → :594
  `AI classification batch N/M failed:` warn; HTTP-200 checks :557-560 →
  `classifier http200 api error: <cat>` / `classifier http200 missing
  choices`; content → :562 `applyBatchScores(batch, content, onIssue)`;
- applyBatchScores rejects → `onIssue` notes (`nonstring-content`,
  `empty-content`, `no-json-array`, `json-parse-error`, `not-an-array`,
  `incomplete:<received>/<expected>`; non-fatal `schema:<n>-of-<m>-entries`);
- scored=null → deterministic fallback :603 + :605 log NOW suffixed
  ` [<category>]`; totals :607; whole-catalog catch :915 (unchanged).
The spec exercises these same exported functions — tested path == production
path.

## 3/4. Has a run occurred since the diagnostics? NO → RUNTIME VERIFICATION
PENDING (facts, no fabrication)

- Diagnostics edit timestamps: index.ts **2026-09-30T08:02:33Z**, spec
  08:05:28Z.
- Read-only SELECT `model_catalog_meta` (1 row, user 9efb32ca…, fingerprint
  7-provider, 623 models, classified_by_ai=false):
  `last_analyzed_at = 2026-09-30T06:52:53.871Z`, `updated_at = 06:53:01Z`
  — the only rebuild is PRE-diagnostics (06:52 < 08:02).
- `.next` files written after 08:02:33Z: **0** — dev server (node started
  06:37:50/56Z) has compiled nothing since the edit ⇒ `/api/models` not
  requested since the edit; new code not yet even compiled (lazy compile).
- `**/*.log` on disk: none → the 06:52 run's console output exists only in
  the VS Code terminal (unreadable here) AND predates the diagnostics, so it
  could not have emitted the new categories anyway.
- ⇒ **Zero affected-batch categories exist to report.** Per task, NO run was
  triggered to create them. Next real classification will print either
  `batch N/M failed: … <status|category>` or
  `deterministic-fallback [<reason>]` + `total: X/Y`.

## 5. Security audit — no credential/prompt/body/content exposure

- All 13 `console.*` sites in index.ts enumerated; grep for
  `content|prompt|apiKey|Authorization|body|data|response` in console calls →
  **no matches**.
- New surfaces: status is a number only (:551); `safeErrorCategory` reduces
  the error object to `code=<num|whitelisted≤64>` / `type=<whitelisted≤64>` /
  `category=unknown` — `error.message`/body deliberately never extracted
  (:512-523); `issueNote` = fixed literals + plain counts (category list
  above). Thrown Errors logged at :594/:915 carry only these tokens (+ file
  line numbers in stack).
- apiKey appears only in the Authorization header (:548); pre-existing
  `No API key for <provider>` message = provider name only (:576); the prompt
  exists only inside the request body (:549). Response `data` is read but
  never logged (only reduced to a category).
- Empirical backing: spec leak scan (16/16) — TEST_KEY and `RAW_*_SENTINEL`
  never appeared in any thrown/logged message.

## Validation (this task)

- Read-only probe (temp, deleted): SELECT exit 0, 1 row printed (timestamps
  above; no secrets printed).
- `npx tsc --noEmit` → **0**; `npx --no-install tsx
  classify-diagnostics.spec.ts` → **16/16 ALL PASS** (re-run post-verify).
- `npm run lint` → **12 errors/28 warnings = exact baseline**.
- git: unchanged 13 modified baseline + `?? classify-diagnostics.spec.ts` +
  `?? lib/ai/catalog/scoringStatus.ts`; scripts/ = 0.
- No production behavior changes; no `/api/models`, classification,
  generation, retries, or provider API calls triggered.

---

# TASK — TRACE OpenRouter `empty-content` ROOT CAUSE (2026-09-30)

**Status:** ✅ TRACE COMPLETE — cause NARROWED to a 5-shape collapse window,
NOT finally determined (external calls forbidden). **NO production code
changed** (spec fixtures only, for review).

## Evidence used (per task: local/logs/mocks/docs only)

- User-supplied dev logs: `deterministic-fallback [empty-content]` for
  classification batches **1–3** (first run after diagnostics). No
  `batch N/M failed:` warns reported.
- `**/*.log` on disk: none (re-globbed) — terminal-only; per constraint no
  OpenRouter/Supabase/`/api/models`/rebuild/generation/retry called, nothing
  fabricated.

## 1. Exact response path (classifyBatch, index.ts:531-563)

1. POST :546-550 (headers Content-Type + `Authorization: Bearer`; body
   model/messages/temperature 0.1/`max_tokens: 4096`).
2. `!response.ok` → throw `AI classification call failed: <status>` :551.
3. `data = await response.json()` :552.
4. `if (!data?.choices?.[0])` :557 → throw `classifier http200 api error:
   <safeErrorCategory>` (if `data.error`) else `classifier http200 missing
   choices` :558-559.
5. `const content = data.choices[0]?.message?.content ?? ''` :561 —
   **`?? ''` normalizes null/undefined/absent-message into `''` HERE.**
6. `applyBatchScores(batch, content, onIssue)` :562 → :469 non-string →
   `nonstring-content`; :470 `trim()===''` → **`empty-content`** → aiClassify
   :592 gets null → :603 deterministicRank + :605 log
   `deterministic-fallback [empty-content]` (batches 1–3).

## 2. Shapes accepted vs rejected (current code)

- **Accepted for AI scoring:** truthy `choices[0]` ∧ `message.content` is a
  non-empty STRING containing `[...]` JSON with ≥ batch.length entries.
- **Thrown (would show `batch N/M failed:`):** non-2xx; 200 error-only body
  without choices; 200 without truthy `choices[0]`.
- **Fallback categories:** `nonstring-content`, `empty-content`,
  `no-json-array`, `json-parse-error`, `not-an-array`,
  `incomplete:<r>/<e>`, non-fatal `schema:…`.
- **Producers of `empty-content` EXACTLY:** (a) `content === ''`;
  (b) whitespace-only string; (c) `content: null` (via `?? ''`);
  (d) `content` key absent (undefined → `?? ''`); (e) truthy `choices[0]`
  with missing/`null` `message` (e.g. `{index:0}` → undefined → `?? ''`).
  `choices[0]` null/0/''/false → caught by :557 → THROW, not this category.

## 3. Repo's other OpenRouter-compatible handling (comparison)

- All six provider clients extract identically — `data.choices[0]?.message?
  .content` with a falsy check → `throw '<X> returned empty response'`:
  openrouter :47-48, deepseek :45-46, zai :45-46, opencode :45-46, chutes
  :44-47, openai :44-47. They collapse null/''/missing THE SAME way, but as
  a thrown ERROR (visible to model-router error mapping), not a category.
- Repo-wide grep: NO code anywhere reads `message.refusal`,
  `reasoning`/`reasoning_content`, `tool_calls`, `finish_reason` (except
  gemini's own type), or handles structured array content → no local
  precedent to copy; the ONLY divergence is the classifier's `?? ''`
  pre-coercion + silent fallback category (:561).

## Confirmed findings (log/code-backed)

- **F1** HTTP 2xx for batches 1–3 (else `failed:` warn with status).
- **F2** NOT an error-only 200 body, NOT missing choices (both would throw
  :558/:559 → `failed:` warn absent from evidence). ⇒ those hypotheses
  **ruled out**.
- **F3** NOT structured/array/non-string content (would log
  `nonstring-content`). ⇒ string-vs-structured mismatch **ruled out** here.
- **F4** NOT prose/unparseable/short JSON (would log `no-json-array` /
  `incomplete`). ⇒ empty-string family, pre-parse.
- **F5** `:561 ?? ''` makes (a)-(e) **indistinguishable in today's log** —
  the exact diagnosability gap.
- **F6** Systematic across 3 consecutive batches (same target model, same
  prompt template) → consistent shape/behavior, not one-off noise.

## Unresolved hypotheses (NOT verified — ranked)

- **H1 `content: null`** (standard "no text" response) with sub-causes:
  refusal (`message.refusal`) · reasoning-only output
  (`message.reasoning`/`reasoning_content` present, final text empty;
  plausibly `finish_reason: length` burned `max_tokens=4096` during
  reasoning) · tool_calls (weak: classifier sends no `tools`).
- **H2** genuine `content: ""` from provider.
- **H3** truthy choice with missing/null `message`.
- **H4** whitespace-only content.
- **UNKNOWN (local):** which model was selected — position-dependent among
  score-5 free ties, not persisted when `applied=false`; if it is a
  reasoning model, H1-reasoning-budget gains plausibility. No local evidence
  either way (no DB read — constraint).

## Recommended smallest fix (FOR REVIEW — NOT implemented)

At :561, stop coercing — classify the shape first, emit a precise
**sanitized** category (booleans/whitelisted enums only, never text), then
pass the string on exactly as today (fallback behavior byte-identical):
- no/`null` message → `missing-message`
- `content == null` → `null-content` + flags `refusal-present` (boolean only
  — refusal TEXT never logged), `tool-calls-present`, `reasoning-present`,
  `finish_reason=<whitelist via safeErrorCategory-style charset test>`
- `''`/whitespace → `empty-content` (as today)
The next real run then distinguishes H1–H4 in one readout. Remedies for H1
(raise tokens / swap model / prompt change) remain OUT OF SCOPE until that
evidence arrives. Proposed future fixtures: the four shapes above, expecting
the new categories.

## Tests (mocked, local — added to classify-diagnostics.spec.ts)

4 fixtures documenting CURRENT collapse: `content:null → empty-content` (H1);
`content:null + refusal sentinel → empty-content, refusal text never in any
log/throw` ; `choices:[{index:0}] → empty-content` (H3); whitespace →
`empty-content` (H4).

## Validation (this task)

- `npx --no-install tsx classify-diagnostics.spec.ts` → **20/20 ALL PASS**
- `npx tsc --noEmit` → **0**; `npm run lint` → **12/28 exact baseline**
- git: unchanged 12 modified + 2 untracked; scripts/ = 0.
- No network (no OpenRouter/Supabase//api/models/rebuild/classification/
  generation/retries); no credentials/prompts/bodies/model content printed;
  no production behavior changes.

---

# TASK — IMPLEMENT SAFE OpenRouter EMPTY-CONTENT DIAGNOSTICS (2026-09-30)

**Status:** ✅ COMPLETE per spec. Approved refinement of the :561 `?? ''`
collapse (previous trace task) — now shape-classified BEFORE coercion.
**Files changed: `lib/ai/model-intelligence/index.ts` (one region),
`classify-diagnostics.spec.ts`, `think/state.md`.** Nothing else; no external
APIs; no rebuild/classification/generation triggered.

## Exact change (index.ts, classifyBatch, replaces the single `?? ''` line)

After the existing 200-body checks (:557-560, untouched), the response shape
is classified BEFORE any coercion; each rejection emits ONE sanitized
`onIssue` note (`category|flag…`) and returns null — identical fallback:

- `choice = data.choices[0]`; **`finish_reason` read from the CHOICE**
  (OpenAI-compat shape), whitelisted `/^[a-z0-9_]{1,32}$/` →
  `finish_reason=<value>` flag, else flag omitted (hostile strings never
  emitted).
- no/`null`/non-object `message` → **`missing-message`** (+finish flag).
- message-level booleans (truthy checks only, text never read into the
  note): **`refusal-present`**, **`tool-calls-present`**
  (non-empty array), **`reasoning-present`**
  (`message.reasoning` or `message.reasoning_content`, non-empty string or
  array).
- `content === null | undefined` → **`null-content`** (+flags).
- non-string content → **`nonstring-content`** (+flags) — category unchanged
  from before, now flag-capable.
- `''`/whitespace-only → **`empty-content`** (+flags) — unchanged category,
  now flag-capable.
- non-empty string → `applyBatchScores(batch, content, onIssue)` as before
  (parse-family notes `no-json-array`/`json-parse-error`/`not-an-array`/
  `incomplete:…`/`schema:…` unchanged, no flags).
- Success path: zero notes; metadata presence does NOT pollute applied
  batches (flag variables are discarded on success).

**Sanitization:** note tokens are fixed literals, booleans, and
whitelist-matched enums only. No response/refusal/reasoning/tool-call TEXT,
no bodies, prompts, credentials, or model content — asserted by tests.
**Preserved:** success scoring, fallback outcomes (null → deterministicRank),
provider/model selection, batch size 80, `max_tokens=4096`, no retries —
only the category string in the existing log line changes for shape rejections.

## Spec (baseline 20 → now 29 checks; 4 updated + 9 added; all old families kept)

Updated expectations (behavior intentionally refined per task):
`content:null → null-content` · `refusal → null-content|refusal-present` ·
`choice without message → missing-message` · whitespace → `empty-content`
(unchanged).
New cases: `message:null → missing-message` · `finish_reason=length` whitelist
accept · hostile `finish_reason` → flag omitted + sentinel never logged ·
`tool-calls-present` + payload sentinel never logged · `reasoning-present`
across `reasoning` (string), `reasoning_content`, and reasoning ARRAY — all
text sentinels never logged · `empty-content|finish_reason=stop` · success
WITH refusal+tool_calls+reasoning+finish present → applied, `notes: []`, no
sentinel anywhere. Existing 20-case families (HTTP statuses, http200 error
sanitization, missing choices, parse/incomplete, schema gap, choices-win,
compat, global key/sentinel leak scan) preserved verbatim.

## Results

- `npx --no-install tsx classify-diagnostics.spec.ts` → **29/29 ALL PASS**
- `npx tsc --noEmit` → **0**
- `npm run lint` → **40 problems (12 errors, 28 warnings) = documented exact
  baseline**
- git: 12 modified (same set as before) + `?? classify-diagnostics.spec.ts`
  + `?? lib/ai/catalog/scoringStatus.ts`; scripts/ = 0.

## Remaining uncertainty

- The LIVE batches 1–3 root cause still undetermined — this change makes the
  NEXT run print the precise shape (e.g.
  `deterministic-fallback [null-content|reasoning-present|finish_reason=length]`),
  which separates H1 sub-causes (refusal vs reasoning-budget vs no-text) in
  one readout. Which classifier model ran remains unpersisted (applied=false).
- No remedial action (token/model/prompt changes) taken — awaits that readout.
- `applyBatchScores`'s own empty/nonstring checks remain as defense-in-depth
  for direct/compat callers (unreachable from classifyBatch now).

---

# TASK — FINAL READ-ONLY AUDIT OF CLASSIFIER DIAGNOSTICS (2026-09-30)

**Status:** ✅ AUDIT COMPLETE. Read-only: NO code or test changes.
**Concrete discrepancy found: 1 (documentation, corrected below).**
**Files reviewed:** `lib/ai/model-intelligence/index.ts` (:440-645 focus),
`classify-diagnostics.spec.ts` (all 331 lines). Files changed by this task:
`think/state.md` only (this correction).

## CORRECTION (the concrete discrepancy)

state.md:3849 example claimed the next run prints
`null-content|reasoning-present|finish_reason=length` — **WRONG FLAG ORDER.**
`metaFlags` is built finish-first (index.ts:570 push `finish_reason`, then
:576 refusal, :577 tool-calls, :579 reasoning) and notes are
`['<category>', ...metaFlags].join('|')` (:573/:584/:588/:592) → actual
output for that shape is
**`deterministic-fallback [null-content|finish_reason=length|reasoning-present]`.**
Code is correct; only the prose example was wrong. (Also explains why no
multi-flag composition test exists — see Findings F1.)

## Six-point verification

1. **No sensitive exposure — CONFIRMED.** Grep of all `console.*` in index.ts
   for `content|prompt|apiKey|Authorization|body|data|response|refusal|
   reasoning|tool_calls|finish` → **no matches**. Enumerated surfaces:
   :551 status number · :558 `safeErrorCategory` (code/type ≤64 charset,
   `error.message` never read, :512-523) · :559 fixed literal · :570
   `finish_reason=` regex-gated · :573/:584/:588/:592 fixed category literals
   + flag literals · :576/:577/:580 booleans (values only truth-tested, never
   captured — `message.refusal` at :576, `tool_calls.length` at :577,
   `reasoning.trim()` emptiness-only at :579) · :627 warn payload = Error
   message+stack · :638/:640 issueNote + numeric literals. Prompt :544 exists
   only in fetch body :549; apiKey only in header :548; `data` never passed
   to any console call.
2. **finish_reason whitelist — CONFIRMED vs documented intent.** :570
   `/^[a-z0-9_]{1,32}$/`, anchored, non-string omitted (:569 typeof gate).
   Tests: accept `length` (spec:212-219) · reject `bad enum RAW_FINISH_SENTINEL`
   (spec:221-229). Observation (design, not bug): this is a CHAR-set
   whitelist, not a closed enum — a lowercase token like `custom_reason`
   would be emitted; bound = ≤32 chars, no whitespace/control/punctuation
   beyond `_`, so free-form response text cannot pass. Same standard as
   `safeErrorCategory` `type` (:519).
3. **Fallback preserved — CONFIRMED (unit level).** Every shape — missing
   message (:572-575), null/undefined content (:583-586), non-string
   (:587-590), empty/whitespace (:591-594) — returns `null` exactly as the
   pre-change path did (all collapsed → applyBatchScores reject → null) →
   aiClassify :633-636 `deterministicRank(batch)` unchanged → same scores,
   same `applied` accounting (:629-632), same totals (:640). Spec asserts
   `out === null` for all five classes (spec:122-150, :184-274). Integration
   branch not executed by tests (needs DB creds) — pre-existing, documented
   scope; branch is byte-unchanged from the previously verified baseline.
4. **Valid content path unchanged — CONFIRMED.** :595
   `return applyBatchScores(batch, content, onIssue)` is the identical call
   the pre-change code made; `applyBatchScores` (:460-503) untouched this
   task. Success tests: scores 80/60 + `ai` origin + `notes: []` (spec:
   :152-159), schema-gap per-entry fallback (:161-170), choices-win
   (:172-179), success-with-metadata ⇒ `notes: []` + full sentinel re-scan
   (:285-306) — metadata presence never pollutes the success path (flags are
   discarded when no rejection note is emitted).
5. **Sentinel tests genuine — CONFIRMED.** `allLogged` (spec:63) captures
   EVERY dynamic diagnostic payload: each `onIssue` note (:70) and each
   thrown message (:75) — i.e., exactly what aiClassify prints at :638 and
   :627. Per-case `includes()` asserts: refusal :197, finish :228, tool-call
   :238, reasoning :248/:267; success-path regex scan :305; global scan
   :313-318 (TEST_KEY + `/RAW_[A-Z_]+_SENTINEL/` + RAW_SPACES). `deepEqual`
   exact-match on every note additionally proves no content ever composes a
   note (any appended text would fail exact equality). Caveat: the global
   pattern is UPPERCASE-shaped — lowercase in-charset tokens would not match
   it, but the whitelist (point 2) is the control for that vector, and all
   spec sentinels are uppercase-named so every one IS scanned.
6. **Bugs / missing tests.** **No production bugs found.** Findings:
   - **F1 (test gap, confirmed):** multi-flag composition/order is untested —
     every fixture exercises exactly ONE flag; `missing-message|finish_*`
     (:573) never asserted. Order is only code-verified (:570 before
     :576-579) — which produced the doc discrepancy corrected above.
   - **F2 (observation, safe):** `message` as an Array passes the
     `typeof === 'object'` gate (:572) → categorized `null-content` instead
     of `missing-message`; outcome identical (null → fallback), no leak.
   - **F3 (observation, safe-by-omission):** `reasoning: ''` with non-empty
     `reasoning_content` → `??` (:578) keeps `''` → `reasoning-present` flag
     suppressed (flag miss, never a leak). Reverse (`reasoning: null`) works.
   - **F4 (observation):** duplicate emptiness predicates (:591 and :470)
     are byte-identical today (`trim()===''`); divergence risk only if one
     side is edited later (defense-in-depth by design).

## Validation (read-only run)

- `npx --no-install tsx classify-diagnostics.spec.ts` → **29/29 PASS, 0 FAIL,
  exit 0** (mocked fetch; no network)
- `npx tsc --noEmit` → **0**
- `npm run lint` → **40 problems (12 errors, 28 warnings) = documented exact
  baseline**
- git: 12 modified + 2 untracked — same set; scripts/ = 0.
- No network/API/rebuild/classification/generation; no secrets printed; no
  code or test modifications.

---

# TASK — RUNTIME REACH OF SHAPE DIAGNOSTICS FROM DEV LOG FILE (2026-09-30)

**Status:** ✅ COMPLETE. Read-only (dev log file + local code; no API, no DB,
no code changes). **Evidence materially changes the investigation → recorded
here.** Files changed: `think/state.md` only.

## CORRECTION — a dev log file existed all along

Earlier entries claiming no logs on disk (`**/*.log` → none: :3400, :3616,
:3667, plus the 09:30Z "no log files" report) **missed**
**`.next/dev/logs/next-development.log`** (created 2026-09-23T16:24:02Z) —
glob tools skip gitignored `.next/`, and raw mtime-window scans filtered it
out. File: 113252 bytes, 28 lines, holds only the CURRENT dev session
(timestamp column = session **uptime** `HH:MM:SS.mmm`, not wall clock; older
sessions' lines not present).

## The run — log-confirmed (uptime → UTC)

Dev session start derived **≈09:48:11.6Z** (line 28 uptime 01:12:46.663 =
file mtime 11:00:58.284Z). Sequence:

- 01:10:35–44 → **10:58:46–55Z**: browser page loads (dashboard).
- 01:11:00.759/.908 → **10:59:12.4Z**: `[model-intelligence] Static models
  after filtering: 14` + `Merged static (14) + live (619)` = **discoverModels
  ran** — correlates exactly with 7 fetch-cache writes 10:59:12–14Z and
  first route compile (app-paths-manifest 10:59:20Z).
- batches 1–5 logged 01:11:21.818 → 01:12:25.217 → **10:59:33–11:00:37Z**.
- batches 6/7/8 `failed: … 429` at 01:12:45.243–46.662 → **11:00:56.9–58.3Z**.
- `classification total` 01:12:46.663 → **11:00:58.3Z** (= file mtime).

⇒ The rebuild ran **during /api/models traffic**, ≥2.2 h AFTER the
08:45:50Z shape-diagnostics edit.

## Answers to both questions

1. **Did classification run during a request? YES** — full cycle (discover →
   8 batch attempts → totals `0/622 models AI-scored (0/8 batches applied)`,
   index.ts:640) at 10:59:11–11:00:58Z. The earlier supplied batches 1–3
   `[empty-content]` lines (08:28-era) also prove a run, under PRE-shape code.
2. **Was the UPDATED (shape) code reached? YES — runtime-confirmed.** Batches
   1–5 logged
   **`deterministic-fallback [null-content|finish_reason=length|reasoning-present]`**
   — a multi-flag note is producible ONLY by shape-era code: `null-content`
   index.ts:584, flags :570 (finish, whitelist) + :576-580 (booleans), note
   join :573/:584/:588/:592, first-wins capture :620-623, print :638.
   **Flag order matches the audit-corrected order exactly** (corroborates
   the :3868-3868 correction; old :3849 example remains wrong as noted).

## Response shape behind the old `empty-content` — IDENTIFIED

Batches 1–5: `choices[0].message` present, **`content === null`**,
**`finish_reason === 'length'`**, **`reasoning`/`reasoning_content`
non-empty** ⇒ **H1 CONFIRMED (reasoning-budget sub-cause)**: the classify
call sets `max_tokens: 4096` (index.ts:549; size note :408) — reasoning
tokens consumed the output budget before final text → provider returns null
content + length finish. **H2 (`""`), H3 (missing message), H4 (whitespace)
ruled out for this run** (each emits a different category). The 08:28-era
collapse cannot be proven retroactively (old code logged one token) — same
shape highly likely, NOT asserted as fact.

## Batches 6–8 — second, independent failure mode

`AI classification call failed: 429` (status-throw :551 → warn :627) →
issueNote empty → fallback line printed without brackets (:638, by design).
**429 cause unknown** (rate vs quota vs concurrency indistinguishable from a
status code; probing forbidden). Context: 5 requests succeeded within 64 s
first, then 429; arithmetic suggests daily-free ≪50 — no counter read this
task.

## Execution path (exact locations)

`app/api/models/route.ts:11` GET → auth :14-17 → **:19-20
`getOrBuildCatalog(user.id)`** → `index.ts:895`: fresh → serve :924 ·
fingerprint change → sync rebuild :902-914 · **time-stale (TTL
`CATALOG_TTL_MS=60min`, :93/:99) → serve persisted + background rebuild
:916-921** · no catalog → cold :927. Rebuild → `discoverModels` → :937-939
`aiClassify` → loop :617-639 → `classifyBatch` :531 → shape block :561-595
→ notes :638 / totals :640.

## Confirmed vs unknown

| Confirmed (log-backed) | Unknown (this task) |
|---|---|
| Run 10:59:11–11:00:58Z during /api/models traffic | Which rebuild branch fired (stale-bg :916 vs fingerprint :902 vs cold :927) — no DB read |
| Updated shape code reached in production | Cause of batches 6–8 HTTP 429 |
| H1 for batches 1–5: null content + finish=length + reasoning-present | Classifier model identity (unpersisted, applied=false) |
| 0/622, 0/8 → whole-catalog deterministic fallback | Whether 08:28-era `[empty-content]` was the same shape (likely, unproven) |
| H2/H3/H4 ruled out for this run | 06:52Z run's exact branch (its lines no longer on disk) |

## Constraints honored / validation

Read-only: log + local code greps only. No API/DB/rebuild/classification/
generation/retries; log quotes = fixed diagnostic tokens only (no secrets,
prompts, bodies, or model content). Production code untouched; git baseline
unchanged (12 modified + 2 untracked; scripts/ = 0).

## Next step (future task — NOT done here)

Evidence now supports a targeted, user-approved fix decision for H1
reasoning-budget: e.g. raise `max_tokens` (index.ts:549), pick a
non-reasoning classifier (selectFreeModelForClassification), and/or address
429 spacing. **STOP — no fix implemented.**

---

# TASK — DESIGN SMALLEST SAFE CLASSIFIER FIX (analysis only — 2026-09-30)

**Status:** ✅ COMPLETE. Design/recommendation only — **NO code changes**, no
API/DB/classification/`/api/models`/rebuild/retry. Only extra fetch: OpenRouter
PUBLIC DOCS (reasoning/parameters pages, 2026-09-30). Files changed:
`think/state.md` only. `skills.md` absent; `AGENTS.md` read (injected).

## Evidence discipline (confirmed vs inferred)

- **CONFIRMED (log, 10:59Z run):** batches 1–5 `content:null` +
  `finish_reason=length` + `reasoning-present` (5/5 identical);
  `max_tokens:4096` sent (index.ts:549); batches 6–8 HTTP 429.
- **INFERRED (strong, not proven):** reasoning tokens consumed (most of) the
  4096 budget. Proven only is: output cap hit + reasoning present + no final
  text. Exact reasoning size NEVER measured (diagnostics don't read
  `data.usage`). Compatible alternative: truncation during content phase with
  provider nulling partial content (less standard, unobserved).
- **NOT KNOWN:** whether any specific larger budget suffices; 429 cause.

## 1. Provider interfaces — reasoning-disable support: NONE exists

- `providers/base.ts:17-23` `AICompletionRequest` = messages, model,
  temperature?, maxTokens?, responseFormat? — **no reasoning field**; all
  six provider clients pass only these (openrouter client :24 `max_tokens`
  default 2048, etc.).
- The classifier **bypasses provider clients entirely**: raw fetch
  index.ts:546-549, body `{model, messages, temperature:0.1, max_tokens:4096}`.
- Endpoint is provider-derived: `aiClassify` :607-610 →
  `getBaseUrl(freeModel.provider)` :647-658 (7-endpoint map, fallback
  openai). Selection today = openrouter only **by coincidence**: eligible
  free = {openrouter:17} since opencode is blocked (:234) — NOT a code
  guarantee; a future free chutes/etc. model could be selected.
- **OpenRouter docs (2026-09-30):** `reasoning:{effort:'none'}` disables
  reasoning entirely — but support is PER MODEL (`supported_efforts`;
  some models `mandatory` → reject `'none'` with 400).
  `reasoning:{max_tokens:N}` budget carved FROM `max_tokens` (min 1024;
  docs: "`max_tokens` must be strictly higher than the reasoning budget").
  `exclude:true` still CONSUMES reasoning tokens (response hiding only —
  useless for budget). Reasoning tokens = output tokens (charged; $0 on
  free models).
- ⇒ Disabling reasoning generically is **not supported by any repo
  interface**; doing it correctly needs provider-conditional body params =
  the provider/model-specific hardcoding the task forbids.

## 2. Fix comparison (null-content/length)

| | A. Raise `max_tokens` :549 (4096→8192) | B. Disable/limit reasoning (`reasoning` param) |
|---|---|---|
| Size | **one literal** | new body field + provider guard + per-model support risk |
| Evidence fit | directly addresses proven `finish_reason=length` | addresses inferred mechanism (reasoning burn) |
| Compatibility | existing param, already 200-OK'd in every run; no new failure mode | OR-only; 400 on `mandatory` models → whole-batch fallback (could WORSEN runs); non-OR endpoints have divergent semantics |
| Cost/latency | $0 (free models); latency ↑ (batches already ~20 s) | fewer output tokens → faster/cheaper; high risk unverifiable without a request |
| Sufficiency | **UNPROVEN** (reasoning size unmeasured; free-thinking model may still burn any cap) | restores original design envelope (JSON ~80×40-50 tok fits 4096, comment :407-413) IF supported |

Rejected: C. prompt tweak (:544) — prompts don't control thinking tokens;
D. drop `+2 supportsReasoning` from selection :252 — changes documented
scoring ("formula unchanged" :240), non-reasoning free set unknown → could
yield null selection → permanent deterministic fallback. D remains a
legitimate FUTURE option, out of minimal scope.

**RECOMMENDATION (smallest safe change): A** — raise `max_tokens` at
index.ts:549 (4096 → 8192), one literal, zero new failure modes, $0.
Caveats stated honestly: sufficiency unproven; 8192 vs a model's own max
output should be docs-verified per model before choosing a value.
**B is the principled root-cause follow-up** — only with an
OpenRouter-endpoint guard (not model-name hardcoding) after verifying the
selected model's `supported_efforts`, and never `exclude:true` (no savings).
Existing shape diagnostics (:627/:638 + flags) will verify the next real run;
optional future evidence upgrade: log `usage.output_tokens` (numeric counts
only) to measure reasoning size.

## 3. 429 handling — existing inventory + safe options

**Existing:** classifier loop :617-639 — throw :551 → warn :627 →
per-batch deterministic fallback :633-637 → **continue immediately (no
pause, no retry)**. Grep: `retry|backoff|setTimeout|sleep|delay` in lib/ai
→ **zero**. Runtime model-router: `classifyError` maps 429 → `rate_limit`
(:109-110) but only auth/invalid_request are special-cased (:432-449) →
429 falls through to next-provider fallback, no delay. Natural retry
already exists: hourly stale-cycle background rebuild (:916-921, TTL :93).

**Safe options (no requests needed):**
1. **Keep as-is (recommended now):** cause unknown (rate vs quota vs
   concurrency); per-batch fallback + hourly rebuild already self-heal.
2. **Break on first 429:** smallest targeted change (one condition in
   :617-639) — skips futile requests, stops hammering; partial apply is
   already supported (`applied: appliedBatches>0` :644; per-batch fallback
   :634-636). Doesn't require knowing the cause.
3. NOT recommended now: honor `Retry-After` + bounded retry — adds retry
   semantics the design explicitly excludes ("proven-safe envelope" :612;
   spec asserts no retries) while cause is unknown.
4. NOT recommended: inter-batch spacing — 13–20 s gaps already present
   between batches 1–5 and 429 still hit → weak evidence, longer rebuilds.

## Files inspected / changed

skills.md (absent) · AGENTS.md (injected) · think/state.md (tail + append) ·
model-intelligence/index.ts:186-260, 400-560, 596-665, :617-645, :895-949 ·
providers/base.ts (full) · gateway.ts (full) · model-router/index.ts:80-155,
385-449 · greps (reasoning/429/retry/headers) · OpenRouter public docs
(reasoning-tokens, api parameters). **Changed: think/state.md only.**

## STOP

No code modified; no API/DB calls; no classification, `/api/models`,
rebuild, or retries triggered; no credentials/prompts/bodies/model content
printed (docs quotes = parameter names/semantics only).

---

# TASK — INCREASE CLASSIFIER OUTPUT BUDGET (implemented — 2026-09-30)

**Status:** ✅ COMPLETE per task scope. **Files changed: this task →
`lib/ai/model-intelligence/index.ts` (request body + 2 stale comments) and
`classify-diagnostics.spec.ts` (capturing stub + 1 focused test), plus
`think/state.md`.** No reasoning/prompt/model/provider/batch/fallback/429
changes; no retries, delays, or provider-specific params; no API/DB calls.

## Exact change

1. **index.ts:549** (classifyBatch request body):
   `max_tokens: 4096` → **`max_tokens: 8192`** — the ONLY behavioral change.
2. Comment truthkeeping (no behavior): the `AI_CLASSIFY_MAX_MODELS` doc
   block (:406-414) and the aiClassify "proven-safe envelope" comment
   (:612-614) both stated "4096" — updated to 8192 with raised-on provenance
   (the truncation observation is now marked "observed at 4096").
3. **spec**: fetch stub now captures the outgoing request body
   (`lastRequestBody`; stub still canned-response, zero network) + one new
   check `classifier request body sets max_tokens 8192 (no network)` —
   parses the captured body and asserts `max_tokens === 8192`. Existing
   structure supported this cleanly (stub already intercepts fetch).

## Validation (this task)

- `npx --no-install tsx classify-diagnostics.spec.ts` → **30/30 ALL PASS**
  (29 baseline + the new request-option test), exit 0.
- `npx tsc --noEmit` → **exit 0**.
- `npm run lint` → **40 problems (12 errors, 28 warnings) = documented exact
  baseline** (exit 1 = baseline behavior).
- git: same baseline set (12 modified + `?? classify-diagnostics.spec.ts`
  + `?? lib/ai/catalog/scoringStatus.ts`); scripts/ = 0. (index.ts diff-stat
  vs HEAD covers the whole uncommitted diagnostics session, not just this
  task.)

## Effectiveness — LIVE UNVERIFIED (stated per task)

- The 8192 budget addresses the PROVEN mechanism (`finish_reason=length`
  at 4096) but whether it SUFFICES is unknown: exact reasoning allocation
  was never measured (usage not logged), so a free-thinking classifier may
  still exhaust 8192. Confirmation requires the next real classification
  run — read `.next/dev/logs/next-development.log` for
  `classification batch … [null-content|finish_reason=length|…]` (failure
  recurring) vs `ai-applied` (fix effective). No such run was triggered by
  this task (forbidden).
- 429 handling untouched; batches 6–8 behavior unchanged (cause still
  unknown, per prior design entry).

## STOP

---

# TASK — INVESTIGATE json-parse-error AFTER 8192 (read-only — 2026-10-01)

**Status:** ✅ COMPLETE. Read-only: log + local code/tests only. **Files
changed: `think/state.md` only** — no production code, no tests, no
API/DB/`/api/models`/rebuild/classification/generation. `skills.md` absent;
`AGENTS.md` read (injected); git = same baseline (12 modified + 2
untracked; last commit 6372dbb 2026-09-26).

## The run (log-derived — `.next/dev/logs/next-development.log`, current
session only; earlier sessions rotated out)

- index.ts mtime **05:24:03Z** (the 8192 edit) < dev session start
  **≈05:27:57.9Z** (line 16 uptime 00:03:01.742 = mtime 05:30:59.658 at
  that poll) ⇒ **8192 was live** (index.ts:551 confirms `max_tokens: 8192`).
- discover 05:29:00.7 (static 14 + live 619) → 8 batches, uniform
  **~41 s cadence** → total line **05:34:26.6Z** (run ≈6.5 min, completed).

| Batch | Outcome (verbatim category) | Wall UTC (derived) |
|---|---|---|
| 1/8 (80) | `json-parse-error` | 05:29:38 |
| 2/8 (80) | `json-parse-error` | 05:30:20 |
| 3/8 (80) | `null-content\|finish_reason=length\|reasoning-present` | 05:30:59 |
| 4/8 (80) | `json-parse-error` | 05:31:43 |
| 5/8 (80) | `json-parse-error` | 05:32:24 |
| 6/8 (80) | **`no-json-array`** | 05:33:07 |
| 7/8 (80) | `json-parse-error` | 05:33:47 |
| 8/8 (62) | `json-parse-error` | 05:34:26 |
| total | `0/622 models AI-scored (0/8 batches applied)` | 05:34:26 |

**Task item 3 answered:** later batches logged **NO `ai-applied`, NO HTTP
429** — batches 4–8 = json-parse-error (4,5,7,8) / no-json-array (6).
(Contrast: yesterday's run had 429s on batches 6–8; today none — 429 cause
still unknown, nothing in code changed.)

## Established (log + code + tests)

- `json-parse-error` (index.ts:479) ⇒ content was a **non-empty string**
  (passed :471), the greedy `/\[[\s\S]*\]/` span existed (:474 check
  passed), and **`JSON.parse` threw** (:475-479). 6/8 batches.
- `no-json-array` (:474) ⇒ non-empty content with **no `]`-terminated
  bracket span at all**. 1/8 batch.
- Batch 3 **proves the output cap is still being hit at 8192**
  (`finish_reason=length`) — the raise did not eliminate length failures.
- Parse-family notes carry **NO message-level flags by design** (shape notes
  :575-594 get `metaFlags`; parse notes flow from :597 straight into
  applyBatchScores :474-483) — and the spec asserts exact equality
  (`['json-parse-error']`, spec:136-138) ⇒ **finish_reason/reasoning are
  INVISIBLE for the 7 parse-family batches** — the diagnosability gap that
  blocks cause attribution.
- Tests establish parser semantics only: truncated fixture
  `[{"codingScore":]` → json-parse-error (spec:134-138) — same category as
  observed, but not proof of the runtime cause.
- Uniform ~41 s per-batch cadence (including the length-flagged batch and
  the bracket-less one) is consistent with reasoning-heavy generations on
  every batch — **inference, not proof**.

## Unknowns (cannot be established generation-free)

1. **Truncation vs malformed vs multi-array echo** for the 6
   json-parse-error batches (greedy first-`[`/last-`]` span also rejects
   double-array prose) — flags absent on this path.
2. Whether batch 6's bracket-less content was prose or truncation-before-
   first-`]`.
3. Whether reasoning burned all 8192 or a provider/model output cap
   clamped lower (batch 3 proves cap hit, not which cap).
4. Classifier model identity (unpersisted, applied=false).
5. Why no 429 today vs 429 on batches 6–8 yesterday.

## Smallest safe fix — IDENTIFIED, NOT implemented (per task)

**Recommended next change: attach the already-computed `metaFlags` to
parse-family notes** — in classifyBatch (index.ts:597) wrap the onIssue
passed to `applyBatchScores` so parse rejections print e.g.
`json-parse-error|finish_reason=length|reasoning-present` vs
`json-parse-error|finish_reason=stop`:
- one wrapper at :597; flags already sanitized (whitelisted charset +
  booleans, :568-594); **no outcome change** (still null → deterministic
  fallback, byte-identical behavior otherwise);
- would split truncation (budget/effort lever) from malformed-output
  (prompt/parse lever) in ONE readout — currently no safe way to choose
  between those levers.
- Cost: spec exact-equality notes assertions (spec:128-150 etc.) must be
  updated alongside — deferred (tests frozen this task).

**Explicitly NOT recommended yet:** raising budget again (batch 3 shows
8192 insufficient, but whether 16384 helps depends on unknown reasoning
size/provider cap), reasoning params (provider-specific, rejected in design
entry), salvage-parsing (behavior change accepting partial data), batch-size
change (429 interaction). Root-cause lever selection awaits the flags
readout.

## Validation performed

- Log: full read + 3 polls across the run (caught live batches; final poll
  after total line) — all quotes are fixed sanitized category tokens only.
- Code: grep/reads of index.ts:408, :474-483, :551, :568-597 (current line
  numbers post-edit); spec fixtures :128-150.
- Environment: index.ts mtime vs session-start derivation; git status/log
  unchanged baseline.
- No network/API/DB; no code or test modifications; no secrets, prompts,
  response bodies, or model content read or printed (log holds sanitized
  category lines only — content was never written to disk).

## STOP

---

# TASK — PROPAGATE SANITIZED metaFlags INTO PARSE NOTES (implemented — 2026-10-01)

**Status:** ✅ COMPLETE per task scope (diagnostic-only). **Files changed:
`lib/ai/model-intelligence/index.ts` (one wrapper at :597-601),
`classify-diagnostics.spec.ts` (3 focused checks), `think/state.md`.** No
network/API/DB, no rebuild/classification/generation, no raw content logged.

## Exact change

1. **index.ts:597** (classifyBatch tail, replaces
   `return applyBatchScores(batch, content, onIssue);`): a local
   `noteWithFlags` wrapper — when `metaFlags` is non-empty AND the note is
   exactly `json-parse-error` or `no-json-array`, the note becomes
   `[note, ...metaFlags].join('|')` (e.g.
   `json-parse-error|finish_reason=length|reasoning-present`); every other
   note passes through unchanged. Sink passed only when `onIssue` exists;
   `applyBatchScores` itself untouched (direct/compat callers unaffected).
   - Flags are the EXISTING sanitized set (:568-582): whitelisted
     `finish_reason=<lowercase charset>` + boolean `refusal-present` /
     `tool-calls-present` / `reasoning-present` — no new data surfaces.
2. **Behavior preserved:** parse outcome still `null` → deterministic
   fallback; first-wins capture (aiClassify), prompts, batch size, token
   budget (8192), reasoning settings, provider/model selection, HTTP 429
   handling all untouched.
3. **spec (30 → 33 checks):** added
   `json-parse-error inherits sanitized flags (finish + reasoning
   booleans)` — asserts exact
   `['json-parse-error|finish_reason=length|reasoning-present']` + reasoning
   sentinel never in any log/throw; `no-json-array inherits sanitized flags
   (finish_reason only)` — `['no-json-array|finish_reason=stop']`;
   `other parse-family notes (incomplete) stay flag-free` —
   `['incomplete:1/2']` WITH `finish_reason=length` present, pinning the
   two-note-only scope. All fixtures are canned mocked responses (stubbed
   fetch, `https://mock.invalid`); existing bare-note tests (:131-141)
   unchanged and still pass (empty `metaFlags` ⇒ note identical).

## Validation (this task)

- `npx --no-install tsx classify-diagnostics.spec.ts` → **33/33 ALL PASS**,
  exit 0 (29 baseline + 1 max_tokens test + 3 new).
- `npx tsc --noEmit` → **exit 0**.
- `npm run lint` → **40 problems (12 errors, 28 warnings) = documented
  exact baseline**.
- git: same baseline set (12 modified + 2 untracked); scripts/ = 0.
- **No live calls:** spec fetch remains stubbed (dummy key +
  `https://mock.invalid`); no `/api/models`, rebuild, classification, or
  generation triggered; tsc/lint are local.

## Effect on the open investigation

Next real run will print e.g. `json-parse-error|finish_reason=length|
reasoning-present` (truncation → budget/effort lever) vs
`json-parse-error|finish_reason=stop` (malformed output → prompt/parse
lever) — the readout that selects the root-cause fix. Live effectiveness of
this diagnostic remains UNVERIFIED until that run occurs.

## STOP

---

# TASK — INVESTIGATE 8/8 CLASSIFICATION FAILURE (read-only — 2026-10-01)

**Status:** ✅ COMPLETE. Code+log+test reads only; **no tests run** (no
test-dependent claim needed), no network/API/DB, no run triggered, no
production/test file changes. **Files changed: `think/state.md` only.**
`skills.md` absent; `AGENTS.md` read (injected).

## Timeline (settles which code produced the run)

- Run (log): **05:29:38–05:34:26Z** Oct 1 — 8/8 fallback: 6×
  `json-parse-error`, 1× `no-json-array` (batch 6), 1×
  `null-content|finish_reason=length|reasoning-present` (batch 3); total
  `0/622 (0/8)`; no `failed:` warns ⇒ all 8 were HTTP 200 with truthy
  `choices[0]`; no 429 today.
- index.ts flags edit mtime **05:40:16Z**, spec 05:40:18Z ⇒ the run
  **predates the parse-note flag propagation** — its flag-less parse notes
  are a timing fact, not a bug. The new diagnostic has NEVER run live
  (log mtime unchanged 05:34:26 at 05:59:58 check).
- `max_tokens: 8192` WAS active (edit 05:24:03Z < session start ≈05:27:57Z).

## Q1 — provider/model/endpoint selection (code-proven mechanism; NO OpenRouter assumption)

1. `selectFreeModelForClassification` index.ts:245-255: filter
   `isFree && contextWindow>=8000 && !CLASSIFIER_BLOCKED_PROVIDERS` —
   blocked set = **{'opencode'}** only (:234, server-side 403 reason
   :223-233). Score = `supportsCoding?2 + supportsReasoning?2 +
   supportsToolCalling?1` (:251-253) — **no provider, model, endpoint,
   structured-output, or reasonableness-of-reasoning preference**; stable
   sort, first wins. Null ⇒ deterministic fallback (no request).
2. Creds: `aiClassify` :613-615 → `resolveUserCredentials` (service.ts:
   :104-157 — **ENV key wins** over DB row, :117-142) then
   `creds[provider] || envKeyForProvider(provider)`; missing → throw
   `No API key for <provider>` → whole-catalog catch.
3. Endpoint: `getBaseUrl(freeModel.provider)` :616, map :654-665 —
   per-provider URL (env-overridable, e.g. `OPENROUTER_BASE_URL`), unknown
   provider → `https://api.openai.com/v1` (:664 fallback). **Endpoint is a
   pure function of the selected model's provider** — nothing OR-specific.
4. What the run PROVES: the selected provider had a usable key, its
   `/chat/completions` returned HTTP 200, and the body had OpenAI-compatible
   `choices[0]` (else :559-562 would throw `failed:`/http200 categories —
   absent from log). **Which provider/model ran is NOT logged and NOT
   persisted** (applied=false → `classification_model=null` by design).
   Strong hypothesis only: the Sep-30 read-only audit measured catalog free
   by provider `{openrouter:17, opencode:4}`; opencode blocked ⇒
   OR-only eligible ⇒ default `https://openrouter.ai/api/v1` + user's DB
   OpenRouter key — consistent with, but not proven for, this run (catalog
   contents are not captured per run; no model id in any log line).

## Q2 — exact request body + response path (code)

- **Request :548-552:** `POST {baseUrl}/chat/completions`, headers
  Content-Type + `Authorization: Bearer <key>`; body `{model:
  freeModel.modelId, messages:[{role:'user', content: prompt}],
  temperature: 0.1, max_tokens: 8192}` (:551). **Single user message — no
  system message, no `response_format`, no `reasoning` param, no
  schema/grammar, no structured-output directive of any kind.** Prompt
  :546: natural-language scoring brief + `Return ONLY a JSON array` +
  one inline example.
- **Response:** status throw :553 → `json()` :554 → 200-body checks
  :559-562 (error-only body → `safeErrorCategory`; no choices → literal) →
  shape block :563-596: `finish_reason` read from choice, charset-whitelist
  → flag ONLY (:572) — **never used for control flow**; message-level
  booleans (refusal/tool-calls/reasoning via
  `message.reasoning ?? message.reasoning_content`, emptiness-only,
  :578-583) — **reasoning is never parsed, never treated as content**;
  `message.content` alone feeds :584; null/nonstring/empty → flagged notes
  (:586/:590/:594) → null → fallback.
- **Non-empty content** → wrapper :597-601 → `applyBatchScores` :461-504:
  typeof/trim checks → **greedy `/\[[\s\S]*\]/`** (:475) → strict
  `JSON.parse` (:477-479) → array + count checks (:481-482) → positional
  entry mapping, per-entry clamp, schema-gap per-entry fallback (:484-502).
  No repair parsing, no object support (an object body would fail the
  bracket regex → `no-json-array`), no schema validation of entries beyond
  field presence.

## Q3 — JSON format: requested vs assumed vs coded-to-support

- **Requested: NOTHING structured.** :551 sends no `response_format`.
- **Assumed:** the model spontaneously emits ONLY an array in `content`,
  per prompt instruction (:546). Pure prompt-level assumption.
- **Coded support elsewhere in the repo (established):**
  - The ANALYSIS path sends structured output everywhere: 5 stages
    (`lib/analysis/root-cause.ts:130`, `solution.ts:135`, `evidence.ts:130`,
    `patch.ts:141`, `relevant-files.ts:175`) pass
    `responseFormat:{type:'json_object'}` → gateway:127 → model-router:404
    → ALL 7 provider clients emit `response_format`
    (openrouter/chutes/deepseek/zai/openai/opencode client :25; gemini :75
    maps json_object specially). Interface: base.ts:22.
  - The CATALOG tracks per-model support from provider capability metadata:
    `supported_parameters` containing `response_format`/`structured_outputs`
    → `supportsStructuredOutput` (normalizers.ts:246-252; also :321 feature
    fallback; registry curated flags registry.ts entries), persisted
    (types.ts:101, index.ts:731) and surfaced in CatalogModel.
  - **The classifier uses NEITHER:** selection formula ignores
    `supportsStructuredOutput` (:251-253), and the raw fetch omits
    `response_format` (:551) — it bypasses the provider clients entirely.
- **Code-established mismatch risk (why response_format is NOT a
  drop-in):** the only supported structured type in the interface is
  `json_object` (base.ts:22), which yields an OBJECT — while the prompt
  demands an ARRAY (:546) and the parser requires a bracket span
  (:475/:481 — object ⇒ `no-json-array`). Adopting it requires coordinated
  prompt+parser changes, not a one-liner. Whether the (unknown) selected
  model accepts `response_format` is UNVERIFIED (no docs fetch permitted
  this task; capability data exists per model in the catalog but is not
  consulted by the classifier).

## Established vs hypotheses (per task item 4)

**Established (logs/code):** all facts in the run table above; HTTP-200 +
`choices[0]` for every batch; batch 3's response had `content:null`,
choice `finish_reason=length`, non-empty reasoning (shape flags come from
response fields, not inference); batch 1/2/4/5/7/8 content was non-empty
with an unparseable bracket span; batch 6 content was non-empty with NO
bracket span; request carried no structured-output directive; this run's
parse notes predate flag propagation.

**Hypotheses (NOT established — raw response contents NOT inferable from
flags):** that parse batches were length-truncated (finish_reason unknown
for them — flags absent by timing); what batch 6's text was (prose vs
pre-bracket truncation); which model/endpoint ran; how much reasoning
occupied the 8192 budget on any batch (batch 3 proves a cap hit, not the
allocation); whether `response_format` would be accepted; why no 429 today.

## Recommended single smallest next step (NOT implemented)

**Wait for the next NATURAL classification run (stale-TTL background
rebuild fires on ordinary usage) and read the now-shipped flagged parse
notes** — zero new code, zero triggered requests:
`json-parse-error|finish_reason=length|…` ⇒ budget/effort lever;
`…|finish_reason=stop` (or absent finish flag) ⇒ prompt/parser lever
(structured output via the catalog's existing `supportsStructuredOutput`,
with prompt+parser aligned). Do NOT adopt `response_format` first: the
json_object/array mismatch is code-established and selected-model support
is unverified.

## Validation performed

Read-only: log (mtime + full model-intelligence lines), index.ts
:234-255/:406-414/:532-563/:563-601/:613-616/:645/:654-665, service.ts
:36-46/:104-157, normalizers.ts :246-263, greps (responseFormat/
supportsStructuredOutput/selection/creds), file mtimes, git baseline
(12+2 unchanged). No tests run (no test-dependent claim), no network, no
code/test changes, no credentials/prompts/bodies/content printed.

## STOP

---

# TASK — THREE-ISSUE READ-ONLY TRIAGE (flags timing · hydration · session expiry — 2026-10-01)

**Status:** ✅ COMPLETE. Read-only (local files/logs only); **no tests run,
no network/API/DB, no discovery/classification/generation/rebuild triggered,
no production/test file changes. Files changed: `think/state.md` only.**
`skills.md` absent (glob confirmed); `AGENTS.md` read (injected).

## Issue A — were metaFlags diagnostics active for the latest run? NO (timing)

- index.ts flags-edit mtime **05:40:16Z** (verified this task).
- Log file `.next/dev/logs/next-development.log`: 23 lines, mtime
  **08:26:32.196Z**; last model-intelligence line = total at session uptime
  **00:06:28.559**; last file line uptime **02:58:34.268** (Browser
  DevTools INFO) ⇒ same session start ≈05:27:57.9 + 02:58:34 ≈ 08:26:32 ✓
  matches mtime ⇒ **single dev session, no restart/truncation** since the
  05:27 session start.
- Therefore the only classification run on disk = **05:29:38–05:34:26Z**,
  which **ended ~5m50s BEFORE the 05:40:16Z flags change**. No
  model-intelligence line exists after uptime 00:06:28 ⇒ **no run has
  occurred since the change**.
- **Conclusion: the metaFlags parse-note diagnostics were NOT active during
  the latest run and remain live-unverified.** The pasted terminal
  scrollback (hydration error + discovery + 8 batches + PUT preference
  interleaves + auth/github errors) = that same 05:29–05:34 run plus 08:26
  page-load activity — NOT a second run (no second set of
  model-intelligence lines in the file; log quotes are the fixed sanitized
  category tokens only).
- Flag-less `json-parse-error` notes in the paste are fully explained by
  timing (same conclusion as the prior entry, now re-verified against the
  08:26 file state).

## Issue B — ThemeToggle hydration mismatch (app-caused; smallest safe fix identified)

- `components/theme/ThemeProvider.tsx:19`: `getInitialTheme()` returns
  `'light'` when `typeof window === 'undefined'` ⇒ **server ALWAYS renders
  light**; client `useState(() => getInitialTheme())` (:41-42) reads
  localStorage key `bugwiser-theme` (:16/:21-22) or prefers-color-scheme
  (:24-25) on the FIRST client render ⇒ when stored theme = dark, first
  client render ≠ server render.
- `components/theme/ThemeToggle.tsx:17-18` (theme-conditional
  aria-label/title) and **:21-25 (Sun/Moon children swap)** — exactly the
  logged diff (`+aria-label "Switch to light mode"`, `+Sun`).
- `suppressHydrationWarning` would NOT suffice: the mismatch is a children
  element swap, not attributes-only.
- **Smallest safe fix (identified, NOT implemented):** always render BOTH
  `Sun` and `Moon`, control visibility with Tailwind dark-variant classes
  (`hidden dark:block` / `dark:hidden`), and make `aria-label`/`title`
  theme-independent (e.g. "Toggle theme"). DOM then identical SSR/client ⇒
  no hydration mismatch; onClick untouched. Works because: (1)
  `app/globals.css:5` `@custom-variant dark (&:is(.dark *))` = **class-based**
  dark variant, and (2) ThemeProvider `applyTheme` (:30-38) toggles `.dark`
  on `document.documentElement` ⇒ CSS follows the class with zero JS
  divergence in rendered DOM.
- **Separate, NOT app-fixable:** the other hydration errors in the log are
  browser-extension-injected attributes (`bis_skin_checked`,
  `__processed_*`) — independent contributor, cannot be fixed in app code.

## Issue C — GitHub session-expiry message: EXPECTED validation, not failure

- The pasted `GET /auth/github?error=Your+GitHub+session+has+expired...`
  (two hits, 08:26 era) maps to **proxy.ts:48-61** (Next 16 middleware):
  authenticated Supabase user + `session && !session.provider_token` ⇒
  redirect with the error param **before** the protected page renders.
  Comment :43-47 documents it as deliberate; matches the documented
  canonical predicate `isGitHubSessionValid = !!session?.provider_token`
  (`lib/supabase/auth-session.ts:23-25`, :27 message constant; doc :14-16
  notes Supabase emits `provider_token` only at sign-in and TOKEN_REFRESHED
  drops it).
- Distinct from unexpected failure: no-user ⇒ plain redirect WITHOUT error
  (proxy.ts:37-41, signed-out ≠ expired); auth-session.ts:18-21 explicitly
  excludes rate limits/404/5xx/network from "expired".
- Second producer `app/dashboard/page.tsx:102-108`: same expected condition
  (missing provider_token or GitHub 401) → `redirect()` to the same URL.
- **Verdict: expected session validation working as designed.** Open
  uncertainty (not a bug): WHY provider_token was absent at 08:26 (most
  likely sign-in-age/token-refresh semantics — by design, not diagnosable
  from local logs).

## Task item 4 — keep issues separate; recommended NEXT single task

- Issue C: no action (working as designed).
- Issue A: passive — awaiting next natural classification run for flagged
  notes; nothing actionable now.
- **RECOMMENDED next task: fix Issue B** — the ThemeToggle dual-icon +
  constant-label change (one component, no behavior change, no deps,
  no new failure mode; verification = reload with dark theme stored, watch
  dev log for absence of the ThemeToggle.tsx:22 hydration error).

## Validation performed

Read-only: log file metadata + full model-intelligence line extraction +
last-2-line tail; index.ts mtime; ThemeToggle.tsx (full), ThemeProvider.tsx
(full), globals.css dark-variant grep, proxy.ts (full), auth-session.ts
(full), dashboard/page.tsx:92-117; grep "session has expired" (3 hits);
glob skills.md (absent). No tests run; no network; no secrets/raw responses
printed; git untouched by this task.

## STOP

---

# TASK — FIX THEMETOGGLE HYDRATION MISMATCH (implemented — 2026-10-01)

**Status:** ✅ COMPLETE per task scope. **Files changed: this task →
`components/theme/ThemeToggle.tsx` only (+ `think/state.md`).**
`skills.md` absent (re-confirmed); `AGENTS.md` read (injected). No
ThemeProvider/auth/classification/model/unrelated-component edits; no
network/API/DB/discovery/classification/generation/rebuild triggered;
browser-extension attribute noise deliberately ignored per task.

## Exact change (`components/theme/ThemeToggle.tsx`, 28 → 25 lines, +5/−8)

1. **Both icons always rendered** — replaces the theme-conditional
   ternary (`resolvedTheme === 'dark' ? <Sun/> : <Moon/>`, old :21-25) with:
   - `<Sun className="hidden w-4 h-4 dark:block" />` (visible only under
     `.dark` on html)
   - `<Moon className="block w-4 h-4 dark:hidden" />` (visible only in light)
2. **Constant accessible labels** — old theme-conditional
   `aria-label`/`title` ("Switch to light/dark mode", old :17-18) → both
   `"Toggle theme"` (:17-18).
3. **Unused destructure removed** — `resolvedTheme` no longer read;
   `const { toggleTheme } = useTheme()` (:11) (keeps tsc/lint clean; the
   ternary was its only consumer).
4. **Preserved:** `onClick={toggleTheme}` (:16), all button classes,
   ThemeProvider contract, visual appearance (one icon shown per theme —
   flex row with the other `display:none` ⇒ no layout change).

SSR/client DOM is now byte-identical (server renders light-state markup;
client renders the same markup regardless of stored theme — visibility is
pure CSS via the class-based dark variant `globals.css:5`
`@custom-variant dark (&:is(.dark *))` + ThemeProvider's `.dark` html-class
toggle :30-38) ⇒ the logged ThemeToggle.tsx:22 hydration mismatch cannot
recur. The separate extension-injected-attribute hydration noise is
out of scope per task (not app-fixable).

## Validation (this task)

- `npx tsc --noEmit` → **exit 0**.
- `npm run lint` → **40 problems (12 errors, 28 warnings) = documented
  exact baseline** (exit 1 = baseline behavior).
- `npx --no-install tsx classify-diagnostics.spec.ts` → **ALL PASS (33/33)**,
  exit 0 (local stub, dummy key + `https://mock.invalid`, zero network).
- git: modified set = prior baseline 12 + **`components/theme/ThemeToggle.tsx`
  (this task)** = 13 modified + 2 untracked; scripts/ = 0; diff-stat for
  the file: 5 insertions, 8 deletions.
- Runtime verification (visual/dark-theme reload + dev log free of the
  ThemeToggle hydration error) is NOT possible without triggering page
  loads — left as the user's next natural reload; no checks were run that
  could cause API/DB/model traffic.

## STOP
