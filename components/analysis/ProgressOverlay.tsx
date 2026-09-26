'use client';

import { AnalysisRecord } from '@/types';

interface ProgressOverlayProps {
  record: AnalysisRecord;
}

const STAGE_LABELS: Record<string, string> = {
  issue_context: 'Fetching Issue Context',
  issue_comments: 'Fetching Comments',
  repository_tree: 'Fetching Repository Tree',
  file_filtering: 'Filtering Files',
  repository_fingerprint: 'Building Fingerprint',
  ready: 'Ready',
  relevant_files_discovery: 'AI Discovering Files',
  relevant_files_fetch: 'Fetching Source Files',
  relevant_files_complete: 'Files Ready',
  root_cause_analysis: 'Analyzing Root Cause',
  evidence_extraction: 'Extracting Evidence',
  solution_generation: 'Generating Solution',
  patch_generation: 'Generating Patch',
  completed: 'Completed',
};

const STAGE_SUB_LABELS: Record<string, string[]> = {
  issue_context: ['Connecting to GitHub API', 'Loading issue details', 'Parsing labels and metadata'],
  issue_comments: ['Loading discussion thread', 'Analyzing comment history'],
  repository_tree: ['Fetching file tree from GitHub', 'Scanning repository structure'],
  file_filtering: ['Analyzing file types', 'Detecting languages', 'Classifying files'],
  repository_fingerprint: ['Detecting framework', 'Identifying package manager', 'Mapping source directories'],
  relevant_files_discovery: ['Building context for AI', 'Calling model for analysis', 'Parsing AI response', 'Validating results'],
  relevant_files_fetch: ['Downloading source code from GitHub', 'Processing file contents'],
  root_cause_analysis: ['Building analysis context', 'Calling AI model', 'Parsing root cause', 'Validating results'],
  evidence_extraction: ['Building evidence context', 'Calling AI model', 'Extracting evidence references', 'Validating results'],
  solution_generation: ['Building solution context', 'Calling AI model', 'Generating fix strategy', 'Validating results'],
  patch_generation: ['Building patch context', 'Calling AI model', 'Generating code diffs', 'Validating results'],
};

const STAGE_ORDER = [
  'issue_context',
  'issue_comments',
  'repository_tree',
  'file_filtering',
  'repository_fingerprint',
  'ready',
  'relevant_files_discovery',
  'relevant_files_fetch',
  'relevant_files_complete',
  'root_cause_analysis',
  'evidence_extraction',
  'solution_generation',
  'patch_generation',
  'completed',
];

// Maps current_stage -> model_selection.stages key for active-model display.
const AI_STAGE_KEYS: Record<string, string> = {
  relevant_files_discovery: 'relevant_file_discovery',
  root_cause_analysis: 'root_cause_analysis',
  evidence_extraction: 'evidence_extraction',
  solution_generation: 'solution_generation',
  patch_generation: 'patch_generation',
};

