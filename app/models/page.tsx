'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { RefreshCwIcon, ShieldCheckIcon, Settings2Icon } from 'lucide-react';
import type { GitHubUser } from '@/types';
import { ALL_PRESETS, type PresetDefinition } from '@/lib/ai/presets';
import type { AnalysisTask } from '@/lib/ai/config';

const STRATEGY_TITLES = {
  free: { title: '🆓 Fully Free', subtitle: 'Zero model cost', color: 'bg-green-500', border: 'border-green-500' },
  'free-paid': { title: '⚡ Free + Paid', subtitle: 'Free models for simple work', color: 'bg-orange-500', border: 'border-orange-500' },
  fully_paid: { title: '💎 Fully Paid', subtitle: 'Best paid models throughout', color: 'bg-purple-500', border: 'border-purple-500' },
  custom: { title: '⚙ Custom', subtitle: 'Control stages yourself', color: 'bg-blue-500', border: 'border-blue-500' },
};

const STAGES = [
  { id: 'relevant_file_discovery', label: '🔍 File Discovery', task: 'relevant_file_discovery', provider: 'simple_coding' },
  { id: 'root_cause_analysis', label: '🧠 Root Cause Analysis', task: 'root_cause_analysis', provider: 'complex_debugging' },
  { id: 'evidence_extraction', label: '📋 Evidence Extraction', task: 'evidence_extraction', provider: 'evidence_extraction' },
  { id: 'solution_generation', label: '💡 Solution Generation', task: 'solution_generation', provider: 'code_generation' },
  { id: 'patch_generation', label: '🔧 Patch Generation', task: 'patch_generation', provider: 'code_generation' },
];

type StageModel = { stageId: string; label: string; selectedProvider: string | null; selectedModel: string | null; isOverride: boolean; };

export interface CatalogProvider { providerId: string; displayName: string; authType: 'api_key' | 'oauth' | 'none'; status: 'disconnected' | 'connected' | 'error'; connectedAt: string | null; serverConfigured: boolean; description: string; docsUrl: string; }

export interface CatalogModel { providerId: string; modelId: string; displayName: string; contextWindow: number; maxOutputTokens: number | null; price: { input: number | null; output: number | null; isFree: boolean }; supportsReasoning: boolean; supportsToolCalling: boolean; supportsStructuredOutput: boolean; capabilities: string[]; availability: string; scores: { coding: number; reasoning: number; speed: number; longContext: number }; valueScore: number; tags: string[]; fit: number; stageFit: Record<string, number>; available: boolean; }

export interface Preference { user_id: string; provider: string | null; model: string | null; selection_mode: 'auto' | 'manual'; selected_strategy?: 'auto' | 'free' | 'free_paid' | 'fully_paid' | 'custom'; stage_overrides?: Record<string, { provider: string | null; model: string | null }>; }

