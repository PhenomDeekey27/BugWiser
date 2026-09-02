'use client';

import { cn } from '@/lib/utils';

interface ModelTierBadgeProps {
  tier: 'fast' | 'balanced' | 'deep';
  status?: 'active' | 'pending' | 'completed' | 'error';
  provider?: string;
  model?: string;
  showDetails?: boolean;
  className?: string;
}

const tierConfig = {
  fast: {
    label: 'Fast',
    icon: '⚡',
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-400/10',
    borderColor: 'border-yellow-400/30',
    glowColor: 'shadow-[0_0_12px_rgba(250,204,21,0.15)]',
    description: 'Classification & ranking',
  },
  balanced: {
    label: 'Balanced',
    icon: '◎',
    color: 'text-blue-400',
    bgColor: 'bg-blue-400/10',
    borderColor: 'border-blue-400/30',
    glowColor: 'shadow-[0_0_12px_rgba(96,165,250,0.15)]',
    description: 'Analysis & reasoning',
  },
  deep: {
    label: 'Deep',
    icon: '◆',
    color: 'text-purple-400',
    bgColor: 'bg-purple-400/10',
    borderColor: 'border-purple-400/30',
    glowColor: 'shadow-[0_0_12px_rgba(192,132,252,0.15)]',
    description: 'Complex generation',
  },
};

const statusConfig = {
  active: {
    label: 'Processing',
    dotColor: 'bg-green-400',
    animate: true,
  },
  pending: {
    label: 'Queued',
    dotColor: 'bg-surface-bright/50',
    animate: false,
  },
  completed: {
    label: 'Done',
    dotColor: 'bg-green-400',
    animate: false,
  },
  error: {
    label: 'Failed',
    dotColor: 'bg-red-400',
    animate: false,
  },
};

export function ModelTierBadge({
  tier,
  status = 'pending',
  provider,
  model,
  showDetails = false,
  className,
}: ModelTierBadgeProps) {
  const config = tierConfig[tier];
  const statusInfo = statusConfig[status];

  return (
    <div
      className={cn(
        'relative rounded-lg border p-3 transition-all duration-300',
        config.bgColor,
        config.borderColor,
        status === 'active' && config.glowColor,
        className
      )}
    >
      {status === 'active' && (
        <div className="absolute inset-0 rounded-lg overflow-hidden pointer-events-none">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent animate-[shimmer_2s_infinite]" />
        </div>
      )}

      <div className="relative flex items-center gap-2 mb-1">
        <span className={cn('text-sm', config.color)}>{config.icon}</span>
        <span className={cn('text-xs font-mono font-bold uppercase tracking-wider', config.color)}>
          {config.label}
        </span>
        <div className="flex items-center gap-1 ml-auto">
          <span
            className={cn(
              'w-1.5 h-1.5 rounded-full',
              statusInfo.dotColor,
              statusInfo.animate && 'animate-pulse'
            )}
          />
          <span className="text-[10px] font-mono text-bw-peach">
            {statusInfo.label}
          </span>
        </div>
      </div>

      {showDetails && (
        <div className="relative mt-2 space-y-1">
          <p className="text-[10px] font-mono text-bw-peach">
            {config.description}
          </p>
          {provider && (
            <p className="text-[10px] font-mono text-bw-peach">
              Provider: <span className="text-bw-peach-light">{provider}</span>
            </p>
          )}
          {model && (
            <p className="text-[10px] font-mono text-bw-peach">
              Model: <span className="text-bw-peach-light">{model}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

interface ModelTierPipelineProps {
  activeModel?: string | null;
  fallbackChain?: string[];
  currentModel?: string;
  provider?: string;
  className?: string;
}

export function ModelTierPipeline({
  activeModel,
  fallbackChain = [],
  currentModel,
  provider,
  className,
}: ModelTierPipelineProps) {
  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-mono font-bold uppercase tracking-wider text-bw-peach">
          AI Pipeline
        </span>
        {provider && (
          <span className="text-[10px] font-mono text-bw-peach/60">
            via {provider}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {fallbackChain.map((model, idx) => {
          const isCurrent = model === currentModel;
          const isUsed = currentModel ? fallbackChain.indexOf(currentModel) >= idx : false;
          const isFailed = currentModel ? fallbackChain.indexOf(currentModel) >= 0 && idx > fallbackChain.indexOf(currentModel) : false;

          return (
            <div
              key={model}
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-mono transition-all duration-300',
                isCurrent && 'bg-green-500/10 border-green-500/30 text-green-400 shadow-[0_0_12px_rgba(34,197,94,0.15)]',
                isUsed && !isCurrent && 'bg-green-500/5 border-green-500/20 text-green-400/50',
                isFailed && 'bg-red-500/5 border-red-500/20 text-red-400/50 line-through',
                !isCurrent && !isUsed && !isFailed && 'bg-bw-surface border-border text-bw-peach/60'
              )}
            >
              <span className={cn(
                'w-1.5 h-1.5 rounded-full',
                isCurrent && 'bg-green-400 animate-pulse',
                isUsed && !isCurrent && 'bg-green-400/50',
                isFailed && 'bg-red-400/50',
                !isCurrent && !isUsed && !isFailed && 'bg-surface-bright/30'
              )} />
              <span className="truncate max-w-[200px]">{model}</span>
              {isCurrent && (
                <span className="text-[10px] text-green-400">active</span>
              )}
              {isFailed && (
                <span className="text-[10px] text-red-400">failed</span>
              )}
            </div>
          );
        })}
      </div>

      {activeModel && (
        <p className="text-[10px] font-mono text-bw-peach mt-2">
          Using: <span className="text-bw-peach-light">{activeModel}</span>
        </p>
      )}
    </div>
  );
}
