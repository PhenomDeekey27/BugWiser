'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  PlusIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  Settings2Icon,
  SearchIcon,
  XIcon,
  FileSearchIcon,
  BrainIcon,
  ClipboardListIcon,
  LightbulbIcon,
  WrenchIcon,
} from 'lucide-react';
import type { GitHubUser } from '@/types';
import { ProviderCard } from '@/components/models/ProviderCard';
import { StageConfigPanel } from '@/components/models/StageConfigPanel';
import { markProviderConnected, markProviderDisabled, markProviderDisconnected, runConnect, runDisconnect } from '@/components/models/connectState';
import { revalidateUntilSettled } from '@/components/models/catalogRevalidation';
import {
  buildStageCandidatePool,
  bucketStageModels,
  filterStageModels,
} from '@/components/models/stageCandidates';
import { selectStageModels, deriveAutomaticStagePicks, type SetupChoice, type StageKey } from '@/lib/ai/catalog/stageSelection';
import { buildStageOverrides, resolveAppliedOverride } from '@/lib/ai/catalog/stageOverrides';
import { buildPreferenceSaveBody, deriveStageSelectionState, deriveStageStatus } from '@/lib/ai/preferenceMode';
import type { StageOverrideEntry, StageOverrideOrigin } from '@/lib/ai/catalog/overrideReconcile';
import { describeScoringStatus } from '@/lib/ai/catalog/scoringStatus';
import { estimateCostUsd, formatCostUsd, type CostEstimate } from '@/lib/ai/catalog/cost';
import { STAGE_TOKEN_PROFILES, type StageTokenProfile } from '@/lib/ai/catalog/stageTokenProfiles';

const STAGES = [
  { id: 'relevant_file_discovery', label: 'File Discovery', icon: FileSearchIcon, task: 'relevant_file_discovery', provider: 'simple_coding' },
  { id: 'root_cause_analysis', label: 'Root Cause Analysis', icon: BrainIcon, task: 'root_cause_analysis', provider: 'complex_debugging' },
  { id: 'evidence_extraction', label: 'Evidence Extraction', icon: ClipboardListIcon, task: 'evidence_extraction', provider: 'evidence_extraction' },
  { id: 'solution_generation', label: 'Solution Generation', icon: LightbulbIcon, task: 'solution_generation', provider: 'code_generation' },
  { id: 'patch_generation', label: 'Patch Generation', icon: WrenchIcon, task: 'patch_generation', provider: 'code_generation' },
];

// Per-stage token estimates come from STAGE_TOKEN_PROFILES (lib/ai/catalog/
// stageTokenProfiles.ts) and ALL cost arithmetic from the shared helper in
// lib/ai/catalog/cost.ts — do not add local cost formulas here.

type StageModel = { stageId: string; label: string; selectedProvider: string | null; selectedModel: string | null; isOverride: boolean; /** Strict Free: no confirmed-free model available for this stage. */ unavailable?: boolean; origin?: StageOverrideOrigin; };

export interface CatalogProvider { providerId: string; displayName: string; authType: 'api_key' | 'oauth' | 'none'; status: 'disconnected' | 'connected' | 'error'; connectedAt: string | null; serverConfigured: boolean; /** Where the effective connection comes from: the user's own row, the server env credential, or null (unavailable/disabled). Safe metadata only. */ connectionSource?: 'user' | 'server' | null; /** Per-user tombstone: server env exists but this user disabled the provider. */ disabled?: boolean; description: string; docsUrl: string; /** Non-secret endpoint display metadata; set for connected 'local'. */ baseUrl?: string | null; }

export interface CatalogModel { providerId: string; modelId: string; displayName: string; contextWindow: number; maxOutputTokens: number | null; price: { input: number | null; output: number | null; isFree: boolean }; /** Where the price came from: 'live' | 'registry' | 'unknown'. */ priceSource: string; /** ISO timestamp of the last price confirmation, null when unknown. */ priceFetchedAt: string | null; supportsReasoning: boolean; supportsToolCalling: boolean; supportsStructuredOutput: boolean; capabilities: string[]; availability: string; scores: { coding: number; reasoning: number; speed: number; longContext: number }; valueScore: number; tags: string[]; fit: number; stageFit: Record<string, number>; available: boolean; /** Actual score origin for this row (absent on older payloads). */ scoreOrigin?: 'ai' | 'deterministic'; }

export interface Preference { user_id: string; provider: string | null; model: string | null; selection_mode: 'auto' | 'manual'; selected_strategy?: 'auto' | 'free' | 'free_paid' | 'fully_paid' | 'custom' | 'balanced' | 'quality'; stage_overrides?: Record<string, StageOverrideEntry>; }

