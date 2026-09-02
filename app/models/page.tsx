'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { ProviderCard } from '@/components/models/ProviderCard';
import { ModelCard } from '@/components/models/ModelCard';
import { ModelControls } from '@/components/models/ModelControls';
import { SelectedModelSummary } from '@/components/models/SelectedModelSummary';
import { ModelComparison } from '@/components/models/ModelComparison';
import { toast } from 'sonner';
import { GitHubUser } from '@/types';

export interface CatalogProvider {
  providerId: string;
  displayName: string;
  authType: 'api_key' | 'oauth' | 'none';
  status: 'disconnected' | 'connected' | 'error';
  connectedAt: string | null;
  serverConfigured: boolean;
  description: string;
  docsUrl: string;
}

export interface CatalogModel {
  providerId: string;
  modelId: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number | null;
  price: { input: number | null; output: number | null; isFree: boolean };
  supportsReasoning: boolean;
  supportsToolCalling: boolean;
  supportsStructuredOutput: boolean;
  capabilities: string[];
  availability: string;
  scores: { coding: number; reasoning: number; speed: number; longContext: number };
  tags: string[];
  fit: number;
  stageFit: Record<string, number>;
  available: boolean;
}

export interface Preference {
  user_id: string;
  provider: string | null;
  model: string | null;
  selection_mode: 'auto' | 'manual';
}

type FilterKey = 'all' | 'free' | 'paid' | 'best-coding' | 'best-reasoning' | 'fast' | 'long-context';

