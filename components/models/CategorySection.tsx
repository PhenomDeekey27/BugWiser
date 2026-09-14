'use client';

import { useState, useMemo } from 'react';
import { ModelCard } from './ModelCard';
import type { CatalogModel, CatalogProvider } from '@/app/models/page';

interface CategorySectionProps {
  title: string;
  subtitle: string;
  models: CatalogModel[];
  providers: CatalogProvider[];
  selectedModel: string;
  selectedProvider: string;
  mode: 'auto' | 'manual';
  search?: string;
  onSelect: (model: CatalogModel) => void;
}

export function CategorySection({
  title,
  subtitle,
  models,
  providers,
  selectedModel,
  selectedProvider,
  mode,
  search = '',
  onSelect,
}: CategorySectionProps) {
  if (models.length === 0) return null;

  const [expanded, setExpanded] = useState(false);

  const filtered = useMemo(
    () => {
      if (!search.trim()) return models;
      const q = search.toLowerCase();
      return models.filter(
        (m) => m.displayName.toLowerCase().includes(q) || m.modelId.toLowerCase().includes(q)
      );
    },
    [models, search]
  );

  const displayModels = expanded ? filtered : filtered.slice(0, 4);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-bw-peach-light">{title}</h2>
          <p className="text-sm text-bw-peach mt-1">{subtitle}</p>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="p-1.5 rounded-full hover:bg-primary-container/10 text-bw-peach transition-colors"
        >
          {expanded ? '↕' : '↓'}
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {displayModels.map((m, idx) => {
          const provider = providers.find((p) => p.providerId === m.providerId);
          return (
            <ModelCard
              key={`${m.providerId}/${m.modelId}`}
              model={m}
              providerName={provider?.displayName || m.providerId}
              isSelected={mode === 'manual' && selectedModel === m.modelId && selectedProvider === m.providerId}
              disabled={!m.available}
              rank={idx + 1}
              onSelect={() => onSelect(m)}
            />
          );
        })}
      </div>
    </div>
  );
}