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
        <div className="animate-pulse text-bw-dusty-rose text-sm font-mono">
          Analyzing optimal models for your analysis...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-4 p-8">
        <AlertCircle className="w-8 h-8 text-error-default" />
        <p className="text-sm text-bw-dusty-rose">{error}</p>
        <Button variant="outline" onClick={onCancel} className="border-border text-bw-peach">
          Continue with defaults
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h3 className="text-lg font-semibold text-bw-peach-light">
          Choose Your Model Strategy
        </h3>
        <p className="text-sm text-bw-dusty-rose max-w-md mx-auto">
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
                  ? 'border-primary-default/40 bg-primary-default/5 ring-1 ring-primary-default/20'
                  : 'border-border bg-bw-surface hover:border-border hover:bg-surface-dim'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 p-1.5 rounded-md ${isSelected ? 'bg-primary-default/10' : 'bg-surface-dim'}`}>
                  <Icon className={`w-4 h-4 ${isSelected ? 'text-primary-default' : 'text-bw-dusty-rose'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-sm font-semibold ${isSelected ? 'text-bw-peach-light' : 'text-bw-peach-light'}`}>
                      {strategy.label}
                    </span>
                    {isRecommended && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-primary-default/10 text-primary-default border-primary-default/20">
                        RECOMMENDED
                      </Badge>
                    )}
                    {strategy.isFree && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-green-500/10 text-green-500 border-green-500/20">
                        FREE
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-bw-dusty-rose mb-1.5 font-mono">
                    <span>{strategy.provider}</span>
                    <span className="text-border">/</span>
                    <span className="truncate">{strategy.model}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-bw-dusty-rose">
                    <span className="flex items-center gap-1">
                      <DollarSign className="w-3 h-3" />
                      {COST_LABELS[strategy.costLevel]}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {SPEED_LABELS[strategy.speed]}
                    </span>
                  </div>
                  <p className="text-xs text-bw-dusty-rose/70 mt-1.5">{strategy.reason}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {selected === 'free' && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/5 border border-green-500/10">
          <Shield className="w-4 h-4 text-green-500 shrink-0" />
          <p className="text-xs text-green-500/80">
            Free model selected — results may take longer.
          </p>
        </div>
      )}

      <div className="flex gap-3 justify-end">
        <Button
          variant="outline"
          onClick={onCancel}
          className="border-border text-bw-peach hover:bg-surface-dim"
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
