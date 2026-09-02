'use client';

import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { ModelFitBadge } from './ModelCard';
import { cn } from '@/lib/utils';
import type { CatalogModel, CatalogProvider, Preference } from '@/app/models/page';

interface SelectedModelSummaryProps {
  mode: 'auto' | 'manual';
  onModeChange: (m: 'auto' | 'manual') => void;
  providers: CatalogProvider[];
  models: CatalogModel[];
  selectedProvider: string;
  setSelectedProvider: (p: string) => void;
  selectedModel: string;
  setSelectedModel: (m: string) => void;
  preference: Preference | null;
  onSave: () => void;
  onStart?: () => void;
  starting?: boolean;
  available?: boolean;
}

function formatPrice(v: number | null): string {
  if (v == null) return '—';
  if (v === 0) return '$0';
  return `$${v.toFixed(2)}`;
}

export function SelectedModelSummary({
  mode,
  onModeChange,
  providers,
  models,
  selectedProvider,
  setSelectedProvider,
  selectedModel,
  setSelectedModel,
  preference,
  onSave,
  onStart,
  starting,
}: SelectedModelSummaryProps) {
  const providerModels = useMemo(
    () => models.filter((m) => m.providerId === selectedProvider && m.available),
    [models, selectedProvider]
  );

  const selected = useMemo(
    () => models.find((m) => m.providerId === selectedProvider && m.modelId === selectedModel) || null,
    [models, selectedProvider, selectedModel]
  );

  const selectedProviderName = providers.find((p) => p.providerId === selectedProvider)?.displayName || selectedProvider;

  const modeSavedMatches =
    preference &&
    ((mode === 'auto' && preference.selection_mode === 'auto') ||
      (mode === 'manual' && preference.selection_mode === 'manual' && preference.provider === selectedProvider && preference.model === selectedModel));

  return (
    <div className="glass-card p-5">
      <h2 className="text-lg font-semibold text-bw-peach-light">Model Selection</h2>
      <p className="text-sm text-bw-peach mt-1 mb-4">
        Choose how BugWiser picks the model for your analysis.
      </p>

      {/* Mode toggle */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
        <ModeOption
          active={mode === 'auto'}
          title="Auto"
          subtitle="BugWiser chooses the best model for each stage"
          onClick={() => onModeChange('auto')}
        />
        <ModeOption
          active={mode === 'manual'}
          title="Manual"
          subtitle="Use the selected model for all AI stages"
          onClick={() => onModeChange('manual')}
        />
      </div>

      {mode === 'manual' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
          <div>
            <label className="text-xs font-medium text-bw-peach mb-1 block">Provider</label>
            <select
              value={selectedProvider}
              onChange={(e) => {
                setSelectedProvider(e.target.value);
                setSelectedModel('');
              }}
              className="h-9 w-full rounded-lg border border-input bg-bw-surface px-2 text-sm text-bw-peach-light outline-none focus:border-ring"
            >
              <option value="" disabled>Select a provider</option>
              {providers.filter((p) => p.status === 'connected').map((p) => (
                <option key={p.providerId} value={p.providerId}>{p.displayName}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-bw-peach mb-1 block">Model</label>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              disabled={!selectedProvider}
              className="h-9 w-full rounded-lg border border-input bg-bw-surface px-2 text-sm text-bw-peach-light outline-none focus:border-ring disabled:opacity-50"
            >
              <option value="" disabled>Select a model</option>
              {providerModels.map((m) => (
                <option key={`${m.providerId}/${m.modelId}`} value={m.modelId}>{m.displayName}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {selected && (
        <div className="mb-5 p-4 rounded-lg border border-outline-variant bg-bw-surface">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="font-medium text-bw-peach-light">
                {selectedPowerDescription(selected)}
              </p>
              <p className="text-xs font-mono text-bw-peach mt-0.5">{selectedProviderName} · {selected.modelId}</p>
            </div>
            <ModelFitBadge fit={selected.fit} />
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-bw-peach mt-3">
            <span className="font-mono">{formatContext(selected.contextWindow)} context</span>
            <span>Capabilities: {(selected.capabilities || []).map(capLabel).join(' · ')}</span>
            <span>BugWiser Fit: {selected.fit}</span>
          </div>
          <div className="flex flex-wrap gap-4 text-xs text-bw-peach mt-2">
            <span>Input: <span className="font-mono text-bw-peach-light">{formatPrice(selected.price.input)}/1M</span></span>
            <span>Output: <span className="font-mono text-bw-peach-light">{formatPrice(selected.price.output)}/1M</span></span>
            <span className="text-muted-foreground">Estimated cost depends on actual token usage</span>
          </div>
        </div>
      )}

      {mode === 'manual' && !selected && (
        <div className="mb-5 p-4 rounded-lg border border-outline-variant bg-bw-surface text-sm text-bw-peach">
          Select a connected provider and model above. BugWiser will use this exact model for all AI stages; it won&apos;t silently switch models.
        </div>
      )}

      {mode === 'manual' && selectedProvider && !providerModels.some((m) => m.available) && (
        <div className="mb-5 p-4 rounded-lg border border-error-container bg-error-container/20 text-sm text-error-default">
          No connected models are available for {selectedProviderName}. Connect the provider or pick another.
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <Button className="btn-bw-primary font-medium" onClick={onSave} disabled={starting}>
          {modeSavedMatches ? 'Update Selection' : 'Save Selection'}
        </Button>
        {onStart && (
          <Button className="btn-bw-primary font-medium" onClick={onStart} disabled={starting || (mode === 'manual' && !selected)}>
            {starting ? 'Starting...' : 'Start Analysis'}
          </Button>
        )}
        {preference && (
          <span className="text-xs text-bw-peach">
            Saved mode: {preference.selection_mode === 'manual'
              ? `manual · ${preference.provider} / ${preference.model}`
              : 'auto'}
          </span>
        )}
      </div>

      {/* Explanation of manual fallback */}
      <div className="mt-4 text-xs text-bw-peach leading-relaxed border-t border-outline-variant pt-3">
        <p className="font-medium text-bw-peach-light mb-1">How selection works</p>
        <p>In <b>Auto</b> mode BugWiser scores every connected model per stage and picks the best fit, falling back to the next-ranked model on recoverable failures.</p>
        <p className="mt-1">In <b>Manual</b> mode the selected model runs every AI stage. If it hits a recoverable failure (rate limit, timeout, context too large, temporary outage), BugWiser may use a fallback model and will tell you it did.</p>
      </div>
    </div>
  );
}

function capLabel(cap: string): string {
  const map: Record<string, string> = {
    coding: 'Coding',
    reasoning: 'Reasoning',
    fast: 'Fast',
    long_context: 'Long context',
    tool_calling: 'Tools',
    structured_output: 'Structured output',
    vision: 'Vision',
  };
  return map[cap] || cap;
}

function formatContext(ctx: number): string {
  if (ctx >= 1_000_000) return `${(ctx / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (ctx >= 1_000) return `${Math.round(ctx / 1000)}K`;
  return `${ctx}`;
}

function selectedPowerDescription(m: CatalogModel): string {
  const tags = m.tags || [];
  if (tags.includes('recommended')) return `${m.displayName} — Recommended for BugWiser`;
  return m.displayName;
}

function ModeOption({ active, title, subtitle, onClick }: { active: boolean; title: string; subtitle: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'text-left p-3 rounded-lg border transition-all cursor-pointer',
        active
          ? 'border-primary bg-primary/5'
          : 'border-outline-variant hover:border-outline bg-bw-surface'
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cn('w-3 h-3 rounded-full border', active ? 'border-primary' : 'border-outline')}>
          {active && <span className="block w-1.5 h-1.5 m-auto mt-[2px] rounded-full bg-primary" />}
        </span>
        <span className="font-medium text-bw-peach-light">{title}</span>
      </div>
      <p className="text-xs text-bw-peach mt-1">{subtitle}</p>
    </button>
  );
}