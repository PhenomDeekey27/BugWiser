'use client';

import { cn } from '@/lib/utils';
import type { CatalogProvider } from '@/app/models/page';

type FilterKey = 'all' | 'free' | 'paid' | 'best-coding' | 'best-reasoning' | 'fast' | 'long-context';

interface ModelControlsProps {
  providers: CatalogProvider[];
  filter: FilterKey;
  onFilter: (f: FilterKey) => void;
  search: string;
  onSearch: (v: string) => void;
  providerFilter: string;
  onProviderFilter: (v: string) => void;
  compareIds: string[];
}

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'free', label: 'Free' },
  { key: 'paid', label: 'Paid' },
  { key: 'best-coding', label: 'Best Coding' },
  { key: 'best-reasoning', label: 'Best Reasoning' },
  { key: 'fast', label: 'Fast' },
  { key: 'long-context', label: 'Long Context' },
];

export function ModelControls({
  providers,
  filter,
  onFilter,
  search,
  onSearch,
  providerFilter,
  onProviderFilter,
  compareIds,
}: ModelControlsProps) {
  return (
    <div className="flex flex-col lg:flex-row gap-3 flex-wrap">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => onFilter(f.key)}
            className={cn(
              'px-3 py-1.5 text-xs rounded-full border transition-all cursor-pointer',
              filter === f.key
                ? 'border-primary bg-primary/10 text-primary-default font-medium'
                : 'border-outline-variant text-bw-peach hover:border-outline'
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={providerFilter}
          onChange={(e) => onProviderFilter(e.target.value)}
          className="h-8 rounded-lg border border-input bg-bw-surface px-2 text-sm text-bw-peach-light outline-none focus:border-ring"
          aria-label="Filter by provider"
        >
          <option value="all">All providers</option>
          {providers.map((p) => (
            <option key={p.providerId} value={p.providerId}>{p.displayName}</option>
          ))}
        </select>

        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search models..."
          className="h-8 w-48 rounded-lg border border-input bg-bw-surface px-2.5 text-sm text-bw-peach-light outline-none placeholder:text-muted-foreground focus:border-ring"
          aria-label="Search models"
        />

        {compareIds.length > 0 && (
          <span className="text-xs font-mono text-bw-peach">{compareIds.length} compared</span>
        )}
      </div>
    </div>
  );
}