import { createBackgroundClient } from '@/lib/supabase/background';
import { runWithFallback } from '@/lib/ai/model-router';
import { generate } from '@/lib/ai/gateway';
import { buildPatchContext, PatchContext } from '@/lib/ai/context/patch';
import { validatePatch, parsePatchResponse } from '@/lib/ai/validation/patch';
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
    console.error('[patch] Failed to update analysis:', error.message);
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
    console.error('[patch] Failed to store artifact:', artifactType, error.message);
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
    console.error('[patch] Failed to delete downstream artifacts:', error.message);
  }
}

export async function runPatchGeneration(analysisId: string): Promise<void> {
  console.log(`[patch] Starting patch generation for ${analysisId}`);

  try {
    const supabase = createBackgroundClient();

    const { data: analysis, error: fetchError } = await supabase
      .from('analyses')
      .select('*')
      .eq('id', analysisId)
      .single();

    if (fetchError || !analysis) {
      console.error('[patch] Analysis not found:', fetchError?.message);
      throw new Error('Analysis not found in database');
    }

    console.log(`[patch] Current status: ${analysis.status}, stage: ${analysis.current_stage}`);

    await deleteArtifactsByType(analysisId, ['patch']);

    await updateAnalysis(analysisId, {
      status: 'analyzing',
      current_stage: 'patch_generation',
      error_message: undefined,
    });

    const context = await buildCanonicalContext(analysisId);
    const sizeInfo = estimateContextSize(context);
    const selectedSourceFiles = selectSourceFilesForStage(context, 'patch', 10, 40000);

    logStageStart('patch', analysisId, selectedSourceFiles.length, sizeInfo.sourceFilesChars, sizeInfo.estimatedTokens);

    if (context.sourceFiles.length === 0) {
      console.error('[patch] No source files available. Cannot generate patch.');
      await updateAnalysis(analysisId, {
        status: 'failed',
        error_message: 'No source files available for patch generation.',
      });
      return;
    }

    if (!context.rootCause) {
      console.error('[patch] No root cause artifact found. Cannot generate patch.');
      await updateAnalysis(analysisId, {
        status: 'failed',
        error_message: 'Root cause analysis must complete before patch generation.',
      });
      return;
    }

    if (!context.solution) {
      console.error('[patch] No solution artifact found. Cannot generate patch.');
      await updateAnalysis(analysisId, {
        status: 'failed',
        error_message: 'Solution generation must complete before patch generation.',
      });
      return;
    }

    const patchContext: PatchContext = {
      issue: context.issue,
      comments: context.comments,
      fingerprint: context.fingerprint,
      relevantFiles: context.relevantFiles,
      sourceFiles: selectedSourceFiles,
      rootCause: context.rootCause,
      evidence: context.evidence,
      solution: context.solution,
    };

    const builtContext = buildPatchContext(patchContext);
    console.log(`[patch] Context built: ${builtContext.estimatedTokens} estimated tokens`);

    let attemptNumber = 0;
    const startTime = Date.now();
    let response;
    try {
      response = await generate({
        analysisId,
        task: 'patch_generation',
        messages: builtContext.messages,
        temperature: 0.3,
        maxTokens: 8192,
        responseFormat: { type: 'json_object' },
      });
      attemptNumber = response.fallbackCount + 1;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      attemptNumber = 1;

      await recordModelExecution({
        analysisId,
        stage: 'patch_generation',
        provider: 'unknown',
        model: 'unknown',
        attemptNumber,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        success: false,
        error: error.message.slice(0, 500),
        inputTokens: null,
        outputTokens: null,
        fallbackCount: 0,
        contextChars: sizeInfo.totalChars,
        estimatedTokens: sizeInfo.estimatedTokens,
      });

      throw error;
    }

    const duration = Date.now() - startTime;

    logStageResult('patch', analysisId, response.provider, response.model, attemptNumber, true, duration);

    await recordModelExecution({
      analysisId,
      stage: 'patch_generation',
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

    const parsedResult = parsePatchResponse(response.content);
    console.log(`[patch] Parsed patch: ${parsedResult.files.length} files`);

    const validationResult = validatePatch(parsedResult);
    if (!validationResult.valid) {
      console.error('[patch] Validation failed:', validationResult.error);
      await updateAnalysis(analysisId, {
        status: 'failed',
        error_message: validationResult.error || 'Patch validation failed',
      });
      return;
    }

    await storeArtifact(analysisId, 'patch', {
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
      status: 'completed',
      current_stage: 'completed',
      ai_provider: response.provider,
      ai_model: response.model,
      ai_duration_ms: duration,
      ai_tokens_input: response.usage?.inputTokens || 0,
      ai_tokens_output: response.usage?.outputTokens || 0,
    });

    console.log(`[patch] Patch generation complete for ${analysisId}`);

  } catch (error) {
    const err = error as Error;
    console.error(`[patch] Generation failed for ${analysisId}:`, err.message);

    await updateAnalysis(analysisId, {
      status: 'failed',
      error_message: err.message.slice(0, 1000),
    });
  }
}
