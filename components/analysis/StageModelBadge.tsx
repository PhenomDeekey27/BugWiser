'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, Cpu, Zap, Shield, Rocket } from 'lucide-react';

interface StageModelInfo {
  task: string;
  provider: string;
  model: string;
  tier: 'free' | 'balanced' | 'fast' | 'auto';
  isFree: boolean;
}

interface StageModelBadgeProps {
  currentModel: StageModelInfo | null;
  isAiStage: boolean;
  stageStatus: 'pending' | 'active' | 'completed' | 'failed';
}

const TIER_ICONS = {
  free: Shield,
  balanced: Zap,
  fast: Rocket,
  auto: Cpu,
};

const TIER_COLORS = {
  free: 'text-green-500',
  balanced: 'text-blue-400',
  fast: 'text-amber-400',
  auto: 'text-primary-default',
};

export function StageModelBadge({ currentModel, isAiStage, stageStatus }: StageModelBadgeProps) {
  if (!isAiStage || !currentModel) return null;

  const Icon = TIER_ICONS[currentModel.tier] ?? Cpu;

  return (
    <div className="flex items-center gap-1.5">
      <Icon className={`w-3 h-3 ${TIER_COLORS[currentModel.tier]}`} />
      <span className="text-[10px] font-mono text-bw-dusty-rose truncate max-w-[120px]">
        {currentModel.provider}/{currentModel.model.split('/').pop()}
      </span>
      {currentModel.isFree && (
        <Badge variant="secondary" className="text-[8px] px-1 py-0 bg-green-500/10 text-green-500 border-green-500/20">
          FREE
        </Badge>
      )}
    </div>
  );
}
