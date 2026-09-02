'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';

export interface ModelOption {
  id: string;
  name: string;
  contextLength: number;
  maxOutput: number;
  inputPrice: string;
  outputPrice: string;
  isFree: boolean;
  modality: string;
}

export interface ModelTierConfig {
  fast: string;
  balanced: string;
  deep: string;
}

interface ModelSelectorProps {
  value: ModelTierConfig;
  onChange: (config: ModelTierConfig) => void;
}

function autoSelectFreeModels(models: ModelOption[]): ModelTierConfig {
  const freeModels = models.filter((m) => m.isFree);

  const pickBest = (preferred: string[]) => {
    for (const id of preferred) {
      if (freeModels.some((m) => m.id === id)) return id;
    }
    return freeModels[0]?.id || '';
  };

  return {
    fast: pickBest([
      'nvidia/nemotron-3.5-30b-a3b:free',
      'meta-llama/llama-3.2-3b-instruct:free',
      'qwen/qwen-2.5-7b-instruct:free',
    ]),
    balanced: pickBest([
      'nvidia/nemotron-3.5-30b-a3b:free',
      'meta-llama/llama-3.2-3b-instruct:free',
      'qwen/qwen-2.5-14b-instruct:free',
    ]),
    deep: pickBest([
      'nvidia/nemotron-3.5-30b-a3b:free',
      'meta-llama/llama-3.1-8b-instruct:free',
      'qwen/qwen-2.5-72b-instruct:free',
    ]),
  };
}

function formatContext(tokens: number): string {
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(0)}K`;
  return tokens.toString();
}

const TIER_META: Record<string, { label: string; description: string; color: string }> = {
  fast: {
    label: 'Fast',
    description: 'Classification, ranking, quick analysis',
    color: 'text-green-400',
  },
  balanced: {
    label: 'Balanced',
    description: 'Analysis, summarization, reasoning',
    color: 'text-blue-400',
  },
  deep: {
    label: 'Deep',
    description: 'Code generation, complex reasoning',
    color: 'text-purple-400',
  },
};

export function ModelSelector({ value, onChange }: ModelSelectorProps) {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchModels = async () => {
      try {
        const res = await fetch('/api/ai/models');
        if (!res.ok) throw new Error('Failed to load models');
        const data = await res.json();
        setModels(data.models || []);

        if (!value.fast && !value.balanced && !value.deep) {
          const defaults = autoSelectFreeModels(data.models || []);
          onChange(defaults);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load models');
      } finally {
        setLoading(false);
      }
    };
    fetchModels();
  }, []);

  const updateTier = (tier: keyof ModelTierConfig, modelId: string) => {
    onChange({ ...value, [tier]: modelId });
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 rounded-lg bg-bw-surface animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 rounded-lg bg-error-container/10 border border-error-default/30">
        <p className="text-sm text-error-default">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {(['fast', 'balanced', 'deep'] as const).map((tier) => {
        const meta = TIER_META[tier];
        return (
          <div
            key={tier}
            className="p-3 rounded-lg bg-bw-surface border border-border"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className={`text-xs font-mono font-bold uppercase tracking-wider ${meta.color}`}>
                  {meta.label}
                </span>
                <span className="text-xs text-bw-peach">{meta.description}</span>
              </div>
              {models.find((m) => m.id === value[tier])?.isFree && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  FREE
                </Badge>
              )}
            </div>
            <select
              value={value[tier]}
              onChange={(e) => updateTier(tier, e.target.value)}
              className="w-full bg-surface-dim border border-border rounded px-3 py-2 text-sm font-mono text-bw-peach-light focus:outline-none focus:border-primary-container/50 focus:shadow-[0_0_12px_rgba(255,86,37,0.1)] appearance-none cursor-pointer"
            >
              <option value="">Select model...</option>
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name} — {formatContext(model.contextLength)} ctx
                  {model.isFree ? ' (Free)' : ''}
                </option>
              ))}
            </select>
            {value[tier] && (() => {
              const selected = models.find((m) => m.id === value[tier]);
              if (!selected) return null;
              return (
                <div className="mt-2 flex items-center gap-3 text-[10px] font-mono text-bw-peach/60">
                  <span>Context: {formatContext(selected.contextLength)}</span>
                  <span>Output: {formatContext(selected.maxOutput)}</span>
                  <span>Input: ${selected.inputPrice}/1K</span>
                  <span>Output: ${selected.outputPrice}/1K</span>
                </div>
              );
            })()}
          </div>
        );
      })}
    </div>
  );
}
