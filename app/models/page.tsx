'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { PlusIcon, RefreshCwIcon, ShieldCheckIcon, Settings2Icon } from 'lucide-react';
import type { GitHubUser } from '@/types';
import { ProviderCard } from '@/components/models/ProviderCard';

const STAGES = [
  { id: 'relevant_file_discovery', label: '🔍 File Discovery', task: 'relevant_file_discovery', provider: 'simple_coding' },
  { id: 'root_cause_analysis', label: '🧠 Root Cause Analysis', task: 'root_cause_analysis', provider: 'complex_debugging' },
  { id: 'evidence_extraction', label: '📋 Evidence Extraction', task: 'evidence_extraction', provider: 'evidence_extraction' },
  { id: 'solution_generation', label: '💡 Solution Generation', task: 'solution_generation', provider: 'code_generation' },
  { id: 'patch_generation', label: '🔧 Patch Generation', task: 'patch_generation', provider: 'code_generation' },
];

type StageModel = { stageId: string; label: string; selectedProvider: string | null; selectedModel: string | null; isOverride: boolean; };

type LibraryFilter = 'all' | 'free' | 'paid' | 'coding' | 'reasoning' | 'long_context' | 'fast';

const LIBRARY_FILTERS: { id: LibraryFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'free', label: 'Free' },
  { id: 'paid', label: 'Paid' },
  { id: 'coding', label: 'Coding' },
  { id: 'reasoning', label: 'Reasoning' },
  { id: 'long_context', label: 'Long Context' },
  { id: 'fast', label: 'Fast' },
];

const CAPABILITY_LABELS: Record<string, string> = {
  coding: 'Coding',
  reasoning: 'Reasoning',
  vision: 'Vision',
  tool_calling: 'Tool Calling',
  structured_output: 'Structured Output',
};

type SetupChoice = 'free' | 'balanced' | 'quality';

const MODEL_SETUPS: { id: SetupChoice; title: string; description: string }[] = [
  { id: 'free', title: 'Free', description: 'Use free models across the pipeline to minimize cost.' },
  { id: 'balanced', title: 'Balanced', description: 'Balance cost and model quality across the pipeline.' },
  { id: 'quality', title: 'Quality', description: 'Prioritize higher-quality models when available.' },
];

export interface CatalogProvider { providerId: string; displayName: string; authType: 'api_key' | 'oauth' | 'none'; status: 'disconnected' | 'connected' | 'error'; connectedAt: string | null; serverConfigured: boolean; description: string; docsUrl: string; }

export interface CatalogModel { providerId: string; modelId: string; displayName: string; contextWindow: number; maxOutputTokens: number | null; price: { input: number | null; output: number | null; isFree: boolean }; supportsReasoning: boolean; supportsToolCalling: boolean; supportsStructuredOutput: boolean; capabilities: string[]; availability: string; scores: { coding: number; reasoning: number; speed: number; longContext: number }; valueScore: number; tags: string[]; fit: number; stageFit: Record<string, number>; available: boolean; }

