import { createBackgroundClient } from '@/lib/supabase/background';
import { generate } from '@/lib/ai/gateway';
import { buildRootCauseContext, RootCauseContext } from '@/lib/ai/context/root-cause';
import { validateRootCause, parseRootCauseResponse } from '@/lib/ai/validation/root-cause';
import { buildCanonicalContext, estimateContextSize, selectSourceFilesForStage } from '@/lib/ai/context/canonical';
import { recordModelExecution, logStageStart, logStageResult } from '@/lib/ai/model-execution-tracker';

async function updateAnalysis(
  analysisId: string,
  updates: {
    status?: string;
    current_stage?: string;
    error_message?: string;
    ai_provider?: string;
    ai_model?: string;
    ai_duration_ms?: number;
    ai_tokens_input?: number;
    ai_tokens_output?: number;
  }
) {
  const supabase = createBackgroundClient();
  const { error } = await supabase.from('analyses').update(updates).eq('id', analysisId);
  if (error) {
    console.error('[root-cause] Failed to update analysis:', error.message);
  }
}

async function storeArtifact(
  analysisId: string,
  artifactType: string,
  data: Record<string, unknown>
) {
  const supabase = createBackgroundClient();
  const { error } = await supabase.from('analysis_artifacts').insert({
    analysis_id: analysisId,
    artifact_type: artifactType,
    data,
  });
  if (error) {
    console.error('[root-cause] Failed to store artifact:', artifactType, error.message);
  }
}

async function deleteArtifactsByType(analysisId: string, artifactTypes: string[]) {
  const supabase = createBackgroundClient();
  const { error } = await supabase
    .from('analysis_artifacts')
    .delete()
    .eq('analysis_id', analysisId)
    .in('artifact_type', artifactTypes);
  if (error) {
    console.error('[root-cause] Failed to delete downstream artifacts:', error.message);
  }
}