export default function ModelsPage() {
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [providers, setProviders] = useState<CatalogProvider[]>([]);
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [preference, setPreference] = useState<Preference | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedStrategy, setSelectedStrategy] = useState<keyof typeof STRATEGY_TITLES>('free');
  const [showStageModal, setShowStageModal] = useState<string | null>(null);
  const [selectedStageProvider, setSelectedStageProvider] = useState<string>('');
  const [selectedStageModel, setSelectedStageModel] = useState<string>('');
  const [selectedStageReason, setSelectedStageReason] = useState<string>('');
  const [selectedStageCost, setSelectedStageCost] = useState<string>('');
  const [selectedStagePriceInput, setSelectedStagePriceInput] = useState<number | null>(null);
  const [selectedStageIsOverride, setSelectedStageIsOverride] = useState<boolean>(false);
  const [stageModels, setStageModels] = useState<Record<string, StageModel>>({});
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [filter, setFilter] = useState<'free' | 'paid' | 'all' | undefined>();
  const [providerFilter, setProviderFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  const connectedProviders = useMemo(() => providers.filter((p) => p.status === 'connected'), [providers]);
  const connectedModels = useMemo(() => models.filter((m) => m.available), [models]);

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
      const strategy = pref.selected_strategy || 'free' as keyof typeof STRATEGY_TITLES;
      setSelectedStrategy(strategy as keyof typeof STRATEGY_TITLES);
      const overrides = pref.stage_overrides || {};
      // Check if a preset was selected (not auto/manual)
      if ((pref.selection_mode as string) === 'preset' && pref.preset_id) {
        const preset = ALL_PRESETS.find(p => p.id === pref.preset_id);
        if (preset) {
          const loaded: Partial<Record<AnalysisTask, StageModel>> = {};
          STAGES.forEach((stage) => {
            const presetAssignment = preset.assignments[stage.task];
            loaded[stage.task] = {
              stageId: stage.task,
              label: stage.label,
              selectedProvider: presetAssignment.provider || null,
              selectedModel: presetAssignment.model || null,
              isOverride: false,
            };
          });
          setStageModels(loaded as Record<string, StageModel>);
          setSelectedPreset(pref.preset_id);
        }
      } else {
        loadStageModels(overrides);
      }
    } else {
      setSelectedStrategy('free' as keyof typeof STRATEGY_TITLES);
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
        body: JSON.stringify({ selection_mode: selectedStrategy === 'custom' ? 'manual' : 'auto', selected_strategy: selectedStrategy, provider: selectedStrategy === 'custom' ? null : null, model: selectedStrategy === 'custom' ? null : null, stage_overrides: stageOverrides }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save preference');
      setPreference(data.preference);
      toast.success('Strategy saved successfully');
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

  const filteredModels = useMemo(() => {
    let list = connectedModels;
    if (filter === 'free') list = list.filter((m) => m.price.isFree && m.available).sort((a, b) => b.valueScore - a.valueScore);
    if (filter === 'paid') list = list.filter((m) => !m.price.isFree && m.available).sort((a, b) => b.valueScore - a.valueScore);
    if (providerFilter !== 'all') list = list.filter((m) => m.providerId === providerFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((m) => m.displayName.toLowerCase().includes(q) || m.modelId.toLowerCase().includes(q));
    }
    return list;
  }, [connectedModels, filter, providerFilter, search]);

  const getStageCost = (stageModel: StageModel, model: CatalogModel): string => {
    if (!model) return 'Unknown';
    if (model.price.isFree) return 'Free';
    if (model.price.input === null || model.price.input === undefined) return 'Pricing unavailable';
    return `$${model.price.input.toFixed(2)}`;
  };

  const isPresetModel = (stageId: string): boolean => {
    if (!selectedPreset) return false;
    const preset = ALL_PRESETS.find(p => p.id === selectedPreset);
    if (!preset) return false;
    const assignment = preset.assignments[stageId as AnalysisTask];
    return !!assignment;
  };

    const recommendedModels = useMemo(() => [...connectedModels].sort((a, b) => b.fit - a.fit).slice(0, 4), [connectedModels]);
  const freeModels = useMemo(() => [...connectedModels].filter((m) => m.price.isFree).sort((a, b) => b.valueScore - a.valueScore), [connectedModels]);
  const paidModels = useMemo(() => [...connectedModels].filter((m) => !m.price.isFree).sort((a, b) => b.valueScore - a.valueScore), [connectedModels]);
  const noProviders = connectedProviders.length === 0;

  const getSelectedProviderModels = (providerId: string): CatalogModel[] => {
    return models.filter((m) => m.providerId === providerId && m.available);
  };

  const getBestModelForStage = (stageModel: StageModel): CatalogModel | null => {
    if (!stageModel.selectedProvider) return null;
    const providerModels = getSelectedProviderModels(stageModel.selectedProvider);
    return providerModels.length > 0 ? providerModels[0] : null;
  };

  const calculateTotalCost = (model: CatalogModel): number => {
    if (model.price.isFree) return 0;
    const input = model.price.input ?? 0;
    const output = model.price.output ?? 0;
    // If either input or output is unknown (null), we cannot calculate a meaningful cost
    if (input === null || input === undefined || output === null || output === undefined) {
      return -1; // Signal unknown cost
    }
    return input + output;
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
        // Check if pricing is unknown
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

  const applyPreset = (preset: PresetDefinition) => {
    const loaded: Partial<Record<AnalysisTask, StageModel>> = {};
    STAGES.forEach((stage) => {
      const presetAssignment = preset.assignments[stage.task];
      loaded[stage.task] = {
        stageId: stage.task,
        label: stage.label,
        selectedProvider: presetAssignment.provider || null,
        selectedModel: presetAssignment.model || null,
        isOverride: false,
      };
    });
    setStageModels(loaded as Record<string, StageModel>);
    setSelectedPreset(preset.id);
    // If a strategy is associated with the preset, update it
    if (preset.id === 'efficient') setSelectedStrategy('free');
    else if (preset.id === 'balanced') setSelectedStrategy('free-paid');
    else if (preset.id === 'fast') setSelectedStrategy('free');
    else if (preset.id === 'quality') setSelectedStrategy('fully_paid');
  };

  return (
    <AppShell user={user} gradient="dashboard">
      <div className="p-6 lg:p-8 max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-bw-peach-light mb-2">BugWiser AI</h1>
          <p className="text-bw-peach">Configure how BugWiser handles your bug fixes. Choose a strategy and customize each stage.</p>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-lg border border-error-container bg-error-container/20 text-sm text-error-default">{error}</div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-16 text-bw-peach">
            <span className="w-5 h-5 border-2 border-primary-container/30 border-t-primary-container rounded-full animate-spin" />
            <span className="ml-3 text-sm">Loading strategy configuration...</span>
          </div>
        )}

        {!loading && !error && (
          <div className="space-y-8">
            <section>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(Object.keys(STRATEGY_TITLES) as (keyof typeof STRATEGY_TITLES)[]).map((key) => (
                  <Card key={key} className={`p-6 cursor-pointer transition-all duration-200 hover:scale-[1.02] ${selectedStrategy === key ? `border-${STRATEGY_TITLES[key].border} bg-white/10` : 'border-bw-surface border-bw-surface/50 bg-bw-surface/50'}`} onClick={() => setSelectedStrategy(key)}>
                    <div className="flex items-start gap-4">
                      <div className={`w-12 h-12 rounded-lg ${STRATEGY_TITLES[key].color} bg-opacity-20 flex items-center justify-center`}>
                        <span className="text-xl">{STRATEGY_TITLES[key].title.split('')[0]}</span>
                      </div>
                      <div className="flex-1">
                        <h3 className="text-lg font-semibold text-bw-peach-light">{STRATEGY_TITLES[key].title}</h3>
                        <p className="text-sm text-bw-peach mt-1">{STRATEGY_TITLES[key].subtitle}</p>
                        <Separator className="my-4" />
                        <div className="flex items-center gap-2 text-xs text-bw-peach">
                          <span className="text-bw-peach-light">Cost:</span>
                          {key === 'free' ? <span className="text-green-500 font-semibold">$0.00</span> : key === 'free-paid' ? <span className="text-orange-500">Free + Paid</span> : key === 'fully_paid' ? <span className="text-purple-500">Paid</span> : <span className="text-blue-500">Custom</span>}
                        </div>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-bw-peach-light mb-6">BugWiser Recommended</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {ALL_PRESETS.map((preset) => {
                  const isSelected = selectedPreset === preset.id;
                  const strategy = selectedStrategy as keyof typeof STRATEGY_TITLES;
                  const strategyTitle = STRATEGY_TITLES[strategy]?.title || 'Custom';
                  return (
                    <Card
                      key={preset.id}
                      className={`p-6 cursor-pointer transition-all duration-200 hover:scale-[1.02] border-2 ${isSelected ? `border-${STRATEGY_TITLES[strategy].border} bg-white/15` : 'border-bw-surface border-bw-surface/50 bg-bw-surface/50'}`}
                      onClick={() => applyPreset(preset)}
                    >
                      <div className="flex items-start gap-4">
                        <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${preset.id === 'efficient' ? 'bg-green-500/20' : preset.id === 'balanced' ? 'bg-orange-500/20' : preset.id === 'fast' ? 'bg-blue-500/20' : 'bg-purple-500/20'}`}>
                          <span className="text-xl font-bold">{preset.name[0]}</span>
                        </div>
                        <div className="flex-1">
                          <h3 className="text-lg font-semibold text-bw-peach-light">{preset.name}</h3>
                          <p className="text-sm text-bw-peach mt-1">{preset.description}</p>
                          <Separator className="my-4" />
                          <div className="text-xs text-bw-peach">
                            <span className="text-bw-peach-light">Strategy:</span>
                            <span className="ml-2 font-medium">{strategyTitle}</span>
                          </div>
                          <div className="text-xs text-bw-peach/70 mt-2">
                            <span className="text-bw-peach-light">Stages:</span>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {STAGES.slice(0, 2).map((stage) => (
                                <span key={stage.id} className="text-xs bg-bw-surface/50 px-2 py-0.5 rounded">{stage.label}</span>
                              ))}
                              <span className="text-xs bg-bw-surface/30 px-2 py-0.5 rounded">...</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </section>

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
                      const isCustom = selectedStrategy === 'custom';
                      let selectedModelInfo: CatalogModel | null = null;
                      if (sm.selectedModel && sm.selectedProvider) {
                        const matchingModel = providerModels.find((m) => m.modelId === sm.selectedModel);
                        selectedModelInfo = matchingModel || null;
                      }
                      const bestModel = selectedModelInfo || (providerModels.length > 0 ? providerModels[0] : null);
                      const stageCost = bestModel ? getStageCost(sm, bestModel) : 'Unknown';
                      const capability = bestModel ? getStageCapability(bestModel) : 'unknown';

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
                              {isCustom && sm.isOverride && (
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
                                {sm.selectedModel && sm.selectedProvider ? stageCost : 'N/A'}
                              </div>
                            </div>
                            <div className="col-span-3 text-xs text-bw-peach">
                              {getProviderDisplay()}
                            </div>
                            <div className="col-span-1">
                              <Badge className={status.className}>{status.text}</Badge>
                            </div>
                            <div className="col-span-1 text-center">
                              {selectedPreset && (
                                <button
                                  onClick={() => {
                                    setSelectedPreset(null);
                                    setSelectedStrategy('free');
                                    setStageModels({});
                                    setSelectedStageProvider('');
                                    setSelectedStageModel('');
                                  }}
                                  className="text-xs text-bw-peach/60 hover:text-bw-peach-light"
                                  title="Clear preset selection"
                                >
                                  ✕
                                </button>
                              )}
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
                  <span className="font-semibold text-bw-peach-light">Tip:</span> Click "Configure" to customize any stage. Changes are saved when you click "Save Strategy" below.
                </p>
              </div>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-bw-peach-light mb-6">Your Bug-Fixing Pipeline</h2>
              <div className="space-y-4">
                {STAGES.map((stage) => {
                  const sm = stageModels[stage.id];
                  const selectedProvider = sm.selectedProvider || '';
                  const providerModels = getSelectedProviderModels(selectedProvider);
                  let selectedModelInfo: CatalogModel | null = null;
                  if (sm.selectedModel && sm.selectedProvider) {
                    const matchingModel = providerModels.find((m) => m.modelId === sm.selectedModel);
                    selectedModelInfo = matchingModel || null;
                  }
                  const bestModel = selectedModelInfo || (providerModels.length > 0 ? providerModels[0] : null);
                  const stageCost = bestModel ? getStageCost(sm, bestModel) : 'Unknown';
                  const capability = bestModel ? getStageCapability(bestModel) : 'unknown';
                  const isCustom = selectedStrategy === 'custom';

                  return (
                    <Card key={stage.id} className="p-5">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <span className="text-xl">{stage.label}</span>
                          {isCustom && sm.isOverride && <Badge variant="outline" className="text-blue-500 border-blue-500">Custom Override</Badge>}
                          {selectedPreset && (
                            <Badge variant="outline" className="text-xs text-orange-500 border-orange-500">
                              Recommended
                            </Badge>
                          )}
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => {
                          const selectedModelForCost = sm.selectedModel && sm.selectedProvider ? providerModels.find((m) => m.modelId === sm.selectedModel) : null;
                          setShowStageModal(stage.id);
                          setSelectedStageProvider(selectedProvider);
                          setSelectedStageModel(sm.selectedModel || '');
                          setSelectedStageReason(bestModel ? getStageCapability(bestModel) : 'unknown');
                          setSelectedStageCost(stageCost);
                          setSelectedStagePriceInput(selectedModelForCost ? selectedModelForCost.price.input : null);
                          setSelectedStageIsOverride(sm.isOverride);
                        }}>Change Model</Button>
                      </div>
                      <div className="text-sm text-bw-peach">
                        <div className="flex items-center gap-4 text-xs text-bw-peach-light mb-2">
                          <span>Model: {bestModel?.displayName || 'Not selected'}</span>
                          <span>Provider: {bestModel?.providerId || 'N/A'}</span>
                          <span>Cost: {stageCost}</span>
                        </div>
                        <p className="text-xs text-bw-peach/80">{capability}</p>
                      </div>
                    </Card>
                  );
                })}
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
                {saving ? <><RefreshCwIcon className="mr-2 h-4 w-4 animate-spin" /> Saving...</> : <><ShieldCheckIcon className="mr-2 h-4 w-4" /> Save Strategy</>}
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

function formatCost(cost: number): string {
  if (cost === 0) return 'Free';
  if (cost === -1) return 'Pricing unavailable';
  if (cost < 0) return 'Pricing unavailable';
  return `$${cost.toFixed(2)}`;
}

function calculateTotalCost(model: CatalogModel): number {
  if (model.price.isFree) return 0;
  const input = model.price.input ?? 0;
  const output = model.price.output ?? 0;
  // If either input or output is unknown (null), we cannot calculate a meaningful cost
  if (input === null || input === undefined || output === null || output === undefined) {
    return -1; // Signal unknown cost
  }
  return input + output;
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
    // Reset the price input so next time it reads from the selected model
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
          {/* Search Input */}
          <div className="pt-4 pb-4">
            <input
              type="text"
              placeholder="Search models by name, ID, or provider..."
              value={modelSearch}
              onChange={(e) => setModelSearch(e.target.value)}
              className="w-full px-4 py-2 rounded-lg border border-bw-surface bg-bw-surface/50 text-bw-peach-light placeholder-bw-peach/60 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
            />
          </div>

          {/* Recommended Models */}
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

          {/* Search Results */}
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
                  {hasModels && (
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
            </>
          )}
        </div>

        {/* Sticky Footer - Always Visible */}
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

function Card({ children, className, onClick }: { children: React.ReactNode; className?: string; onClick?: () => void }) {
  return <div className={`p-5 rounded-xl border border-bw-surface bg-bw-surface/50 ${className}`} onClick={onClick}>{children}</div>;
}
