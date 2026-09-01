import { AnalysisStageInfo } from '@/types';
import { cn } from '@/lib/utils';

interface AnalysisStepperProps {
  stages: AnalysisStageInfo[];
  onStageClick?: (stage: AnalysisStageInfo) => void;
}

export function AnalysisStepper({ stages, onStageClick }: AnalysisStepperProps) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-mono font-bold uppercase tracking-wider text-bw-peach mb-3 px-3">
        Pipeline
      </p>
      {stages.map((stage, index) => {
        const isLast = index === stages.length - 1;
        const isClickable = stage.status === 'completed' && onStageClick;

        return (
          <div key={stage.stage} className="relative">
            <button
              onClick={isClickable ? () => onStageClick(stage) : undefined}
              disabled={!isClickable}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded text-sm transition-all duration-300 w-full text-left',
                stage.status === 'completed' && 'text-bw-peach-light',
                stage.status === 'completed' && isClickable && 'cursor-pointer hover:bg-bw-burgundy/20 hover:border-l-2 hover:border-primary-container/50',
                stage.status === 'running' && 'text-primary-container bg-primary-container/8 border-l-2 border-primary-container',
                stage.status === 'pending' && 'text-bw-peach/50',
                stage.status === 'failed' && 'text-error-default',
                stage.status === 'no_evidence' && 'text-yellow-400'
              )}
            >
              <span className="w-4 flex-shrink-0 text-center">
                {stage.status === 'completed' && (
                  <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-green-500/20">
                    <span className="text-green-400 text-xs">✓</span>
                  </span>
                )}
                {stage.status === 'running' && (
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary-container/40" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-primary-container" />
                  </span>
                )}
                {stage.status === 'pending' && (
                  <span className="inline-flex items-center justify-center w-4 h-4">
                    <span className="text-bw-peach/50 text-xs">○</span>
                  </span>
                )}
                {stage.status === 'failed' && (
                  <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-error-container/20">
                    <span className="text-error-default text-xs">✕</span>
                  </span>
                )}
                {stage.status === 'no_evidence' && (
                  <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-yellow-500/20">
                    <span className="text-yellow-400 text-xs">⚠</span>
                  </span>
                )}
              </span>
              <div className="flex-1 min-w-0">
                <span className={cn(
                  'font-mono text-xs truncate block',
                  stage.status === 'running' && 'font-semibold'
                )}>
                  {stage.label}
                </span>
                {stage.stageDetail && (
                  <span className="text-[10px] font-mono text-bw-peach/60 truncate block mt-0.5">
                    {stage.stageDetail}
                  </span>
                )}
              </div>
              {isClickable && (
                <span className="text-[10px] font-mono text-primary-container/50 opacity-0 group-hover:opacity-100 transition-opacity">
                  view
                </span>
              )}
            </button>
            {!isLast && (
              <div className={cn(
                'absolute left-[21px] top-[30px] w-px h-1',
                stage.status === 'completed' ? 'bg-green-500/30' : 'bg-bw-burgundy/20'
              )} />
            )}
          </div>
        );
      })}
    </div>
  );
}
