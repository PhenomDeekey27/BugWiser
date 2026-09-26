'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { CatalogModel } from '@/app/models/page';

interface ModelCardProps {
  model: CatalogModel;
  providerName: string;
  isSelected: boolean;
  disabled?: boolean;
  rank?: number;
  onSelect: () => void;
  compareChecked?: boolean;
  onToggleCompare?: () => void;
}

function formatPrice(v: number | null): string {
  if (v == null) return '—';
  if (v === 0) return '$0';
  if (v < 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(2)}`;
}

function formatContext(ctx: number): string {
  if (ctx >= 1_000_000) return `${(ctx / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (ctx >= 1_000) return `${Math.round(ctx / 1000)}K`;
  return `${ctx}`;
}

function badgeForTag(tag: string): { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' | 'ghost' } {
  switch (tag) {
    case 'recommended': return { label: 'Recommended', variant: 'default' };
    case 'best-coding': return { label: 'Best for Coding', variant: 'secondary' };
    case 'best-reasoning': return { label: 'Best for Reasoning', variant: 'secondary' };
    case 'best-value':
    case 'value': return { label: 'Best Value', variant: 'secondary' };
    case 'fast': return { label: 'Fast', variant: 'outline' };
    case 'long-context': return { label: 'Long Context', variant: 'outline' };
    case 'free': return { label: 'Free Tier', variant: 'outline' };
    case 'paid': return { label: 'Paid', variant: 'secondary' };
    case 'reasoning': return { label: 'Reasoning', variant: 'outline' };
    default: return { label: tag.replace(/-/g, ' '), variant: 'outline' };
  }
}

const CAPABILITY_ICONS: Record<string, string> = {
  coding: 'Coding',
  reasoning: 'Reasoning',
  fast: 'Fast',
  long_context: 'Long context',
  tool_calling: 'Tool calling',
  structured_output: 'Structured output',
};

function ValueIndicator({ model }: { model: CatalogModel }) {
  if (model.price.isFree) {
    return (
      <div className="flex items-center gap-1 text-xs">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400" />
        <span className="text-green-400 font-medium">Free</span>
      </div>
    );
  }
  if (model.price.input != null && model.price.input < 0.3) {
    return (
      <div className="flex items-center gap-1 text-xs">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-bw-terracotta" />
        <span className="text-bw-terracotta font-medium">Low cost</span>
      </div>
    );
  }
  if (model.price.input != null && model.price.input < 1) {
    return (
      <div className="flex items-center gap-1 text-xs">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-bw-peach" />
        <span className="text-bw-peach font-medium">Moderate</span>
      </div>
    );
  }
  return null;
}

export function ModelCard({
  model,
  providerName,
  isSelected,
  disabled,
  rank,
  onSelect,
  compareChecked,
  onToggleCompare,
}: ModelCardProps) {
  const tags = model.tags || [];

  return (
    <div
      className={`glass-card p-5 flex flex-col gap-3 transition-all ${
        isSelected ? 'ring-1 ring-primary/40' : ''
      } ${disabled ? 'opacity-55' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {rank != null && rank <= 3 && (
              <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${
                rank === 1 ? 'bg-bw-burgundy text-white' :
                rank === 2 ? 'bg-bw-terracotta text-white' :
                'bg-outline text-bw-peach-light'
              }`}>
                {rank}
              </span>
            )}
            <h3 className="font-medium text-bw-peach-light truncate">{model.displayName}</h3>
          </div>
          <p className="text-xs text-bw-peach font-mono truncate">{model.modelId}</p>
          <p className="text-xs text-bw-peach mt-0.5">{providerName}</p>
        </div>
        <ModelFitBadge fit={model.fit} />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {tags.slice(0, 4).map((tag, tagIdx) => {
          const b = badgeForTag(tag);
          return (
            <Badge key={`${tagIdx}-${tag}`} variant={b.variant}>
              {b.label}
            </Badge>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-bw-peach">
        <span className="font-mono">{formatContext(model.contextWindow)} context</span>
        {(model.capabilities || []).slice(0, 3).map((c) => CAPABILITY_ICONS[c] || c).filter(Boolean).map((c, capIdx) => (
          <span key={`${capIdx}-${c}`}>{c}</span>
        ))}
      </div>

      <div className="flex items-center gap-4 text-xs text-bw-peach">
        <span>
          Input: <span className="font-mono text-bw-peach-light">{formatPrice(model.price.input)}/1M</span>
        </span>
        <span>
          Output: <span className="font-mono text-bw-peach-light">{formatPrice(model.price.output)}/1M</span>
        </span>
        <ValueIndicator model={model} />
      </div>

      <div className="flex-1" />

      <div className="flex items-center justify-between gap-2">
        {onToggleCompare && (
          <Button variant="outline" size="sm" className="border-border text-bw-peach" onClick={onToggleCompare}>
            {compareChecked ? 'Compared' : 'Compare'}
          </Button>
        )}
        <Button
          size="sm"
          className="flex-1 btn-bw-primary font-medium"
          onClick={onSelect}
          disabled={disabled}
        >
          {isSelected ? 'Selected' : 'Select Model'}
        </Button>
      </div>
    </div>
  );
}

export function ModelFitBadge({ fit }: { fit: number }) {
  return (
    <div className="flex items-center gap-1.5" title={`BugWiser Fit: ${fit}/100`}>
      <span className="h-1.5 w-10 rounded-full bg-outline overflow-hidden">
        <span className={`block h-full ${fit >= 80 ? 'bg-bw-burgundy' : fit >= 60 ? 'bg-bw-terracotta' : 'bg-outline'}`} style={{ width: `${fit}%` }} />
      </span>
      <span className="text-xs font-mono text-bw-peach">{fit}</span>
    </div>
  );
}
