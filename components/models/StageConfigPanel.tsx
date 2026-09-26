'use client';

import { ScaleIcon, ZapIcon, GemIcon, RefreshCwIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SETUP_TITLES, type SetupChoice } from '@/lib/ai/catalog/stageSelection';

const SETUP_META: { id: SetupChoice; icon: typeof ZapIcon; description: string }[] = [
  { id: 'free', icon: ZapIcon, description: 'Use free models across the pipeline to minimize cost.' },
  { id: 'balanced', icon: ScaleIcon, description: 'Balance cost and model quality across the pipeline.' },
  { id: 'quality', icon: GemIcon, description: 'Prioritize higher-quality models when available.' },
];

interface StageConfigPanelProps {
  selected: SetupChoice | null;
  /** Setup currently being applied (shows pending state on its card). */
  pending: SetupChoice | null;
  /** True when no provider is connected yet — setups need an available catalog. */
  disabled?: boolean;
  onSelect: (setup: SetupChoice) => void;
}

export function StageConfigPanel({ selected, pending, disabled = false, onSelect }: StageConfigPanelProps) {
  return (
    <section>
<div className="flex items-center justify-between mb-2">
         <h2 className="text-xl lg:text-2xl font-semibold text-bw-peach-light">BugWiser Model Setup</h2>
        {selected && (
          <Badge variant="outline" className="text-xs text-bw-peach">
            {SETUP_TITLES[selected]} selected
          </Badge>
        )}
      </div>
      <p className="text-xs text-bw-peach/80 mb-4">
        A setup picks a suitable model for each of the five stages from your connected providers. You can still override
        individual stages below.
      </p>

               <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
         {SETUP_META.map((setup) => {
           const isSelected = selected === setup.id;
           const isPending = pending === setup.id;
           const Icon = setup.icon;
           return (
             <div
               key={setup.id}
               className={`p-4 sm:p-5 rounded-xl border border-border bg-surface flex flex-col transition-colors ${
                 isSelected ? 'border-primary-container/60' : 'hover:border-outline hover:bg-surface-dim'
               }`}
             >
               <div className="flex items-center justify-between">
                 <div className="flex items-center gap-2">
                   <Icon className="h-4 w-4 text-bw-peach/80 shrink-0" aria-hidden="true" />
                   <h3 className="text-sm sm:text-base font-semibold text-bw-peach-light">{SETUP_TITLES[setup.id]}</h3>
                 </div>
                 {isSelected && <Badge className="text-[10px] sm:text-xs text-green-500 bg-green-500/10 border-green-500">Selected</Badge>}
               </div>
               <p className="text-xs sm:text-sm text-bw-peach mt-2 flex-1">{setup.description}</p>
              <Button
                size="sm"
                variant={isSelected ? 'default' : 'outline'}
                className="mt-4"
                disabled={disabled || (pending !== null && !isPending)}
                onClick={() => onSelect(setup.id)}
              >
                {isPending ? (
                  <>
                    <RefreshCwIcon className="mr-2 h-3.5 w-3.5 animate-spin" /> Applying...
                  </>
                ) : isSelected ? (
                  'Selected'
                ) : (
                  `Select ${SETUP_TITLES[setup.id]}`
                )}
              </Button>
            </div>
          );
        })}
      </div>

      {disabled && (
        <p className="text-xs text-bw-peach/70 mt-3">Connect at least one provider to enable a setup.</p>
      )}
    </section>
  );
}
