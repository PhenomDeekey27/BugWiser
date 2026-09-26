'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Zap, Shield, Rocket, Sparkles, Clock, DollarSign, AlertCircle } from 'lucide-react';

interface ModelStrategy {
  tier: 'free' | 'balanced' | 'fast' | 'auto';
  label: string;
  provider: string;
  model: string;
  isFree: boolean;
  costLevel: 'free' | 'low' | 'medium' | 'high';
  speed: 'slow' | 'moderate' | 'fast';
  reason: string;
  contextWindow: number;
  perStage?: Array<{
    stage: string;
    provider: string;
    model: string;
    reason: string;
  }>;
}

interface PreflightResult {
  strategies: ModelStrategy[];
  recommended: string;
  availableProviders: string[];
  hasPaidProviders: boolean;
  hasFreeProviders: boolean;
}

interface ModelPreflightProps {
  onSelect: (strategy: ModelStrategy) => void;
  onCancel: () => void;
}

const TIER_ICONS = {
  free: Shield,
  balanced: Zap,
  fast: Rocket,
  auto: Sparkles,
};

const COST_LABELS = {
  free: 'Free',
  low: 'Low cost',
  medium: 'Medium cost',
  high: 'Higher cost',
};

const SPEED_LABELS = {
  slow: 'Slower',
  moderate: 'Moderate',
  fast: 'Fast',
};

export function ModelPreflight({ onSelect, onCancel }: ModelPreflightProps) {
  const [strategies, setStrategies] = useState<ModelStrategy[]>([]);
  const [selected, setSelected] = useState<string>('auto');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAutoDetails, setShowAutoDetails] = useState(false);

  useEffect(() => {
    async function fetchPreflight() {
      try {
        const res = await fetch('/api/analysis/preflight', { method: 'POST' });
        if (!res.ok) throw new Error('Failed to load model recommendations');
        const data: PreflightResult = await res.json();
        setStrategies(data.strategies);
        setSelected(data.recommended);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load models');
      } finally {
        setLoading(false);
      }
    }
    fetchPreflight();
  }, []);

  const handleConfirm = () => {
    const strategy = strategies.find((s) => s.tier === selected);
    if (strategy) onSelect(strategy);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="animate-pulse text-gray-500 dark:text-gray-400 text-sm font-mono">
          Analyzing optimal models for your analysis...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-4 p-8">
        <AlertCircle className="w-8 h-8 text-red-500" />
        <p className="text-sm text-gray-600 dark:text-gray-400">{error}</p>
        <Button variant="outline" onClick={onCancel} className="border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300">
          Continue with defaults
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Choose Your Model Strategy
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto">
          BugWiser uses AI across 5 analysis stages. Select how models are chosen for each stage.
        </p>
      </div>

      <div className="grid gap-3">
        {strategies.map((strategy) => {
          const Icon = TIER_ICONS[strategy.tier];
          const isSelected = selected === strategy.tier;
          const isRecommended = strategy.tier === 'auto';

          return (
            <button
              key={strategy.tier}
              onClick={() => setSelected(strategy.tier)}
              className={`w-full text-left p-4 rounded-lg border transition-all cursor-pointer ${
                isSelected
                  ? 'border-orange-400 dark:border-orange-500/50 bg-orange-50 dark:bg-orange-500/10 ring-1 ring-orange-400/30 dark:ring-orange-500/20'
                  : 'border-gray-200 dark:border-gray-700/50 bg-white dark:bg-gray-800/50 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 p-1.5 rounded-md ${
                  isSelected
                    ? 'bg-orange-100 dark:bg-orange-500/15'
                    : 'bg-gray-100 dark:bg-gray-700/50'
                }`}>
                  <Icon className={`w-4 h-4 ${
                    isSelected
                      ? 'text-orange-600 dark:text-orange-400'
                      : 'text-gray-400 dark:text-gray-500'
                  }`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-sm font-semibold ${
                      isSelected
                        ? 'text-gray-900 dark:text-gray-100'
                        : 'text-gray-800 dark:text-gray-200'
                    }`}>
                      {strategy.label}
                    </span>
                    {isRecommended && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-orange-100 dark:bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-500/25">
                        RECOMMENDED
                      </Badge>
                    )}
                    {strategy.isFree && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400 border-green-200 dark:border-green-500/25">
                        FREE
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mb-1.5 font-mono min-w-0">
                    {strategy.tier === 'auto' && strategy.perStage ? (
                      <span className="truncate">{[...new Set(strategy.perStage.map((s) => s.provider))].join(' + ')} — {strategy.perStage.length} stages, {[...new Set(strategy.perStage.map((s) => `${s.provider}/${s.model}`))].length} models</span>
                    ) : (
                      <>
                        <span className="shrink-0">{strategy.provider}</span>
                        <span className="text-gray-300 dark:text-gray-600 shrink-0">/</span>
                        <span className="truncate">{strategy.model}</span>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                    <span className="flex items-center gap-1">
                      <DollarSign className="w-3 h-3" />
                      {COST_LABELS[strategy.costLevel]}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {SPEED_LABELS[strategy.speed]}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5 break-words">{strategy.reason}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {selected === 'auto' && (() => {
        const autoStrategy = strategies.find((s) => s.tier === 'auto');
        if (!autoStrategy?.perStage) return null;
        return (
          <div className="rounded-lg border border-gray-200 dark:border-gray-700/50 bg-white dark:bg-gray-800/50 overflow-hidden">
            <button
              onClick={() => setShowAutoDetails(!showAutoDetails)}
              className="w-full flex items-center justify-between p-3 text-left cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
                Per-stage model assignments
              </span>
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {showAutoDetails ? 'Hide' : 'Show'}
              </span>
            </button>
            {showAutoDetails && (
              <div className="border-t border-gray-100 dark:border-gray-700/50 px-3 pb-3">
                {autoStrategy.perStage.map((ps, i) => (
                  <div key={i} className="flex items-center gap-2 py-1.5 border-b border-gray-50 dark:border-gray-700/30 last:border-0">
                    <span className="text-[10px] font-mono text-gray-400 dark:text-gray-500 w-28 shrink-0">
                      {ps.stage}
                    </span>
                    <span className="text-[11px] font-mono text-gray-600 dark:text-gray-300 truncate">
                      {ps.provider}/{ps.model}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {selected === 'free' && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 dark:bg-green-500/5 border border-green-200 dark:border-green-500/10">
          <Shield className="w-4 h-4 text-green-600 dark:text-green-400 shrink-0" />
          <p className="text-xs text-green-700 dark:text-green-400">
            Free model selected — results may take longer.
          </p>
        </div>
      )}

      <div className="flex flex-col-reverse sm:flex-row gap-3 sm:justify-end">
        <Button
          variant="outline"
          onClick={onCancel}
          className="border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          Cancel
        </Button>
        <Button
          onClick={handleConfirm}
          className="btn-bw-primary px-6"
        >
          Start Analysis
        </Button>
      </div>
    </div>
  );
}