export default function ModelsPage() {
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [providers, setProviders] = useState<CatalogProvider[]>([]);
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [preference, setPreference] = useState<Preference | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showStageModal, setShowStageModal] = useState<string | null>(null);
  const [selectedStageProvider, setSelectedStageProvider] = useState<string>('');
  const [selectedStageModel, setSelectedStageModel] = useState<string>('');
  const [selectedStageReason, setSelectedStageReason] = useState<string>('');
  const [selectedStageIsOverride, setSelectedStageIsOverride] = useState<boolean>(false);
  const [stageModels, setStageModels] = useState<Record<string, StageModel>>({});
  const [setupChoice, setSetupChoice] = useState<SetupChoice | null>(null);
  const [applyingSetup, setApplyingSetup] = useState<SetupChoice | null>(null);
  // One revalidation loop at a time: a connect/disconnect can land while the
  // initial page read is still revalidating.
  const revalidatingRef = useRef(false);
  // Catalog-level classification flags from /api/models (absent/null handled
  // by describeScoringStatus — the badge renders nothing when unknown).
  const [scoring, setScoring] = useState<{ classifiedByAi?: boolean | null; classificationModel?: string | null }>({});

  const connectedProviders = useMemo(() => providers.filter((p) => p.status === 'connected'), [providers]);
  const connectedProviderIds = useMemo(() => new Set(connectedProviders.map((p) => p.providerId)), [connectedProviders]);
  const libraryBaseModels = useMemo(
    () => models.filter((m) => m.available && connectedProviderIds.has(m.providerId)),
    [models, connectedProviderIds]
  );
  const scoringStatus = useMemo(
    () => describeScoringStatus({ classifiedByAi: scoring.classifiedByAi, classificationModel: scoring.classificationModel, rows: models }),
    [scoring, models]
  );
  const selectionState = deriveStageSelectionState(
    preference?.selection_mode,
    preference ? { provider: preference.provider, model: preference.model } : null
  );

  const automaticPicks = useMemo(
    () => deriveAutomaticStagePicks(setupChoice, libraryBaseModels),
    [setupChoice, libraryBaseModels]
  );

  /** Stage rows AS DISPLAYED: a saved/setup/manual override row when it holds
   *  a selection (or a strict-Free marker), otherwise the DERIVED automatic
   *  pick for the connected catalog. Derived rows keep isOverride=false / no
   *  origin so they are never persisted — connecting a provider only changes
   *  this view, it never creates stage_overrides entries. */
  const displayStageModels = useMemo(() => {
    const rows: Record<string, StageModel> = {};
    for (const stage of STAGES) {
      const sm = stageModels[stage.id];
      if (sm && (sm.unavailable || (sm.selectedProvider && sm.selectedModel))) {
        rows[stage.id] = sm;
        continue;
      }
      const pick = automaticPicks[stage.id as StageKey];
      rows[stage.id] = {
        stageId: stage.id,
        label: stage.label,
        selectedProvider: pick?.provider ?? null,
        selectedModel: pick?.model ?? null,
        isOverride: false,
        unavailable: pick?.unavailable === true,
        origin: undefined,
      };
    }
    return rows;
  }, [stageModels, automaticPicks]);

  const loadData = useCallback(async () => {
    const supabase = (await import('@/lib/supabase/client')).createClient();
    const { data: { user: au } } = await supabase.auth.getUser();
    const res = await fetch('/api/models');
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error((d as { error?: string }).error || 'Failed to load models');
    }
    const data = await res.json();
    return { user: au, data };
  }, []);

  const applyData = useCallback((payload: { user: { user_metadata?: Record<string, unknown> } | null; data: { providers?: CatalogProvider[]; models?: CatalogModel[]; preference?: Preference; stageOverridesReconciled?: boolean; droppedStageOverrides?: string[]; classifiedByAi?: boolean; classificationModel?: string | null; analyzedAt?: string; catalogPending?: boolean; }; }) => {
    const au = payload.user;
    const meta = au?.user_metadata ?? {};
    setUser({ login: (meta.user_name as string) || (meta.login as string) || 'user', name: (meta.full_name as string) || (meta.name as string) || null, avatarUrl: (meta.avatar_url as string) || '' });
    const data = payload.data;
    setProviders(data.providers || []);
    setModels(data.models || []);
    setScoring({ classifiedByAi: data.classifiedByAi, classificationModel: data.classificationModel });
    if (data.preference) {
      const pref = data.preference;
      setPreference(pref);
      // The API already reconciled stage_overrides against the current
      // connected catalog (stale entries dropped server-side), so the UI
      // never renders phantom models from a previous catalog state.
      loadStageModels(pref.stage_overrides || {});
      setSetupChoice(toSetupChoice(pref.selected_strategy));
      if (data.stageOverridesReconciled && (data.droppedStageOverrides?.length ?? 0) > 0) {
        toast.info(
          `${data.droppedStageOverrides!.length} stage model${data.droppedStageOverrides!.length === 1 ? '' : 's'} no longer available — re-select or re-apply a setup.`,
          { description: `Stages affected: ${data.droppedStageOverrides!.join(', ')}` }
        );
      }
    } else {
      setStageModels({});
      setSetupChoice(null);
    }
  }, []);

  const loadStageModels = useCallback((overrides: Record<string, StageOverrideEntry>) => {
    const loaded: Record<string, StageModel> = {};
    STAGES.forEach((stage) => {
      const override = overrides[stage.id];
      loaded[stage.id] = { stageId: stage.id, label: stage.label, selectedProvider: override?.provider || null, selectedModel: override?.model || null, isOverride: !!override, unavailable: override?.unavailable === true, origin: override?.origin };
    });
    setStageModels(loaded);
  }, []);

  /** One catalog read + apply. Returns whether the served catalog still
   *  predates the current connected-provider set (server-driven
   *  `catalogPending`), so the caller can revalidate WITHOUT blocking. */
  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      const payload = await loadData();
      applyData(payload);
      return payload.data.catalogPending === true;
    } catch (e) {
      setError((e as Error).message || 'Failed to load model catalog');
      return false;
    } finally {
      setLoading(false);
    }
  }, [loadData, applyData]);

  /** Follow-up reads until the background rebuild lands (bounded — see
   *  catalogRevalidation.ts). Never blocks: the first snapshot is already on
   *  screen and `loading` was cleared by the read that preceded this loop. */
  const revalidate = useCallback(async () => {
    if (revalidatingRef.current) return;
    revalidatingRef.current = true;
    try {
      await revalidateUntilSettled({
        fetchPending: () => refresh(),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        onExhausted: () =>
          toast.info('Model catalog still refreshing', {
            description: 'Some provider data may be out of date. It will update on the next refresh.',
          }),
      });
    } finally {
      revalidatingRef.current = false;
    }
  }, [refresh]);

  /** Read once, then revalidate in the background if the catalog is behind.
   *  Used everywhere the page reloads provider/catalog state; callers that must
   *  not block (connect/disconnect) invoke it detached. */
  const refreshAndSettle = useCallback(async (): Promise<void> => {
    if (await refresh()) await revalidate();
  }, [refresh, revalidate]);

  useEffect(() => { void refreshAndSettle(); }, [refreshAndSettle]);

  /** Syncs the setup selector + stage rows from a saved preference payload. */
  const applySavedPreference = useCallback((pref: Preference) => {
    setPreference(pref);
    loadStageModels(pref.stage_overrides || {});
    setSetupChoice(toSetupChoice(pref.selected_strategy));
  }, [loadStageModels]);

  /** Applies a setup: picks a suitable model for every stage from the user's
   * connected-provider catalog, updates the existing Model Configuration, and
   * persists via the existing preference API (selected_strategy + stage_overrides). */
  const handleSetupSelect = useCallback(async (setup: SetupChoice) => {
    if (libraryBaseModels.length === 0) {
      toast.error('Connect a provider with available models first.');
      return;
    }
    setApplyingSetup(setup);
    try {
      const picks = selectStageModels(setup, libraryBaseModels);
      const nextStageModels: Record<string, StageModel> = {};
      STAGES.forEach((stage) => {
        const pick = picks[stage.id as StageKey];
        nextStageModels[stage.id] = {
          stageId: stage.id,
          label: stage.label,
          selectedProvider: pick?.provider || null,
          selectedModel: pick?.model || null,
          isOverride: true,
          unavailable: pick?.unavailable === true,
          origin: 'setup',
        };
      });
      setStageModels(nextStageModels);
      setSetupChoice(setup);

      const stageOverrides = buildStageOverrides(STAGES.map((s) => s.id), nextStageModels);
      const res = await fetch('/api/models/preference', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPreferenceSaveBody({
          selectionMode: preference?.selection_mode,
          provider: preference?.provider,
          model: preference?.model,
          selectedStrategy: setup,
          stageOverrides,
        })),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save setup');
      applySavedPreference(data.preference as Preference);
      const unavailableLabels = STAGES.filter((s) => nextStageModels[s.id].unavailable).map((s) => s.label);
      if (unavailableLabels.length > 0) {
        toast.warning(
          `Setup applied — no free model available for ${unavailableLabels.length} of ${STAGES.length} stages.`,
          { description: `Stages affected: ${unavailableLabels.join(', ')}` }
        );
      } else {
        toast.success(
          'Setup applied to all five stages.',
          selectionState.saveNote ? { description: selectionState.saveNote } : undefined
        );
      }
    } catch (e) {
      toast.error((e as Error).message || 'Failed to apply setup');
    } finally {
      setApplyingSetup(null);
    }
  }, [libraryBaseModels, applySavedPreference, preference, selectionState]);

  const handleSavePreference = async () => {
    setSaving(true);
    try {
      const stageOverrides = buildStageOverrides(STAGES.map((s) => s.id), stageModels);
      const res = await fetch('/api/models/preference', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPreferenceSaveBody({
          selectionMode: preference?.selection_mode,
          provider: preference?.provider,
          model: preference?.model,
          selectedStrategy: setupChoice ?? (Object.keys(stageOverrides).length > 0 ? 'custom' : 'auto'),
          stageOverrides,
        })),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save preference');
      setPreference(data.preference);
      toast.success(
        'Preference saved successfully',
        selectionState.saveNote ? { description: selectionState.saveNote } : undefined
      );
    } catch (e) {
      toast.error((e as Error).message || 'Failed to save preference');
    } finally {
      setSaving(false);
    }
  };

  /** Shared by connect and disconnect: the mutation response is authoritative
   *  for connection state, the catalog revalidation is detached. Identical
   *  treatment for every provider — including the local endpoint. */
  const runProviderMutation = useCallback((
    action: 'connect' | 'disconnect',
    providerId: string,
    apiKey: string,
    options?: { baseUrl?: string }
  ): Promise<void> => {
    const deps = {
      post: async (body: { provider: string; apiKey: string; baseUrl?: string }) => {
        const res = await fetch(
          action === 'connect'
            ? '/api/models/connect'
            : `/api/models/connections/${providerId}`,
          action === 'connect'
            ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
            : { method: 'DELETE' }
        );
        const ack = await res.json().catch(() => ({}));
        return { ok: res.ok, status: res.status, ack };
      },
      onConnected: (pid: string, ack: Parameters<typeof markProviderConnected>[2]) =>
        setProviders((prev) => markProviderConnected(prev, pid, ack, options?.baseUrl)),
      // ack.status 'disabled' ⇒ env-backed tombstone disconnect: the card must
      // show Disabled/Reconnect immediately, not plain Disconnected.
      onDisconnected: (pid: string, ack?: { status?: string }) =>
        setProviders((prev) =>
          ack?.status === 'disabled' ? markProviderDisabled(prev, pid) : markProviderDisconnected(prev, pid)
        ),
      refresh: () => refreshAndSettle(),
      onSuccess: (pid: string) =>
        toast.success(
          action === 'disconnect'
            ? `${pid} disconnected.`
            : pid === 'local' ? 'Local endpoint connected.' : `${pid} connected.`
        ),
      onError: (message: string) =>
        toast.error(message || (action === 'disconnect' ? 'Disconnect failed' : 'Connection failed')),
    };
    return action === 'connect'
      ? runConnect(providerId, apiKey, options, deps)
      : runDisconnect(providerId, deps);
  }, [refreshAndSettle]);

  const handleConnect = useCallback(
    (providerId: string, apiKey: string, options?: { baseUrl?: string }) =>
      runProviderMutation('connect', providerId, apiKey, options),
    [runProviderMutation]
  );

  const handleDisconnect = useCallback(
    (providerId: string) => runProviderMutation('disconnect', providerId, ''),
    [runProviderMutation]
  );

  const getStageCostEstimate = (model: CatalogModel | null, stageId: string): string => {
    if (!model) return 'Unknown';
    const label = formatCostUsd(stageCostEstimateUsd(model, stageId));
    // The estimate marker applies only to calculated costs, so free models
    // read "Free" and unknown pricing reads "Pricing unavailable" — never
    // "~$0" or "~Free".
    return label.startsWith('$') ? `~${label}` : label;
  };

  /** Models of a provider that is still connected. A provider disconnected a
   *  moment ago keeps its rows in the catalog snapshot until the background
   *  rebuild lands; gating here makes its models disappear from every stage row
   *  immediately instead of showing a model that can no longer run. */
  const getSelectedProviderModels = (providerId: string): CatalogModel[] => {
    if (!connectedProviderIds.has(providerId)) return [];
    return models.filter((m) => m.providerId === providerId && m.available);
  };

  const getBestModelForStage = (stageModel: StageModel): CatalogModel | null => {
    if (!stageModel.selectedProvider) return null;
    const providerModels = getSelectedProviderModels(stageModel.selectedProvider);
    return providerModels.length > 0 ? providerModels[0] : null;
  };

  /** Resolves the CatalogModel actually configured for a stage (selected model,
   * not just the provider's first entry). Returns null when unconfigured. */
  const getConfiguredStageModel = (sm: StageModel | undefined): CatalogModel | null => {
    if (!sm || !sm.selectedProvider || !sm.selectedModel) return null;
    if (!connectedProviderIds.has(sm.selectedProvider)) return null;
    return models.find((m) => m.providerId === sm.selectedProvider && m.modelId === sm.selectedModel && m.available) || null;
  };

  /** Total estimated cost per analysis: sums the exact per-stage estimates (each
   * with its own stage token profile) so the total stays consistent with the
   * individual stage rows. */
  const estimateTotalCost = (): CostEstimate => {
    let total = 0;
    let hasUnknown = false;
    STAGES.forEach((stage) => {
      const model = getConfiguredStageModel(displayStageModels[stage.id]);
      if (!model) {
        hasUnknown = true;
        return;
      }
      const estimate = stageCostEstimateUsd(model, stage.id);
      if (estimate.status === 'unknown') {
        hasUnknown = true;
        return;
      }
      total += estimate.usd;
    });
    return hasUnknown ? { status: 'unknown', usd: null } : { status: 'priced', usd: total };
  };

  const handleApplyStageChange = (stageId: string, provider: string, model: string, reason: string, isOverride: boolean) => {
    const stage = STAGES.find((s) => s.id === stageId);
    if (stage) {
      // Baseline = the row AS SHOWN (an override row, else the derived
      // automatic pick) so "changed" means what the user actually changed.
      const displayed = displayStageModels[stageId];
      const selectionChanged = (provider || null) !== (displayed?.selectedProvider || null) || (model || null) !== (displayed?.selectedModel || null);
      // A concrete change always persists as a manual override; the checkbox
      // alone no longer gates persistence (see resolveAppliedOverride).
      const applied = resolveAppliedOverride({
        checkbox: isOverride,
        selectionChanged,
        previousOrigin: stageModels[stageId]?.origin,
      });
      const newStageModels = { ...stageModels };
      // Manual configuration always resolves an unavailable stage — the user
      // picked a concrete model, so the strict-Free marker is cleared.
      newStageModels[stageId] = { stageId: stage.id, label: stage.label, selectedProvider: provider || null, selectedModel: model || null, isOverride: applied.isOverride, unavailable: false, origin: applied.origin };
      setStageModels(newStageModels);
      setSelectedStageProvider(provider || '');
      setSelectedStageModel(model || '');
      setSelectedStageReason(reason);
      setSelectedStageIsOverride(applied.isOverride);
    }
    setShowStageModal(null);
  };

  return (
    <AppShell user={user} gradient="dashboard">
       <div className="p-4 lg:p-8 max-w-4xl mx-auto w-full">
         <div className="mb-6 lg:mb-8">
           <h1 className="text-2xl lg:text-3xl font-bold text-bw-peach-light mb-2">AI Models</h1>
           <p className="text-bw-peach text-sm lg:text-base">Connect providers, choose a model setup, and configure which model handles each bug-fixing stage.</p>
           {scoringStatus.label && (
             <div className="mt-3">
               <Badge variant="outline" className="text-xs text-bw-peach" title={scoringStatus.detail || undefined}>
                 {scoringStatus.label}
               </Badge>
             </div>
           )}
         </div>

        {error && (
          <div className="mb-6 p-4 rounded-lg border border-error-container bg-error-container/20 text-sm text-error-default">{error}</div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-16 text-bw-peach">
            <span className="w-5 h-5 border-2 border-primary-container/30 border-t-primary-container rounded-full animate-spin" />
            <span className="ml-3 text-sm">Loading AI models...</span>
          </div>
        )}

        {!loading && !error && (
          <div className="space-y-8">
            <ConnectedProvidersSection
              providers={providers}
              models={models}
              onConnect={handleConnect}
              onDisconnect={handleDisconnect}
            />

            {selectionState.banner && (
              <div role="status" className="p-4 rounded-lg border border-amber-500/40 bg-amber-500/10 text-sm text-bw-peach">
                {selectionState.banner}
              </div>
            )}

            <StageConfigPanel
              selected={setupChoice}
              pending={applyingSetup}
              disabled={libraryBaseModels.length === 0}
              onSelect={handleSetupSelect}
            />

             <section>
               <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-2">
                 <h2 className="text-xl lg:text-2xl font-semibold text-bw-peach-light">Model Configuration</h2>
                 <Badge variant="outline" className="text-xs text-bw-peach w-fit">Compact View</Badge>
               </div>

               <div className="overflow-x-auto -mx-1 sm:-mx-2 lg:-mx-4">
                 <div className="bg-surface border border-border rounded-xl min-w-max sm:min-w-0">
<div className="grid grid-cols-12 gap-2 p-3 text-[10px] lg:text-xs font-semibold text-bw-peach-light border-b border-border">
                      <div className="col-span-3">Stage</div>
                      <div className="col-span-3">Current Model</div>
                      <div className="col-span-2">Provider</div>
                      <div className="col-span-2 text-center">Status</div>
                      <div className="col-span-2 text-center">Action</div>
                    </div>
                   <div className="divide-y divide-border">
                     {STAGES.map((stage) => {
                       const sm = displayStageModels[stage.id];
                       const selectedProvider = sm?.selectedProvider || '';
                       const providerModels = getSelectedProviderModels(selectedProvider);
                       const configuredModel = getConfiguredStageModel(sm);
                       const bestModel = configuredModel || getBestModelForStage(sm);
                       const stageCost = getStageCostEstimate(configuredModel, stage.id);
                       const capability = configuredModel ? getStageCapability(configuredModel) : 'unknown';
                       const modelSubline = sm?.unavailable
                         ? 'Connect a provider offering a free model for this stage, or configure it manually.'
                         : configuredModel
                           ? `${stageCost} / analysis · ${capability}`
                           : 'Not configured';

                       const getModelDisplay = () => {
                         if (sm.unavailable) return 'No free model available';
                         if (configuredModel) return configuredModel.displayName;
                         if (sm.selectedModel && sm.selectedProvider) {
                           const matchingModel = providerModels.find((m) => m.modelId === sm.selectedModel);
                           return matchingModel ? matchingModel.displayName : 'Not configured';
                         }
                         return bestModel ? bestModel.displayName : 'Not configured';
                       };

                       const getProviderDisplay = () => {
                         if (sm.unavailable) return '—';
                         if (sm.selectedProvider) {
                           const provider = providers.find((p) => p.providerId === sm.selectedProvider);
                           return provider ? provider.displayName : sm.selectedProvider;
                         }
                         return 'Not configured';
                       };

                        const getStatusDisplay = () => {
                          const tone = deriveStageStatus({
                            configured: !!(sm && (sm.selectedProvider || sm.selectedModel)),
                            unavailable: sm?.unavailable === true,
                            origin: sm?.origin ?? null,
                            modeActive: selectionState.active,
                          });
                          if (tone === 'unavailable') return {
                            text: 'No free model',
                            className: 'text-[10px] lg:text-xs text-amber-500 bg-amber-500/10 border-amber-500 whitespace-nowrap',
                          };
                          if (tone === 'unconfigured') return {
                            text: 'No config',
                            className: 'text-[10px] lg:text-xs text-bw-peach bg-surface whitespace-nowrap',
                          };
                          if (tone === 'inactive') return {
                            text: selectionState.inactiveStatusText,
                            className: 'text-[10px] lg:text-xs text-amber-500 bg-amber-500/10 border-amber-500 whitespace-nowrap',
                          };
                          if (tone === 'custom') return {
                            text: 'Custom',
                            className: 'text-[10px] lg:text-xs text-blue-500 bg-blue-500/10 border-blue-500 whitespace-nowrap',
                          };
                          return {
                            text: 'Active',
                            className: 'text-[10px] lg:text-xs text-green-500 bg-green-500/10 border-green-500 whitespace-nowrap',
                          };
                        };

                       const status = getStatusDisplay();

                       return (
                         <div key={stage.id} className="p-3 lg:p-4 hover:bg-surface-dim transition-colors">
<div className="grid grid-cols-12 gap-2 lg:gap-4 items-center">
                              <div className="col-span-3 flex items-center gap-2 min-w-0">
                                <stage.icon className="h-3.5 w-3.5 lg:h-4 lg:w-4 text-bw-peach/80 shrink-0" aria-hidden="true" />
                                <span className="text-sm font-medium text-bw-peach-light truncate">{stage.label}</span>
                                {sm.origin === 'manual' && !sm.unavailable && (
                                  <Badge variant="outline" className="text-[10px] text-blue-500 border-blue-500 whitespace-nowrap shrink-0">
                                    Custom Override
                                  </Badge>
                                )}
                              </div>
                              <div className="col-span-3 min-w-0">
                                <div className="text-sm text-bw-peach-light truncate text-xs lg:text-sm">
                                  {getModelDisplay()}
                                </div>
                                <div className="text-[10px] lg:text-xs text-bw-peach/60 mt-0.5 truncate">
                                  {modelSubline}
                                </div>
                              </div>
                              <div className="col-span-2 text-[10px] lg:text-xs text-bw-peach truncate">
                                {getProviderDisplay()}
                              </div>
                              <div className="col-span-2 flex justify-center min-w-0">
                                <Badge className={status.className}>{status.text}</Badge>
                              </div>
                              <div className="col-span-2">
                               <Button
                                 variant="outline"
                                 size="sm"
                                 className="w-full h-7 lg:h-8 text-[10px] lg:text-xs border-border bg-surface hover:bg-surface-dim cursor-pointer"
                                 onClick={() => {
                                   setShowStageModal(stage.id);
                                   setSelectedStageProvider(selectedProvider);
                                   setSelectedStageModel(sm.selectedModel || '');
                                   setSelectedStageReason(capability || 'unknown');
                                   setSelectedStageIsOverride(sm.isOverride);
                                 }}
                               >
                                 <Settings2Icon className="h-3 w-3 lg:h-3.5 lg:w-3.5 mr-1" />
                                 Configure
                               </Button>
                             </div>
                           </div>
                         </div>
                       );
                     })}
                   </div>
                 </div>
               </div>

<div className="mt-3 lg:mt-4 p-3 bg-primary-container/5 border border-primary-container/20 rounded-lg">
                  <p className="text-xs text-bw-peach">
                    <span className="font-semibold text-bw-peach-light">Tip:</span> Click "Configure" to customize any stage. Changes are saved when you click "Save Preference" below.
                  </p>
                </div>
             </section>

            <section>
              <Card className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-bw-peach-light">Estimated Cost per Analysis</h3>
                    <p className="text-sm text-bw-peach mt-1">Based on selected models for each stage</p>
                  </div>
                  <div className="text-2xl font-bold text-bw-peach-light">{formatCostUsd(estimateTotalCost())}</div>
                </div>
              </Card>
            </section>

            <section>
              <Button onClick={handleSavePreference} disabled={saving} className="w-full max-w-md">
                {saving ? <><RefreshCwIcon className="mr-2 h-4 w-4 animate-spin" /> Saving...</> : <><ShieldCheckIcon className="mr-2 h-4 w-4" /> Save Preference</>}
              </Button>
            </section>

            {showStageModal && (
              <StageChangeModal
                stageId={showStageModal}
                stage={STAGES.find((s) => s.id === showStageModal) as typeof STAGES[0]}
                providers={providers}
                models={models}
                selectedProvider={selectedStageProvider}
                selectedModel={selectedStageModel}
                selectedReason={selectedStageReason}
                isOverride={selectedStageIsOverride}
                onApply={(provider, model, reason, isOverride) => handleApplyStageChange(showStageModal!, provider, model, reason, isOverride)}
                onCancel={() => setShowStageModal(null)}
              />
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function Card({ children, className, onClick }: { children: React.ReactNode; className?: string; onClick?: () => void }) {
   return <div className={`p-4 sm:p-5 rounded-xl border border-border bg-surface ${className}`} onClick={onClick}>{children}</div>;
 }


/** Maps the persisted strategy to the UI setup; legacy strategies → null. */
function toSetupChoice(strategy: string | null | undefined): SetupChoice | null {
  return strategy === 'free' || strategy === 'balanced' || strategy === 'quality' ? strategy : null;
}

function getStageCapability(model: CatalogModel): string {
  if (!model) return 'Unknown';
  const reasons: string[] = [];
  if (model.supportsReasoning) reasons.push('reasoning');
  if (model.supportsToolCalling) reasons.push('tools');
  if (model.contextWindow >= 100000) reasons.push('large context');
  if (model.scores.coding >= 3) reasons.push('strong coding');
  if (model.scores.speed >= 3) reasons.push('fast');
  return reasons.length > 0 ? reasons.join(', ') : 'general';
}

/** Estimated USD cost for one stage request, via the shared cost helper. */
function stageCostEstimateUsd(model: CatalogModel, stageId: string): CostEstimate {
  return estimateCostUsd(
    {
      inputPricePerMillion: model.price.input,
      outputPricePerMillion: model.price.output,
      isFree: model.price.isFree,
    },
    getStageTokenProfile(stageId)
  );
}

/** Token profile for a stage id; falls back to the discovery profile rather
 * than failing when an unexpected id slips in. */
function getStageTokenProfile(stageId: string): StageTokenProfile {
  return STAGE_TOKEN_PROFILES[stageId as StageKey] ?? STAGE_TOKEN_PROFILES.relevant_file_discovery;
}

function ConnectedProvidersSection({ providers, models, onConnect, onDisconnect }: { providers: CatalogProvider[]; models: CatalogModel[]; onConnect: (providerId: string, apiKey: string, options?: { baseUrl?: string }) => Promise<void>; onDisconnect: (providerId: string) => Promise<void>; }) {
  const [showConnectPanel, setShowConnectPanel] = useState(false);
  const connected = providers.filter((p) => p.status === 'connected');
  const available = providers.filter((p) => p.status !== 'connected');

  return (
<section>
       <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-2">
         <div className="flex items-center gap-2">
           <h2 className="text-xl lg:text-2xl font-semibold text-bw-peach-light">Connected Providers</h2>
           <Badge variant="outline" className="text-xs text-bw-peach">{connected.length} connected</Badge>
         </div>
         <Button variant="outline" size="sm" onClick={() => setShowConnectPanel((v) => !v)} disabled={available.length === 0} className="w-fit self-start sm:self-auto">
           <PlusIcon className="h-3 w-3 mr-1" />
           Connect Provider
         </Button>
       </div>

      {connected.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-sm font-medium text-bw-peach-light">No providers connected</p>
          <p className="text-xs text-bw-peach mt-1">Connect an AI provider to see its models and configure BugWiser stages.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {connected.map((provider) => (
            <ProviderCard
              key={provider.providerId}
              provider={provider}
              modelCount={models.filter((m) => m.providerId === provider.providerId && m.available).length}
              onConnect={onConnect}
              onDisconnect={onDisconnect}
            />
          ))}
        </div>
      )}

      {showConnectPanel && available.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-semibold text-bw-peach-light mb-3">Add a provider</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {available.map((provider) => (
              <ProviderCard key={provider.providerId} provider={provider} onConnect={onConnect} onDisconnect={onDisconnect} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function StageChangeModal({ stageId, stage, providers, models, selectedProvider, selectedModel, selectedReason, isOverride, onApply, onCancel }: { stageId: string; stage: typeof STAGES[0]; providers: CatalogProvider[]; models: CatalogModel[]; selectedProvider: string; selectedModel: string; selectedReason: string; isOverride: boolean; onApply: (provider: string, model: string, reason: string, isOverride: boolean) => void; onCancel: () => void; }) {
  const [localProvider, setLocalProvider] = useState(selectedProvider);
  const [localModel, setLocalModel] = useState(selectedModel);
  const [localReason, setLocalReason] = useState(selectedReason);
  const [localIsOverride, setLocalIsOverride] = useState(isOverride);
  const [modelSearch, setModelSearch] = useState('');

  const connectedProviderModels = useMemo(
    () => buildStageCandidatePool(providers, models),
    [providers, models]
  );

  const filteredModels = useMemo(
    () => filterStageModels(connectedProviderModels, modelSearch),
    [connectedProviderModels, modelSearch]
  );

  const { recommended: recommendedModels, free: freeModels, other: paidModels } = useMemo(
    () => bucketStageModels(filteredModels),
    [filteredModels]
  );

  const maxValueScore = useMemo(
    () => connectedProviderModels.reduce((max, m) => Math.max(max, m.valueScore), Number.NEGATIVE_INFINITY),
    [connectedProviderModels]
  );

  const handleApply = () => {
    const reason = localReason || 'Recommended model';
    onApply(localProvider, localModel, reason, localIsOverride);
  };

  const hasModels = connectedProviderModels.length > 0;
  const searchEmpty = modelSearch.trim() && filteredModels.length === 0;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-2 sm:p-4">
        <div className="bg-surface border border-border rounded-xl p-4 sm:p-6 w-full max-w-[90vw] lg:max-w-lg max-h-[85vh] flex flex-col shadow-lg overflow-hidden">
         <div className="flex items-center justify-between mb-4">
           <h3 className="text-xl font-semibold text-bw-peach-light">Change Model for {stage.label}</h3>
           <button
             type="button"
             onClick={onCancel}
             aria-label="Close"
             className="rounded p-1 text-bw-peach outline-none transition-colors hover:bg-surface-dim hover:text-bw-peach-light cursor-pointer focus-visible:ring-2 focus-visible:ring-ring/50"
           >
             <XIcon className="h-4 w-4" />
           </button>
         </div>

         <div className="flex-1 overflow-y-auto pr-2 -mr-2">
           <div className="mb-4">
             <div className="relative">
               <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-bw-peach/50" aria-hidden="true" />
               <input
                 type="text"
                 placeholder="Search models…"
                 value={modelSearch}
                 onChange={(e) => setModelSearch(e.target.value)}
                 aria-label="Search models"
                 className="h-8 w-full cursor-text rounded-lg border border-border bg-surface pl-8 pr-8 text-sm text-bw-peach-light outline-none transition-colors placeholder:text-bw-peach/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
               />
              {modelSearch && (
                <button
                  type="button"
                  onClick={() => setModelSearch('')}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-bw-peach/60 outline-none transition-colors hover:text-bw-peach-light cursor-pointer focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <XIcon className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {!modelSearch && (
            <>
              <div className="mb-4">
                <h4 className="text-sm font-semibold text-bw-peach-light mb-3">Recommended</h4>
                <div className="space-y-2">
                  {recommendedModels.map((model) => {
                    const isBest = model.valueScore === maxValueScore;
                    return (
                       <button key={`${model.providerId}/${model.modelId}`} onClick={() => {
                         setLocalProvider(model.providerId);
                         setLocalModel(model.modelId);
                         setLocalReason('Best value model');
                       }} className={`w-full text-left p-3 rounded-lg border transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${localModel === model.modelId ? 'border-green-500 bg-green-500/10' : 'border-border bg-surface hover:bg-surface-dim'} ${!model.available ? 'opacity-55 cursor-not-allowed' : ''}`}>
                        <div className="flex items-center justify-between">
                          <span className="text-bw-peach-light font-medium">{model.displayName}</span>
                          {isBest && <span className="text-xs bg-green-500 text-white px-2 py-0.5 rounded-full">Best Value</span>}
                        </div>
                        <div className="text-xs text-bw-peach mt-1">{model.providerId} • {formatCostUsd(stageCostEstimateUsd(model, stage.id))} • {getStageCapability(model)}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <Separator />

              <div>
                <h4 className="text-sm font-semibold text-green-500 mb-3">Free Alternatives</h4>
                <div className="space-y-2">
                  {freeModels.map((model) => {
                    return (
                       <button key={`${model.providerId}/${model.modelId}`} onClick={() => {
                         setLocalProvider(model.providerId);
                         setLocalModel(model.modelId);
                         setLocalReason('Free model');
                       }} disabled={!model.available} className={`w-full text-left p-3 rounded-lg border transition-colors ${localModel === model.modelId ? 'border-green-500 bg-green-500/10' : 'border-border bg-surface hover:bg-surface-dim'} ${!model.available ? 'opacity-55 cursor-not-allowed' : ''}`}>
                        <div className="flex items-center justify-between">
                          <span className="text-bw-peach-light">{model.displayName}</span>
                          {localModel === model.modelId && <span className="text-xs bg-green-500 text-white px-2 py-0.5 rounded-full">Selected</span>}
                        </div>
                        <div className="text-xs text-bw-peach mt-1">{model.providerId} • {formatCostUsd(stageCostEstimateUsd(model, stage.id))} • {getStageCapability(model)}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <Separator />

              <div>
                <h4 className="text-sm font-semibold text-purple-500 mb-3">Paid Alternatives</h4>
                <div className="space-y-2">
                  {paidModels.map((model) => {
                    return (
                       <button key={`${model.providerId}/${model.modelId}`} onClick={() => {
                         setLocalProvider(model.providerId);
                         setLocalModel(model.modelId);
                         setLocalReason('Paid model');
                       }} className={`w-full text-left p-3 rounded-lg border transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${localModel === model.modelId ? 'border-purple-500 bg-purple-500/10' : 'border-border bg-surface hover:bg-surface-dim'}`}>
                        <div className="flex items-center justify-between">
                          <span className="text-bw-peach-light">{model.displayName}</span>
                          {localModel === model.modelId && <span className="text-xs bg-purple-500 text-white px-2 py-0.5 rounded-full">Selected</span>}
                        </div>
                        <div className="text-xs text-bw-peach mt-1">{model.providerId} • {formatCostUsd(stageCostEstimateUsd(model, stage.id))} • {getStageCapability(model)}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {modelSearch && (
            <>
              {searchEmpty && (
                <div className="text-center py-8">
                  <p className="text-bw-peach text-sm">No models found</p>
                  <p className="text-bw-peach/60 text-xs mt-1">
                    Try searching by model name, ID, or provider (e.g. a provider id).
                  </p>
                </div>
              )}
              {!searchEmpty && (
                <>
                  <div className="mb-4">
                    <h4 className="text-sm font-semibold text-bw-peach-light mb-3">Recommended</h4>
                    <div className="space-y-2">
                      {recommendedModels.map((model) => {
                        const isBest = model.valueScore === maxValueScore;
                        return (
                           <button key={`${model.providerId}/${model.modelId}`} onClick={() => {
                             setLocalProvider(model.providerId);
                             setLocalModel(model.modelId);
                             setLocalReason('Best value model');
                           }} className={`w-full text-left p-3 rounded-lg border transition-colors ${localModel === model.modelId ? 'border-green-500 bg-green-500/10' : 'border-border bg-surface hover:bg-surface-dim'} ${!model.available ? 'opacity-55 cursor-not-allowed' : ''}`}>
                             <div className="flex items-center justify-between">
                               <span className="text-bw-peach-light font-medium">{model.displayName}</span>
                               {isBest && <span className="text-xs bg-green-500 text-white px-2 py-0.5 rounded-full">Best Value</span>}
                             </div>
                             <div className="text-xs text-bw-peach mt-1">{model.providerId} • {formatCostUsd(stageCostEstimateUsd(model, stage.id))} • {getStageCapability(model)}</div>
                           </button>
                         );
                       })}
                     </div>
                   </div>

                   <Separator />

                   <div>
                     <h4 className="text-sm font-semibold text-green-500 mb-3">Free Alternatives</h4>
                     <div className="space-y-2">
                       {freeModels.map((model) => {
                         return (
                           <button key={`${model.providerId}/${model.modelId}`} onClick={() => {
                             setLocalProvider(model.providerId);
                             setLocalModel(model.modelId);
                             setLocalReason('Free model');
                           }} disabled={!model.available} className={`w-full text-left p-3 rounded-lg border transition-colors ${localModel === model.modelId ? 'border-green-500 bg-green-500/10' : 'border-border bg-surface hover:bg-surface-dim'} ${!model.available ? 'opacity-55 cursor-not-allowed' : ''}`}>
                             <div className="flex items-center justify-between">
                               <span className="text-bw-peach-light">{model.displayName}</span>
                               {localModel === model.modelId && <span className="text-xs bg-green-500 text-white px-2 py-0.5 rounded-full">Selected</span>}
                             </div>
                             <div className="text-xs text-bw-peach mt-1">{model.providerId} • {formatCostUsd(stageCostEstimateUsd(model, stage.id))} • {getStageCapability(model)}</div>
                           </button>
                         );
                       })}
                     </div>
                   </div>

                   <Separator />

                   <div>
                     <h4 className="text-sm font-semibold text-purple-500 mb-3">Paid Alternatives</h4>
                     <div className="space-y-2">
                       {paidModels.map((model) => {
                         return (
                           <button key={`${model.providerId}/${model.modelId}`} onClick={() => {
                             setLocalProvider(model.providerId);
                             setLocalModel(model.modelId);
                             setLocalReason('Paid model');
                           }} className={`w-full text-left p-3 rounded-lg border transition-colors ${localModel === model.modelId ? 'border-purple-500 bg-purple-500/10' : 'border-border bg-surface hover:bg-surface-dim'}`}>
                             <div className="flex items-center justify-between">
                               <span className="text-bw-peach-light">{model.displayName}</span>
                               {localModel === model.modelId && <span className="text-xs bg-purple-500 text-white px-2 py-0.5 rounded-full">Selected</span>}
                             </div>
                             <div className="text-xs text-bw-peach mt-1">{model.providerId} • {formatCostUsd(stageCostEstimateUsd(model, stage.id))} • {getStageCapability(model)}</div>
                           </button>
                         );
                       })}
                     </div>
                   </div>
                 </>
               )}
             </>
           )}
         </div>

         <div className="pt-4 border-t border-outline-variant mt-auto">
          <div className="text-sm text-bw-peach">
            <div className="flex items-center gap-2 mb-2">
              <input type="checkbox" id={`override-${stageId}`} checked={localIsOverride} onChange={(e) => setLocalIsOverride(e.target.checked)} />
              <label htmlFor={`override-${stageId}`}>Custom Override</label>
            </div>
            <p className="text-xs text-bw-peach/80">Enable to create a custom override for this stage.</p>
          </div>
          <div className="flex items-center justify-between mt-4">
            <Button variant="outline" onClick={onCancel} className="cursor-pointer">Cancel</Button>
            <Button onClick={handleApply} disabled={!localModel || !localProvider} className="cursor-pointer">Apply Change</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