export async function runRootCauseAnalysis(analysisId: string): Promise<void> {
  console.log(`[root-cause] Starting root cause analysis for ${analysisId}`);

  try {
    const supabase = createBackgroundClient();

    const { data: analysis, error: fetchError } = await supabase
      .from('analyses')
      .select('*')
      .eq('id', analysisId)
      .single();

    if (fetchError || !analysis) {
      console.error('[root-cause] Analysis not found:', fetchError?.message);
      throw new Error('Analysis not found in database');
    }

    console.log(`[root-cause] Current status: ${analysis.status}, stage: ${analysis.current_stage}`);

    await deleteArtifactsByType(analysisId, ['root_cause', 'evidence', 'solution', 'patch']);

    await updateAnalysis(analysisId, {
      status: 'analyzing',
      current_stage: 'root_cause_analysis',
      error_message: undefined,
    });

    const context = await buildCanonicalContext(analysisId);
    const sizeInfo = estimateContextSize(context);
    const selectedSourceFiles = selectSourceFilesForStage(context, 'root_cause', 15, 60000);

    logStageStart('root-cause', analysisId, selectedSourceFiles.length, sizeInfo.sourceFilesChars, sizeInfo.estimatedTokens);

    if (context.sourceFiles.length === 0) {
      console.error('[root-cause] No source files available. Cannot perform root cause analysis.');
      await updateAnalysis(analysisId, {
        status: 'failed',
        error_message: 'No source files available for root cause analysis. Ensure relevant file discovery fetched source code.',
      });
      return;
    }

    if (context.relevantFiles.length === 0) {
      console.error('[root-cause] No relevant files identified. Cannot perform root cause analysis.');
      await updateAnalysis(analysisId, {
        status: 'failed',
        error_message: 'No relevant files identified. Retry relevant file discovery with broader criteria.',
      });
      return;
    }

    const rootCauseContext: RootCauseContext = {
      issue: context.issue,
      comments: context.comments,
      fingerprint: context.fingerprint,
      relevantFiles: context.relevantFiles,
      sourceFiles: selectedSourceFiles,
    };

    const builtContext = buildRootCauseContext(rootCauseContext);
    console.log(`[root-cause] Context built: ${builtContext.estimatedTokens} estimated tokens`);

    let lastError: Error | null = null;
    let attemptNumber = 0;

    const startTime = Date.now();
    let response;
    try {
      response = await generate({
        analysisId,
        task: 'root_cause_analysis',
        messages: builtContext.messages,
        temperature: 0.3,
        maxTokens: 4096,
        responseFormat: { type: 'json_object' },
      });
      attemptNumber = response.fallbackCount + 1;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      attemptNumber = 1;

      await recordModelExecution({
        analysisId,
        stage: 'root_cause_analysis',
        provider: 'unknown',
        model: 'unknown',
        attemptNumber,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        success: false,
        error: lastError.message.slice(0, 500),
        inputTokens: null,
        outputTokens: null,
        fallbackCount: 0,
        contextChars: sizeInfo.totalChars,
        estimatedTokens: sizeInfo.estimatedTokens,
      });

      throw lastError;
    }

    const duration = Date.now() - startTime;

    logStageResult('root-cause', analysisId, response.provider, response.model, attemptNumber, true, duration);

    await recordModelExecution({
      analysisId,
      stage: 'root_cause_analysis',
      provider: response.provider,
      model: response.model,
      attemptNumber,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: duration,
      success: true,
      error: null,
      inputTokens: response.usage?.inputTokens || null,
      outputTokens: response.usage?.outputTokens || null,
      fallbackCount: response.fallbackCount,
      contextChars: sizeInfo.totalChars,
      estimatedTokens: sizeInfo.estimatedTokens,
    });

    const parsedResult = parseRootCauseResponse(response.content);
    console.log(`[root-cause] Parsed root cause: confidence ${parsedResult.rootCause.confidence}, affected files: ${parsedResult.affectedFiles.length}`);

    const validationResult = validateRootCause(parsedResult);
    if (!validationResult.valid) {
      console.error('[root-cause] Validation failed:', validationResult.error);

      await recordModelExecution({
        analysisId,
        stage: 'root_cause_analysis',
        provider: response.provider,
        model: response.model,
        attemptNumber: attemptNumber + 1,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 0,
        success: false,
        error: validationResult.error || 'Validation failed',
        inputTokens: null,
        outputTokens: null,
        fallbackCount: 0,
        contextChars: sizeInfo.totalChars,
        estimatedTokens: sizeInfo.estimatedTokens,
      });

      await updateAnalysis(analysisId, {
        status: 'failed',
        error_message: validationResult.error || 'Root cause validation failed',
      });
      return;
    }

    await storeArtifact(analysisId, 'root_cause', {
      ...parsedResult,
      provider: response.provider,
      model: response.model,
      duration,
      usage: response.usage,
      attemptNumber,
      sourceFileCount: selectedSourceFiles.length,
      sourceChars: sizeInfo.sourceFilesChars,
      selection: {
        mode: response.selection?.mode || 'auto',
        reason: response.selection?.reason || '',
        manualFallbackOccurred: response.manualFallbackOccurred || false,
      },
    } as unknown as Record<string, unknown>);

    await updateAnalysis(analysisId, {
      status: 'root_cause_complete',
      current_stage: 'root_cause_analysis',
      ai_provider: response.provider,
      ai_model: response.model,
      ai_duration_ms: duration,
      ai_tokens_input: response.usage?.inputTokens || 0,
      ai_tokens_output: response.usage?.outputTokens || 0,
    });

    console.log(`[root-cause] Root cause analysis complete for ${analysisId}`);

  } catch (error) {
    const err = error as Error;
    console.error(`[root-cause] Analysis failed for ${analysisId}:`, err.message);

    await updateAnalysis(analysisId, {
      status: 'failed',
      error_message: err.message.slice(0, 1000),
    });
  }
}