export function ProgressOverlay({ record }: ProgressOverlayProps) {
  const currentLabel = STAGE_LABELS[record.current_stage] || record.current_stage;
  const subLabels = STAGE_SUB_LABELS[record.current_stage] || [];
  const stageIdx = STAGE_ORDER.indexOf(record.current_stage);
  const progress = Math.round(((stageIdx + 1) / STAGE_ORDER.length) * 100);

  const isActive = ['queued', 'initializing', 'indexing', 'relevant_file_discovery', 'relevant_files_fetch', 'analyzing', 'relevant_files_discovery'].includes(record.status);
  const isFailed = record.status === 'failed';

  // Derive the active model for the current AI stage.
  const aiStageLabel = AI_STAGE_KEYS[record.current_stage];
  const stageAssignment = aiStageLabel ? record.model_selection?.stages?.[aiStageLabel] : null;
  const activeModel = stageAssignment && stageAssignment.model
    ? `${record.model_selection?.mode === 'manual' ? '' : ''}${stageAssignment.provider} · ${stageAssignment.model}`
    : record.ai_model
      ? `${record.ai_provider || ''} · ${record.ai_model}`
      : null;
  const selectionMode = record.model_selection?.mode || null;
  const manualFallback = record.model_selection?.manualFallbackOccurred || false;

  const statusMessages: Record<string, string> = {
    queued: 'Queued — waiting to start',
    initializing: 'Initializing investigation...',
    indexing: 'Indexing repository...',
    ready_for_analysis: 'Repository index ready',
    relevant_file_discovery: 'Discovering relevant files...',
    relevant_files_ready: 'Relevant files ready',
    analyzing: 'AI analysis in progress...',
    root_cause_complete: 'Root cause analysis complete',
    evidence_complete: 'Evidence extraction complete',
    solution_complete: 'Solution generation complete',
    failed: 'Analysis failed',
    completed: 'Analysis complete',
  };

  return (
    <div className="flex flex-col items-center justify-center py-16">
      <div className="w-full max-w-md bg-surface rounded-xl border border-border p-8 card-depth-lg">
        <div className="flex items-center gap-3 mb-6">
          {isActive && (
            <div className="w-5 h-5 border-2 border-primary-container/30 border-t-primary-container rounded-full animate-spin" />
          )}
          {!isActive && !isFailed && (
            <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
              <span className="text-white text-xs">✓</span>
            </div>
          )}
          {isFailed && (
            <div className="w-5 h-5 rounded-full bg-error-container flex items-center justify-center">
              <span className="text-white text-xs">✕</span>
            </div>
          )}
          <h3 className="text-lg font-semibold text-bw-peach-light">
            {statusMessages[record.status] || 'Processing...'}
          </h3>
        </div>

        {isActive && (
          <>
            <div className="mb-4">
              <div className="flex justify-between text-xs font-mono text-bw-peach mb-2">
                <span>{currentLabel}</span>
                <span>{progress}%</span>
              </div>
              <div className="w-full h-2 bg-surface-dim rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-bw-wine to-bw-terracotta rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            {subLabels.length > 0 && (
              <div className="mb-4 p-3 rounded-lg bg-surface border border-border">
                <div className="space-y-1">
                  {subLabels.map((label, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-[11px] font-mono text-bw-peach/70">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary-container/50 animate-pulse" style={{ animationDelay: `${idx * 300}ms` }} />
                      <span>{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {aiStageLabel && (
              <div className="mb-4 p-3 rounded-lg border border-primary-container/30 bg-primary-container/5">
                <div className="flex items-center gap-2 text-xs font-mono text-bw-peach-light">
                  <span>Using: {activeModel || 'selecting model…'}</span>
                </div>
                <div className="mt-1 text-[11px] font-mono text-bw-peach">
                  {selectionMode === 'manual' ? (
                    manualFallback ? 'Manual mode — fell back after a recoverable failure.' : 'Manual mode — your selected model is running.'
                  ) : (
                    'Auto mode — BugWiser picked the best model for this stage.'
                  )}
                </div>
              </div>
            )}

            <div className="space-y-1">
              {STAGE_ORDER.map((stage, idx) => {
                const isCompleted = idx < stageIdx;
                const isCurrent = idx === stageIdx;
                const isPending = idx > stageIdx;
                return (
                  <div
                    key={stage}
                    className={`flex items-center gap-2 text-xs font-mono py-1 transition-colors duration-300 ${
                      isCompleted ? 'text-green-400' : isCurrent ? 'text-primary-container' : 'text-bw-peach/50'
                    }`}
                  >
                    <span className="w-3 text-center">
                      {isCompleted && <span>✓</span>}
                      {isCurrent && <span className="w-1.5 h-1.5 rounded-full bg-primary-container animate-pulse inline-block" />}
                      {isPending && <span className="w-1.5 h-1.5 rounded-full bg-bw-burgundy/30 inline-block" />}
                    </span>
                    <span>{STAGE_LABELS[stage]}</span>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {!isActive && !isFailed && (
          <div className="space-y-3">
            <p className="text-sm text-bw-peach">
              {record.status === 'relevant_files_ready' ? 'Relevant files discovered successfully.' : 
               record.status === 'root_cause_complete' ? 'Root cause analysis complete.' :
               record.status === 'evidence_complete' ? 'Evidence extraction complete.' :
               record.status === 'solution_complete' ? 'Solution generation complete.' :
               record.status === 'completed' ? 'Analysis complete.' :
               'Repository indexed successfully.'}
            </p>
            {record.fingerprint && (
              <div className="space-y-2 text-xs font-mono">
                {record.fingerprint.primaryLanguage && (
                  <div className="flex justify-between">
                    <span className="text-bw-peach">Language</span>
                    <span className="text-bw-peach-light">{record.fingerprint.primaryLanguage}</span>
                  </div>
                )}
                {record.fingerprint.framework && (
                  <div className="flex justify-between">
                    <span className="text-bw-peach">Framework</span>
                    <span className="text-bw-peach-light">{record.fingerprint.framework}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-bw-peach">Active Files</span>
                  <span className="text-bw-peach-light">{record.filtered_files.toLocaleString()}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {isFailed && record.error_message && (
          <div className="mt-3 p-3 rounded-lg bg-error-container/10 border border-error-default/30">
            <p className="text-xs text-error-default font-mono">{record.error_message}</p>
          </div>
        )}
      </div>
    </div>
  );
}