export default function ModelsPage() {
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [providers, setProviders] = useState<CatalogProvider[]>([]);
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [preference, setPreference] = useState<Preference | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selection UI state
  const [mode, setMode] = useState<'auto' | 'manual'>('auto');
  const [selectedProvider, setSelectedProvider] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>('');

  // Filters
  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');
  const [providerFilter, setProviderFilter] = useState<string>('all');
  const [compareIds, setCompareIds] = useState<string[]>([]);

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

  const applyData = useCallback((payload: {
    user: { user_metadata?: Record<string, unknown> } | null;
    data: {
      providers?: CatalogProvider[];
      models?: CatalogModel[];
      preference?: Preference;
    };
  }) => {
    const au = payload.user;
    const meta = au?.user_metadata ?? {};
    setUser({
      login: (meta.user_name as string) || (meta.login as string) || 'user',
      name: (meta.full_name as string) || (meta.name as string) || null,
      avatarUrl: (meta.avatar_url as string) || '',
    });
    const data = payload.data;
    setProviders(data.providers || []);
    setModels(data.models || []);
    if (data.preference) {
      const pref = data.preference;
      setPreference(pref);
      setMode(pref.selection_mode || 'auto');
      setSelectedProvider(pref.provider || '');
      setSelectedModel(pref.model || '');
    }
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

  // Data-loading effect: setState only occurs in async continuations after fetch.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  const handleSavePreference = async () => {
    try {
      if (mode === 'manual' && (!selectedProvider || !selectedModel)) {
        toast.error('Select a provider and model for manual mode.');
        return;
      }
      const res = await fetch('/api/models/preference', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selection_mode: mode,
          provider: mode === 'manual' ? selectedProvider : null,
          model: mode === 'manual' ? selectedModel : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save preference');
      setPreference(data.preference);
      toast.success(mode === 'manual'
        ? 'Manual model saved. BugWiser will use it for all AI stages.'
        : 'Auto mode saved. BugWiser picks the best model per stage.');
      await refresh();
    } catch (e) {
      const err = e as Error;
      toast.error(err.message || 'Failed to save preference');
    }
  };

  const handleConnect = async (providerId: string, apiKey: string) => {
    try {
      const res = await fetch('/api/models/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: providerId, apiKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to connect');
      toast.success(`${providerId} connected.`);
      await refresh();
    } catch (e) {
      const err = e as Error;
      toast.error(err.message || 'Connection failed');
      throw err;
    }
  };

  const handleDisconnect = async (providerId: string) => {
    try {
      const res = await fetch(`/api/models/connections/${providerId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to disconnect');
      toast.success(`${providerId} disconnected.`);
      await refresh();
    } catch (e) {
      const err = e as Error;
      toast.error(err.message || 'Disconnect failed');
    }
  };

  const filteredModels = useMemo(() => {
    let list = models;
    if (filter === 'free') list = list.filter((m) => m.price.isFree);
    if (filter === 'paid') list = list.filter((m) => !m.price.isFree);
    if (filter === 'best-coding') list = list.filter((m) => (m.scores.coding ?? 0) >= 4);
    if (filter === 'best-reasoning') list = list.filter((m) => m.supportsReasoning && (m.scores.reasoning ?? 0) >= 4);
    if (filter === 'fast') list = list.filter((m) => (m.scores.speed ?? 0) >= 4);
    if (filter === 'long-context') list = list.filter((m) => m.contextWindow >= 100_000);
    if (providerFilter !== 'all') list = list.filter((m) => m.providerId === providerFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((m) => m.displayName.toLowerCase().includes(q) || m.modelId.toLowerCase().includes(q));
    }
    return list;
  }, [models, filter, providerFilter, search]);

  const recommended = useMemo(
    () => [...models]
      .filter((m) => m.available)
      .sort((a, b) => b.fit - a.fit)
      .slice(0, 4),
    [models]
  );
  const topRecommended = recommended[0];

  return (
    <AppShell user={user} gradient="dashboard">
      <div className="p-6 lg:p-8 max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-bw-peach-light">AI Models</h1>
          <p className="text-sm text-bw-peach mt-1">
            Connect your AI providers and choose how BugWiser reasons about your code.
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-lg border border-error-container bg-error-container/20 text-sm text-error-default">
            {error}
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-16 text-bw-peach">
            <span className="w-5 h-5 border-2 border-primary-container/30 border-t-primary-container rounded-full animate-spin" />
            <span className="ml-3 text-sm">Loading providers and models...</span>
          </div>
        )}

        {!loading && !error && (
          <div className="space-y-10">
            {/* Connected providers */}
            <section>
              <SectionTitle>Connected Providers</SectionTitle>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {providers.map((p) => (
                  <ProviderCard
                    key={p.providerId}
                    provider={p}
                    onConnect={handleConnect}
                    onDisconnect={handleDisconnect}
                  />
                ))}
              </div>
            </section>

            {/* Recommended models */}
            <section>
              <SectionTitle
                subtitle="Recommended for BugWiser — strong coding, reasoning, large context, tool calling, and cost efficiency."
              >
                Recommended Models
              </SectionTitle>
              {topRecommended && (
                <div className="mb-3">
                  <ModelComparison
                    models={recommended}
                    selectedId={selectedModel}
                    mode={mode}
                  />
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mt-4">
                {recommended.map((m) => {
                  const provider = providers.find((p) => p.providerId === m.providerId);
                  return (
                    <ModelCard
                      key={`${m.providerId}/${m.modelId}`}
                      model={m}
                      providerName={provider?.displayName || m.providerId}
                      isSelected={mode === 'manual' && selectedModel === m.modelId && selectedProvider === m.providerId}
                      disabled={!m.available}
                      onSelect={() => {
                        setMode('manual');
                        setSelectedProvider(m.providerId);
                        setSelectedModel(m.modelId);
                      }}
                    />
                  );
                })}
              </div>
            </section>

            {/* All models */}
            <section>
              <SectionTitle>All Models</SectionTitle>
              <ModelControls
                providers={providers}
                filter={filter}
                onFilter={setFilter}
                search={search}
                onSearch={setSearch}
                providerFilter={providerFilter}
                onProviderFilter={setProviderFilter}
                compareIds={compareIds}
              />
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-4">
                {filteredModels.map((m) => {
                  const provider = providers.find((p) => p.providerId === m.providerId);
                  const isCompared = compareIds.includes(`${m.providerId}/${m.modelId}`);
                  return (
                    <ModelCard
                      key={`${m.providerId}/${m.modelId}`}
                      model={m}
                      providerName={provider?.displayName || m.providerId}
                      isSelected={mode === 'manual' && selectedModel === m.modelId && selectedProvider === m.providerId}
                      disabled={!m.available}
                      onSelect={() => {
                        if (!m.available) return;
                        setMode('manual');
                        setSelectedProvider(m.providerId);
                        setSelectedModel(m.modelId);
                      }}
                      compareChecked={isCompared}
                      onToggleCompare={() => setCompareIds((c) => toggleCompare(m, c))}
                    />
                  );
                })}
                {filteredModels.length === 0 && (
                  <div className="col-span-full text-sm text-bw-peach p-8 text-center border border-dashed border-outline rounded-lg">
                    No models match your filters.
                  </div>
                )}
              </div>
            </section>

            {/* Selected summary */}
            <section>
              <SelectedModelSummary
                mode={mode}
                onModeChange={setMode}
                providers={providers}
                models={models}
                selectedProvider={selectedProvider}
                setSelectedProvider={setSelectedProvider}
                selectedModel={selectedModel}
                setSelectedModel={setSelectedModel}
                preference={preference}
                onSave={handleSavePreference}
              />
            </section>

            {/* Security */}
            <section className="p-5 rounded-xl border border-outline-variant bg-bw-surface text-sm text-bw-peach">
              <p className="font-medium text-bw-peach-light mb-1">Security</p>
              <p>Your provider keys belong to you. BugWiser uses them only to make your requested AI calls.
                Keys are encrypted at rest and never exposed to your browser after entry.</p>
            </section>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function SectionTitle({ children, subtitle }: { children: React.ReactNode; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-lg font-semibold text-bw-peach-light">{children}</h2>
      {subtitle && <p className="text-sm text-bw-peach mt-1">{subtitle}</p>}
    </div>
  );
}

function toggleCompare(m: { providerId: string; modelId: string }, current: string[]): string[] {
  const id = `${m.providerId}/${m.modelId}`;
  if (current.includes(id)) return current.filter((c) => c !== id);
  return [...current, id].slice(-3);
}
