'use client';

import { useState } from 'react';
import { ProviderCard } from './ProviderCard';
import { ModelCard } from './ModelCard';
import { toast } from 'sonner';
import type { CatalogModel, CatalogProvider } from '@/app/models/page';

type FilterKey = 'all' | 'free' | 'paid' | 'free-paid' | 'best-coding' | 'best-reasoning' | 'fast' | 'long-context' | 'best-value';

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: 'All Models' },
  { key: 'free', label: 'Free Models' },
  { key: 'paid', label: 'Paid Models' },
  { key: 'free-paid', label: 'Free + Paid Alternatives' },
  { key: 'best-coding', label: 'Best for Coding' },
  { key: 'best-reasoning', label: 'Best for Reasoning' },
  { key: 'fast', label: 'Fastest' },
  { key: 'long-context', label: 'Long Context' },
  { key: 'best-value', label: 'Best Value' },
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
}: {
  providers: CatalogProvider[];
  filter: FilterKey;
  onFilter: (f: FilterKey) => void;
  search: string;
  onSearch: (s: string) => void;
  providerFilter: string;
  onProviderFilter: (f: string) => void;
  compareIds: string[];
}) {
  const [selectedFilter, setSelectedFilter] = useState(filter);

  const providersWithProviderId = providers.map((p) => ({ ...p, providerId: p.providerId }));

  const handleConnect = async (providerId: string, apiKey: string) => {
    try {
      const res = await fetch('/api/models/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: providerId, apiKey }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to connect');
      toast.success(`${providerId} connected.`);
    } catch (e) {
      const err = e as Error;
      toast.error(err.message || 'Connection failed');
    }
  };

  const handleDisconnect = async (providerId: string) => {
    try {
      const res = await fetch(`/api/models/connections/${providerId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to disconnect');
      toast.success(`${providerId} disconnected.`);
    } catch (e) {
      const err = e as Error;
      toast.error(err.message || 'Disconnect failed');
    }
  };

  return (
    <div className="rounded-xl border border-outline bg-bw-surface p-6">
      <div className="flex flex-wrap gap-2 mb-4">
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => { onFilter(key); setSelectedFilter(key); }}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border ${
              selectedFilter === key
                ? 'border-primary-container bg-primary-container/10 text-primary-container'
                : 'border-outline text-bw-peach hover:border-primary-container hover:text-primary-container'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search models..."
          className="flex-1 px-3 py-1.5 rounded-lg border border-outline bg-bw-surface text-sm text-bw-peach placeholder:text-bw-peach/50 focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container"
        />
        <button
          onClick={() => { onSearch(''); setSelectedFilter('all'); }}
          className="px-3 py-1.5 rounded-lg border border-outline bg-bw-surface text-sm text-bw-peach hover:border-primary-container hover:text-primary-container"
        >
          Clear
        </button>
      </div>

      <div className="flex gap-2 mb-4">
        <select
          value={providerFilter}
          onChange={(e) => { onProviderFilter(e.target.value as string); setSelectedFilter('all'); }}
          className="px-3 py-1.5 rounded-lg border border-outline bg-bw-surface text-sm text-bw-peach focus:outline-none focus:border-primary-container"
        >
          <option value="all">All Providers</option>
          {providers.map((p) => (
            <option key={p.providerId} value={p.providerId}>
              {p.displayName}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <label className="text-sm text-bw-peach">
          Compare models:
          <span className="ml-1 font-medium">
            {compareIds.length === 0
              ? '(none selected)'
              : `${compareIds.length} selected`
          }</span>
        </label>
        {compareIds.length > 0 && (
          <button
            onClick={() => {
              onFilter('all');
              setSelectedFilter('all');
            }}
            className="ml-2 px-2 py-1 rounded border border-outline text-xs text-bw-peach bg-bw-surface hover:bg-outline/10"
          >
            Clear comparison
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {providersWithProviderId.map((p) => (
          <ProviderCard
            key={p.providerId}
            provider={p}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
          />
        ))}
      </div>
    </div>
  );
}
