'use client';

import { ModelFitBadge } from './ModelCard';
import { cn } from '@/lib/utils';
import type { CatalogModel } from '@/app/models/page';

interface ModelComparisonProps {
  models: CatalogModel[];
  selectedId: string;
  mode: 'auto' | 'manual';
}

function formatPrice(v: number | null): string {
  if (v == null) return '—';
  if (v === 0) return '$0';
  if (v < 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(2)}`;
}

export function ModelComparison({ models, selectedId, mode }: ModelComparisonProps) {
  const shown = models.slice(0, 4);
  if (shown.length === 0) return null;

  return (
    <div className="overflow-x-auto pb-2">
      <table className="w-full min-w-[640px] text-sm border-collapse">
        <thead>
          <tr>
            <th className="text-left text-xs font-medium text-bw-peach p-2">Model</th>
            {shown.map((m) => (
              <th key={`${m.providerId}/${m.modelId}`} className="text-left p-2">
                <div className={cn('rounded-lg border p-2', mode === 'manual' && selectedId === m.modelId ? 'border-primary bg-primary/5' : 'border-outline-variant bg-bw-surface')}>
                  <div className="font-medium text-bw-peach-light truncate">{m.displayName}</div>
                  <div className="text-xs font-mono text-bw-peach truncate">{m.modelId}</div>
                  {mode === 'manual' && selectedId === m.modelId && (
                    <div className="text-xs text-primary-default mt-1 font-medium">Selected</div>
                  )}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <Row label="BugWiser Fit">
            {shown.map((m) => <td key={m.modelId} className="p-2"><ModelFitBadge fit={m.fit} /></td>)}
          </Row>
          <Row label="Context">
            {shown.map((m) => <td key={m.modelId} className="p-2 font-mono text-bw-peach">{formatContext(m.contextWindow)}</td>)}
          </Row>
          <Row label="Pricing (in / out)">
            {shown.map((m) => (
              <td key={m.modelId} className="p-2 font-mono text-bw-peach">
                {formatPrice(m.price.input)} / {formatPrice(m.price.output)}
              </td>
            ))}
          </Row>
          <Row label="Reasoning">
            {shown.map((m) => <td key={m.modelId} className="p-2 text-bw-peach">{m.supportsReasoning ? 'Yes' : 'No'}</td>)}
          </Row>
          <Row label="Tool calling">
            {shown.map((m) => <td key={m.modelId} className="p-2 text-bw-peach">{m.supportsToolCalling ? 'Yes' : 'No'}</td>)}
          </Row>
        </tbody>
      </table>
      <p className="text-xs text-bw-peach mt-2 font-mono">
        Labeled “BugWiser Fit” — a BugWiser recommendation, not an industry benchmark.
      </p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr className="border-t border-outline-variant">
      <td className="p-2 text-xs font-medium text-bw-peach whitespace-nowrap">{label}</td>
      {children}
    </tr>
  );
}

function formatContext(ctx: number): string {
  if (ctx >= 1_000_000) return `${(ctx / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (ctx >= 1_000) return `${Math.round(ctx / 1000)}K`;
  return `${ctx}`;
}