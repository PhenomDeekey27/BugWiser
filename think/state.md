# think/state.md — Implementation State

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