export interface Preference { user_id: string; provider: string | null; model: string | null; selection_mode: 'auto' | 'manual'; stage_overrides?: Record<string, { provider: string | null; model: string | null }>; }

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
  const [selectedStageCost, setSelectedStageCost] = useState<string>('');
  const [selectedStagePriceInput, setSelectedStagePriceInput] = useState<number | null>(null);
  const [selectedStageIsOverride, setSelectedStageIsOverride] = useState<boolean>(false);
  const [stageModels, setStageModels] = useState<Record<string, StageModel>>({});
  const [setupChoice, setSetupChoice] = useState<SetupChoice | null>(null);
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [search, setSearch] = useState('');

  const connectedProviders = useMemo(() => providers.filter((p) => p.status === 'connected'), [providers]);
  const connectedProviderIds = useMemo(() => new Set(connectedProviders.map((p) => p.providerId)), [connectedProviders]);
  const libraryBaseModels = useMemo(
    () => models.filter((m) => m.available && connectedProviderIds.has(m.providerId)),
    [models, connectedProviderIds]
  );

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

  const applyData = useCallback((payload: { user: { user_metadata?: Record<string, unknown> } | null; data: { providers?: CatalogProvider[]; models?: CatalogModel[]; preference?: Preference; classifiedByAi?: boolean; classificationModel?: string | null; analyzedAt?: string; }; }) => {
    const au = payload.user;
    const meta = au?.user_metadata ?? {};
    setUser({ login: (meta.user_name as string) || (meta.login as string) || 'user', name: (meta.full_name as string) || (meta.name as string) || null, avatarUrl: (meta.avatar_url as string) || '' });
    const data = payload.data;
    setProviders(data.providers || []);
    setModels(data.models || []);
    if (data.preference) {
      const pref = data.preference;
      setPreference(pref);
      const overrides = pref.stage_overrides || {};
      loadStageModels(overrides);
    } else {
      setStageModels({});
    }
  }, []);

  const loadStageModels = useCallback((overrides: Record<string, { provider: string | null; model: string | null }>) => {
    const loaded: Record<string, StageModel> = {};
    STAGES.forEach((stage) => {
      const override = overrides[stage.id];
      loaded[stage.id] = { stageId: stage.id, label: stage.label, selectedProvider: override?.provider || null, selectedModel: override?.model || null, isOverride: !!override };
    });
    setStageModels(loaded);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const payload = await loadData();
      applyData(payload);
    } catch (e) {
      setError((e as Error).message || 'Failed to load model catalog');
    } finally {
      setLoading(false);
    }
  }, [loadData, applyData]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleSavePreference = async () => {
    setSaving(true);
    try {
      const stageOverrides: Record<string, { provider: string | null; model: string | null }> = {};
      STAGES.forEach((stage) => {
        const sm = stageModels[stage.id];
        if (sm.isOverride && sm.selectedProvider && sm.selectedModel) {
          stageOverrides[stage.id] = { provider: sm.selectedProvider, model: sm.selectedModel };
        }
      });
      const res = await fetch('/api/models/preference', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selection_mode: 'auto', stage_overrides: stageOverrides }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save preference');
      setPreference(data.preference);
      toast.success('Preference saved successfully');
    } catch (e) {
      toast.error((e as Error).message || 'Failed to save preference');
    } finally {
      setSaving(false);
    }
  };

  const handleConnect = async (providerId: string, apiKey: string) => {
    try {
      const res = await fetch('/api/models/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: providerId, apiKey }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to connect');
      toast.success(`${providerId} connected.`);
      await refresh();
    } catch (e) {
      toast.error((e as Error).message || 'Connection failed');
      throw e;
    }
  };

  const handleDisconnect = async (providerId: string) => {
    try {
      const res = await fetch(`/api/models/connections/${providerId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to disconnect');
      toast.success(`${providerId} disconnected.`);
      await refresh();
    } catch (e) {
      toast.error((e as Error).message || 'Disconnect failed');
    }
  };

  const libraryModels = useMemo(() => {
    let list = libraryBaseModels;
    if (filter === 'free') list = list.filter((m) => m.price.isFree);
    else if (filter === 'paid') list = list.filter((m) => !m.price.isFree);
    else if (filter === 'coding') list = list.filter((m) => m.capabilities.includes('coding'));
    else if (filter === 'reasoning') list = list.filter((m) => m.capabilities.includes('reasoning'));
    else if (filter === 'long_context') list = list.filter((m) => m.contextWindow >= 100000);
    else if (filter === 'fast') list = list.filter((m) => m.scores.speed >= 60);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((m) =>
        m.displayName.toLowerCase().includes(q) ||
        m.modelId.toLowerCase().includes(q) ||
        m.providerId.toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => b.valueScore - a.valueScore);
  }, [libraryBaseModels, filter, search]);

  const getStageCost = (stageModel: StageModel, model: CatalogModel): string => {
    if (!model) return 'Unknown';
    if (model.price.isFree) return 'Free';
    if (model.price.input === null || model.price.input === undefined) return 'Pricing unavailable';
    return `$${model.price.input.toFixed(2)}`;
  };

  const getSelectedProviderModels = (providerId: string): CatalogModel[] => {
    return models.filter((m) => m.providerId === providerId && m.available);
  };

  const getBestModelForStage = (stageModel: StageModel): CatalogModel | null => {
    if (!stageModel.selectedProvider) return null;
    const providerModels = getSelectedProviderModels(stageModel.selectedProvider);
    return providerModels.length > 0 ? providerModels[0] : null;
  };

  const estimateTotalCost = (): number => {
    let total = 0;
    let hasUnknown = false;
    STAGES.forEach((stage) => {
      const sm = stageModels[stage.id];
      const model = getBestModelForStage(sm);
      if (model && !model.price.isFree) {
        const input = model.price.input ?? 0;
        const output = model.price.output ?? 0;
        if (input === null || input === undefined || output === null || output === undefined) {
          hasUnknown = true;
        } else {
          total += input + output;
        }
      }
    });
    return hasUnknown ? -1 : total;
  };

  const handleApplyStageChange = (stageId: string, provider: string, model: string, reason: string, cost: string, isOverride: boolean) => {
    const stage = STAGES.find((s) => s.id === stageId);
    if (stage) {
      const newStageModels = { ...stageModels };
      newStageModels[stageId] = { stageId: stage.id, label: stage.label, selectedProvider: provider || null, selectedModel: model || null, isOverride: isOverride };
      setStageModels(newStageModels);
      setSelectedStageProvider(provider || '');
      setSelectedStageModel(model || '');
      setSelectedStageReason(reason);
      setSelectedStageCost(cost);
      setSelectedStagePriceInput(null);
      setSelectedStageIsOverride(isOverride);
    }
    setShowStageModal(null);
  };

  return (
    <AppShell user={user} gradient="dashboard">
      <div className="p-6 lg:p-8 max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-bw-peach-light mb-2">AI Models</h1>
          <p className="text-bw-peach">Connect providers, choose a model setup, and configure which model handles each bug-fixing stage.</p>
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

            <ModelSetupSection selected={setupChoice} onSelect={setSetupChoice} />

            <section>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-semibold text-bw-peach-light">Model Configuration</h2>
                <Badge variant="outline" className="text-xs text-bw-peach">Compact View</Badge>
              </div>

              <div className="overflow-x-auto">
                <div className="bg-bw-surface/50 border border-bw-surface rounded-xl">
                  <div className="grid grid-cols-12 gap-4 p-4 text-xs font-semibold text-bw-peach-light border-b border-bw-surface">
                    <div className="col-span-4">Stage</div>
                    <div className="col-span-4">Current Model</div>
                    <div className="col-span-3">Provider</div>
                    <div className="col-span-1 text-center">Status</div>
                    <div className="col-span-2 text-center">Action</div>
                  </div>
                  <div className="divide-y divide-bw-surface">
                    {STAGES.map((stage) => {
                      const sm = stageModels[stage.id];
                      const selectedProvider = sm.selectedProvider || '';
                      const providerModels = getSelectedProviderModels(selectedProvider);
                      const bestModel = getBestModelForStage(sm);
                      const stageCost = bestModel ? getStageCost(sm, bestModel) : 'Unknown';
                      const capability = bestModel ? getStageCapability(bestModel) : 'unknown';
                      const modelSubline = sm.selectedModel && sm.selectedProvider
                        ? (capability !== 'unknown' ? `${stageCost} · ${capability}` : stageCost)
                        : 'N/A';

                      const getModelDisplay = () => {
                        if (sm.selectedModel && sm.selectedProvider) {
                          const matchingModel = providerModels.find((m) => m.modelId === sm.selectedModel);
                          return matchingModel ? matchingModel.displayName : 'Not configured';
                        }
                        return bestModel ? bestModel.displayName : 'Not configured';
                      };

                      const getProviderDisplay = () => {
                        if (sm.selectedProvider) {
                          const provider = providers.find((p) => p.providerId === sm.selectedProvider);
                          return provider ? provider.displayName : sm.selectedProvider;
                        }
                        return 'Not configured';
                      };

                      const getStatusDisplay = () => {
                        if (!sm.selectedProvider && !sm.selectedModel) return {
                          text: 'No config',
                          variant: 'outline',
                          className: 'text-xs text-bw-peach bg-bw-surface/50',
                        };
                        if (sm.isOverride) return {
                          text: 'Custom',
                          variant: 'outline',
                          className: 'text-xs text-blue-500 bg-blue-500/10 border-blue-500',
                        };
                        return {
                          text: 'Active',
                          variant: 'default',
                          className: 'text-xs text-green-500 bg-green-500/10 border-green-500',
                        };
                      };

                      const status = getStatusDisplay();

                      return (
                        <div key={stage.id} className="p-4 hover:bg-bw-surface/80 transition-colors">
                          <div className="grid grid-cols-12 gap-4 items-center">
                            <div className="col-span-4 flex items-center gap-3">
                              <span className="text-lg">{stage.label}</span>
                              {sm.isOverride && (
                                <Badge variant="outline" className="text-xs text-blue-500 border-blue-500">
                                  Custom Override
                                </Badge>
                              )}
                            </div>
                            <div className="col-span-4">
                              <div className="text-sm text-bw-peach-light truncate">
                                {getModelDisplay()}
                              </div>
                               <div className="text-xs text-bw-peach/60 mt-0.5">
                                 {modelSubline}
                               </div>
                            </div>
                            <div className="col-span-3 text-xs text-bw-peach">
                              {getProviderDisplay()}
                            </div>
                            <div className="col-span-1">
                              <Badge className={status.className}>{status.text}</Badge>
                            </div>
                            <div className="col-span-2">
                              <Button
                                variant="outline"
                                size="sm"
                                className="w-full h-8 text-xs border-bw-surface bg-bw-surface/50 hover:bg-bw-surface/80"
                                onClick={() => {
                                  const selectedModelForCost = sm.selectedModel && sm.selectedProvider ? providerModels.find((m) => m.modelId === sm.selectedModel) : null;
                                  setShowStageModal(stage.id);
                                  setSelectedStageProvider(selectedProvider);
                                  setSelectedStageModel(sm.selectedModel || '');
                                  setSelectedStageReason(capability || 'unknown');
                                  setSelectedStageCost(stageCost);
                                  setSelectedStagePriceInput(selectedModelForCost ? selectedModelForCost.price.input : null);
                                  setSelectedStageIsOverride(sm.isOverride);
                                }}
                              >
                                <Settings2Icon className="h-3 w-3 mr-1" />
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

              <div className="mt-4 p-3 bg-bw-surface/30 border border-bw-surface rounded-lg">
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
                  <div className="text-2xl font-bold text-bw-peach-light">{formatCost(estimateTotalCost())}</div>
                </div>
              </Card>
            </section>

            <section>
              <Button onClick={handleSavePreference} disabled={saving} className="w-full max-w-md">
                {saving ? <><RefreshCwIcon className="mr-2 h-4 w-4 animate-spin" /> Saving...</> : <><ShieldCheckIcon className="mr-2 h-4 w-4" /> Save Preference</>}
              </Button>
            </section>

            {showStageModal && (
              <StageChangeModal stageId={showStageModal} stage={STAGES.find((s) => s.id === showStageModal) as typeof STAGES[0]} providers={providers} models={models} selectedProvider={selectedStageProvider} selectedModel={selectedStageModel} selectedReason={selectedStageReason} selectedCost={selectedStageCost} isOverride={selectedStageIsOverride} onApply={(provider, model, reason, cost, isOverride) => handleApplyStageChange(showStageModal!, provider, model, reason, cost, isOverride)} onCancel={() => setShowStageModal(null)} />
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function Card({ children, className, onClick }: { children: React.ReactNode; className?: string; onClick?: () => void }) {
  return <div className={`p-5 rounded-xl border border-bw-surface bg-bw-surface/50 ${className}`} onClick={onClick}>{children}</div>;
}

function formatCost(cost: number): string {
  if (cost === 0) return 'Free';
  if (cost === -1) return 'Pricing unavailable';
  if (cost < 0) return 'Pricing unavailable';
  return `$${cost.toFixed(2)}`;
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

function calculateTotalCost(model: CatalogModel): number {
  if (model.price.isFree) return 0;
  const input = model.price.input ?? 0;
  const output = model.price.output ?? 0;
  if (input === null || input === undefined || output === null || output === undefined) {
    return -1;
  }
  return input + output;
}

function formatContext(tokens: number): string {
  if (!tokens || tokens <= 0) return 'Unknown';
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(tokens % 1000000 === 0 ? 0 : 1)}M`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`;
  return `${tokens}`;
}

function getCostLabel(model: CatalogModel): string {
  if (model.price.isFree) return 'Free';
  if (model.price.input === null || model.price.input === undefined || model.price.output === null || model.price.output === undefined) {
    return 'Pricing unavailable';
  }
  return `$${model.price.input.toFixed(2)} in · $${model.price.output.toFixed(2)} out per 1M`;
}

function getCapabilityLabel(model: CatalogModel): string {
  const labels = model.capabilities.map((c) => CAPABILITY_LABELS[c] || c);
  if (labels.length > 0) return labels.join(' · ');
  if (model.tags.length > 0) return model.tags.map((t) => t.split('-').join(' ')).join(' · ');
  return '';
}

function ConnectedProvidersSection({ providers, models, onConnect, onDisconnect }: { providers: CatalogProvider[]; models: CatalogModel[]; onConnect: (providerId: string, apiKey: string) => Promise<void>; onDisconnect: (providerId: string) => Promise<void>; }) {
  const [showConnectPanel, setShowConnectPanel] = useState(false);
  const connected = providers.filter((p) => p.status === 'connected');
  const available = providers.filter((p) => p.status !== 'connected');

  return (
    <section>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-semibold text-bw-peach-light">Connected Providers</h2>
          <Badge variant="outline" className="text-xs text-bw-peach">{connected.length} connected</Badge>
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowConnectPanel((v) => !v)} disabled={available.length === 0}>
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

function ModelSetupSection({ selected, onSelect }: { selected: SetupChoice | null; onSelect: (setup: SetupChoice) => void; }) {
  return (
    <section>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold text-bw-peach-light">BugWiser Model Setup</h2>
        {selected && (
          <Badge variant="outline" className="text-xs text-bw-peach">
            {MODEL_SETUPS.find((s) => s.id === selected)?.title} selected
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {MODEL_SETUPS.map((setup) => {
          const isSelected = selected === setup.id;
          return (
            <Card key={setup.id} className={`p-5 flex flex-col ${isSelected ? 'ring-1 ring-primary-container' : ''}`}>
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-bw-peach-light">{setup.title}</h3>
                {isSelected && <Badge className="text-xs text-green-500 bg-green-500/10 border-green-500">Selected</Badge>}
              </div>
              <p className="text-xs text-bw-peach mt-2 flex-1">{setup.description}</p>
              <Button size="sm" variant={isSelected ? 'default' : 'outline'} className="mt-4" onClick={() => onSelect(setup.id)}>
                {isSelected ? 'Selected' : `Select ${setup.title}`}
              </Button>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

function ModelLibrary({ models, providers, baseCount, filter, onFilterChange, search, onSearchChange }: { models: CatalogModel[]; providers: CatalogProvider[]; baseCount: number; filter: LibraryFilter; onFilterChange: (filter: LibraryFilter) => void; search: string; onSearchChange: (search: string) => void; }) {
  return (
    <section>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold text-bw-peach-light">Model Library</h2>
        <Badge variant="outline" className="text-xs text-bw-peach">{models.length} of {baseCount} models</Badge>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {LIBRARY_FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => onFilterChange(f.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              filter === f.id
                ? 'bg-primary-container text-on-primary-container border-primary-container'
                : 'border-bw-surface bg-bw-surface/50 text-bw-peach hover:bg-bw-surface/80'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <input
        type="text"
        placeholder="Search models by name, ID, or provider..."
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        className="w-full px-4 py-2 rounded-lg border border-bw-surface bg-bw-surface/50 text-sm text-bw-peach-light placeholder-bw-peach/60 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all mb-4"
      />

      {baseCount === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-sm font-medium text-bw-peach-light">No models available</p>
          <p className="text-xs text-bw-peach mt-1">Models from your connected providers will appear here.</p>
        </Card>
      ) : models.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-sm font-medium text-bw-peach-light">No models match</p>
          <p className="text-xs text-bw-peach mt-1">Try a different filter or search term.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {models.map((model) => (
            <ModelCard key={`${model.providerId}-${model.modelId}`} model={model} providers={providers} />
          ))}
        </div>
      )}
    </section>
  );
}

function ModelCard({ model, providers }: { model: CatalogModel; providers: CatalogProvider[] }) {
  const provider = providers.find((p) => p.providerId === model.providerId);
  const capabilities = getCapabilityLabel(model);

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-bw-peach-light truncate">{model.displayName}</div>
          <div className="text-xs text-bw-peach mt-1">{provider ? provider.displayName : model.providerId}</div>
        </div>
        <Badge className={model.price.isFree ? 'text-xs text-green-500 bg-green-500/10 border-green-500' : 'text-xs text-purple-500 bg-purple-500/10 border-purple-500'}>
          {model.price.isFree ? 'Free' : 'Paid'}
        </Badge>
      </div>
      <div className="mt-3 space-y-1 text-xs text-bw-peach">
        <div><span className="font-semibold text-bw-peach-light">Cost:</span> {getCostLabel(model)}</div>
        <div><span className="font-semibold text-bw-peach-light">Context:</span> <span className="font-mono">{formatContext(model.contextWindow)}</span></div>
        {capabilities && <div><span className="font-semibold text-bw-peach-light">Capabilities:</span> {capabilities}</div>}
      </div>
    </Card>
  );
}

function StageChangeModal({ stageId, stage, providers, models, selectedProvider, selectedModel, selectedReason, selectedCost, isOverride, onApply, onCancel, initialPriceInput }: { stageId: string; stage: typeof STAGES[0]; providers: CatalogProvider[]; models: CatalogModel[]; selectedProvider: string; selectedModel: string; selectedReason: string; selectedCost: string; isOverride: boolean; onApply: (provider: string, model: string, reason: string, cost: string, isOverride: boolean) => void; onCancel: () => void; initialPriceInput?: number | null; }) {
  const [localProvider, setLocalProvider] = useState(selectedProvider);
  const [localModel, setLocalModel] = useState(selectedModel);
  const [localReason, setLocalReason] = useState(selectedReason);
  const [localCost, setLocalCost] = useState(selectedCost);
  const [localIsOverride, setLocalIsOverride] = useState(isOverride);
  const [localPriceInput, setLocalPriceInput] = useState<number | null>(initialPriceInput || null);
  const [modelSearch, setModelSearch] = useState('');

  const connectedProviderModels = useMemo(() => {
    return providers.filter((p) => p.status === 'connected').flatMap((p) => models.filter((m) => m.providerId === p.providerId && m.available));
  }, [providers, models]);

  const filteredModels = useMemo(() => {
    const query = modelSearch.toLowerCase().trim();
    if (!query) {
      return connectedProviderModels;
    }
    return connectedProviderModels.filter((m) => 
      m.displayName.toLowerCase().includes(query) ||
      m.modelId.toLowerCase().includes(query) ||
      m.providerId.toLowerCase().includes(query)
    );
  }, [connectedProviderModels, modelSearch]);

  const recommendedModels = useMemo(() => {
    return filteredModels.sort((a, b) => b.valueScore - a.valueScore).slice(0, 4);
  }, [filteredModels]);

  const freeModels = useMemo(() => {
    return filteredModels.filter((m) => m.price.isFree).sort((a, b) => b.valueScore - a.valueScore);
  }, [filteredModels]);

  const paidModels = useMemo(() => {
    return filteredModels.filter((m) => !m.price.isFree).sort((a, b) => b.valueScore - a.valueScore);
  }, [filteredModels]);

  const handleApply = () => {
    const reason = localReason || 'Recommended model';
    const cost = localCost || 'N/A';
    onApply(localProvider, localModel, reason, cost, localIsOverride);
    setLocalPriceInput(null);
  };

  const hasModels = connectedProviderModels.length > 0;
  const searchEmpty = modelSearch.trim() && filteredModels.length === 0;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-bw-surface border border-bw-surface rounded-xl p-6 w-full max-w-lg max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-semibold text-bw-peach-light">Change Model for {stage.label}</h3>
          <button onClick={onCancel} className="text-bw-peach hover:text-bw-peach-light">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto pr-2 -mr-2">
          <div className="pt-4 pb-4">
            <input
              type="text"
              placeholder="Search models by name, ID, or provider..."
              value={modelSearch}
              onChange={(e) => setModelSearch(e.target.value)}
              className="w-full px-4 py-2 rounded-lg border border-bw-surface bg-bw-surface/50 text-bw-peach-light placeholder-bw-peach/60 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
            />
          </div>

          {!modelSearch && (
            <>
              <div className="mb-4">
                <h4 className="text-sm font-semibold text-bw-peach-light mb-3">Recommended</h4>
                <div className="space-y-2">
                  {recommendedModels.map((model) => {
                    const cost = calculateTotalCost(model);
                    const isBest = model.valueScore === Math.max(...connectedProviderModels.map(m => m.valueScore));
                    return (
                      <button key={model.modelId} onClick={() => {
                        setLocalProvider(model.providerId);
                        setLocalModel(model.modelId);
                        setLocalReason('Best value model');
                        const displayCost = localPriceInput !== null ? formatCost(localPriceInput) : formatCost(cost);
                        setLocalCost(displayCost);
                      }} className={`w-full text-left p-3 rounded-lg border transition-colors ${localModel === model.modelId ? 'border-green-500 bg-green-500/10' : 'border-bw-surface bg-bw-surface/50 hover:bg-bw-surface/80'} ${!model.available ? 'opacity-50 cursor-not-allowed' : ''}`}>
                        <div className="flex items-center justify-between">
                          <span className="text-bw-peach-light font-medium">{model.displayName}</span>
                          {isBest && <span className="text-xs bg-green-500 text-white px-2 py-0.5 rounded-full">Best Value</span>}
                        </div>
                        <div className="text-xs text-bw-peach mt-1">{model.providerId} • {localPriceInput !== null ? formatCost(localPriceInput) : formatCost(cost)} • {getStageCapability(model)}</div>
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
                    const cost = calculateTotalCost(model);
                    return (
                      <button key={model.modelId} onClick={() => {
                        setLocalProvider(model.providerId);
                        setLocalModel(model.modelId);
                        setLocalReason('Free model');
                        const displayCost = localPriceInput !== null ? formatCost(localPriceInput) : formatCost(cost);
                        setLocalCost(displayCost);
                      }} disabled={!model.available} className={`w-full text-left p-3 rounded-lg border transition-colors ${localModel === model.modelId ? 'border-green-500 bg-green-500/10' : 'border-bw-surface bg-bw-surface/50 hover:bg-bw-surface/80'} ${!model.available ? 'opacity-50 cursor-not-allowed' : ''}`}>
                        <div className="flex items-center justify-between">
                          <span className="text-bw-peach-light">{model.displayName}</span>
                          {localModel === model.modelId && <span className="text-xs bg-green-500 text-white px-2 py-0.5 rounded-full">Selected</span>}
                        </div>
                        <div className="text-xs text-bw-peach mt-1">{model.providerId} • {localPriceInput !== null ? formatCost(localPriceInput) : formatCost(cost)} • {getStageCapability(model)}</div>
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
                    const cost = calculateTotalCost(model);
                    return (
                      <button key={model.modelId} onClick={() => {
                        setLocalProvider(model.providerId);
                        setLocalModel(model.modelId);
                        setLocalReason('Paid model');
                        const displayCost = localPriceInput !== null ? formatCost(localPriceInput) : formatCost(cost);
                        setLocalCost(displayCost);
                      }} className={`w-full text-left p-3 rounded-lg border transition-colors ${localModel === model.modelId ? 'border-purple-500 bg-purple-500/10' : 'border-bw-surface bg-bw-surface/50 hover:bg-bw-surface/80'}`}>
                        <div className="flex items-center justify-between">
                          <span className="text-bw-peach-light">{model.displayName}</span>
                          {localModel === model.modelId && <span className="text-xs bg-purple-500 text-white px-2 py-0.5 rounded-full">Selected</span>}
                        </div>
                        <div className="text-xs text-bw-peach mt-1">{model.providerId} • {localPriceInput !== null ? formatCost(localPriceInput) : formatCost(cost)} • {getStageCapability(model)}</div>
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
                  <p className="text-bw-peach/60 text-xs mt-1">Try a different search term.</p>
                </div>
              )}
              {!searchEmpty && filteredModels.length === 0 && (
                <div className="text-center py-8">
                  <p className="text-bw-peach text-sm">No models match your search</p>
                  <p className="text-bw-peach/60 text-xs mt-1">Try searching by model name, ID, or provider.</p>
                </div>
              )}
              {!searchEmpty && (
                <>
                  <div className="mb-4">
                    <h4 className="text-sm font-semibold text-bw-peach-light mb-3">Recommended</h4>
                    <div className="space-y-2">
                      {recommendedModels.map((model) => {
                        const cost = calculateTotalCost(model);
                        const isBest = model.valueScore === Math.max(...connectedProviderModels.map(m => m.valueScore));
                        return (
                          <button key={model.modelId} onClick={() => {
                            setLocalProvider(model.providerId);
                            setLocalModel(model.modelId);
                            setLocalReason('Best value model');
                            const displayCost = localPriceInput !== null ? formatCost(localPriceInput) : formatCost(cost);
                            setLocalCost(displayCost);
                          }} className={`w-full text-left p-3 rounded-lg border transition-colors ${localModel === model.modelId ? 'border-green-500 bg-green-500/10' : 'border-bw-surface bg-bw-surface/50 hover:bg-bw-surface/80'} ${!model.available ? 'opacity-50 cursor-not-allowed' : ''}`}>
                            <div className="flex items-center justify-between">
                              <span className="text-bw-peach-light font-medium">{model.displayName}</span>
                              {isBest && <span className="text-xs bg-green-500 text-white px-2 py-0.5 rounded-full">Best Value</span>}
                            </div>
                            <div className="text-xs text-bw-peach mt-1">{model.providerId} • {localPriceInput !== null ? formatCost(localPriceInput) : formatCost(cost)} • {getStageCapability(model)}</div>
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
                        const cost = calculateTotalCost(model);
                        return (
                          <button key={model.modelId} onClick={() => {
                            setLocalProvider(model.providerId);
                            setLocalModel(model.modelId);
                            setLocalReason('Free model');
                            const displayCost = localPriceInput !== null ? formatCost(localPriceInput) : formatCost(cost);
                            setLocalCost(displayCost);
                          }} disabled={!model.available} className={`w-full text-left p-3 rounded-lg border transition-colors ${localModel === model.modelId ? 'border-green-500 bg-green-500/10' : 'border-bw-surface bg-bw-surface/50 hover:bg-bw-surface/80'} ${!model.available ? 'opacity-50 cursor-not-allowed' : ''}`}>
                            <div className="flex items-center justify-between">
                              <span className="text-bw-peach-light">{model.displayName}</span>
                              {localModel === model.modelId && <span className="text-xs bg-green-500 text-white px-2 py-0.5 rounded-full">Selected</span>}
                            </div>
                            <div className="text-xs text-bw-peach mt-1">{model.providerId} • {localPriceInput !== null ? formatCost(localPriceInput) : formatCost(cost)} • {getStageCapability(model)}</div>
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
                        const cost = calculateTotalCost(model);
                        return (
                          <button key={model.modelId} onClick={() => {
                            setLocalProvider(model.providerId);
                            setLocalModel(model.modelId);
                            setLocalReason('Paid model');
                            const displayCost = localPriceInput !== null ? formatCost(localPriceInput) : formatCost(cost);
                            setLocalCost(displayCost);
                          }} className={`w-full text-left p-3 rounded-lg border transition-colors ${localModel === model.modelId ? 'border-purple-500 bg-purple-500/10' : 'border-bw-surface bg-bw-surface/50 hover:bg-bw-surface/80'}`}>
                            <div className="flex items-center justify-between">
                              <span className="text-bw-peach-light">{model.displayName}</span>
                              {localModel === model.modelId && <span className="text-xs bg-purple-500 text-white px-2 py-0.5 rounded-full">Selected</span>}
                            </div>
                            <div className="text-xs text-bw-peach mt-1">{model.providerId} • {localPriceInput !== null ? formatCost(localPriceInput) : formatCost(cost)} • {getStageCapability(model)}</div>
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

        <div className="pt-4 border-t border-bw-surface mt-auto">
          <div className="text-sm text-bw-peach">
            <div className="flex items-center gap-2 mb-2">
              <input type="checkbox" id={`override-${stageId}`} checked={localIsOverride} onChange={(e) => setLocalIsOverride(e.target.checked)} />
              <label htmlFor={`override-${stageId}`}>Custom Override</label>
            </div>
            <p className="text-xs text-bw-peach/80">Enable to create a custom override for this stage.</p>
          </div>
          <div className="flex items-center justify-between mt-4">
            <Button variant="outline" onClick={onCancel}>Cancel</Button>
            <Button onClick={handleApply}>Apply Change</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
