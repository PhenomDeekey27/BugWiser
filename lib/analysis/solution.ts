import { createBackgroundClient } from '@/lib/supabase/background';
import { runWithFallback } from '@/lib/ai/model-router';
import { generate } from '@/lib/ai/gateway';
import { buildSolutionContext, SolutionContext } from '@/lib/ai/context/solution';
import { validateSolution, parseSolutionResponse } from '@/lib/ai/validation/solution';
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
    console.error('[solution] Failed to update analysis:', error.message);
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
    console.error('[solution] Failed to store artifact:', artifactType, error.message);
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
    console.error('[solution] Failed to delete downstream artifacts:', error.message);
  }
}

export async function runSolutionGeneration(analysisId: string): Promise<void> {
  console.log(`[solution] Starting solution generation for ${analysisId}`);

  try {
    const supabase = createBackgroundClient();

    const { data: analysis, error: fetchError } = await supabase
      .from('analyses')
      .select('*')
      .eq('id', analysisId)
      .single();

    if (fetchError || !analysis) {
      console.error('[solution] Analysis not found:', fetchError?.message);
      throw new Error('Analysis not found in database');
    }

    console.log(`[solution] Current status: ${analysis.status}, stage: ${analysis.current_stage}`);

    await deleteArtifactsByType(analysisId, ['solution', 'patch']);

    await updateAnalysis(analysisId, {
      status: 'analyzing',
      current_stage: 'solution_generation',
      error_message: undefined,
    });

    const context = await buildCanonicalContext(analysisId);
    const sizeInfo = estimateContextSize(context);
    const selectedSourceFiles = selectSourceFilesForStage(context, 'solution', 10, 30000);

    logStageStart('solution', analysisId, selectedSourceFiles.length, sizeInfo.sourceFilesChars, sizeInfo.estimatedTokens);

    if (context.sourceFiles.length === 0) {
      console.error('[solution] No source files available. Cannot generate solution.');
      await updateAnalysis(analysisId, {
        status: 'failed',
        error_message: 'No source files available for solution generation.',
      });
      return;
    }

    if (!context.rootCause) {
      console.error('[solution] No root cause artifact found. Cannot generate solution.');
      await updateAnalysis(analysisId, {
        status: 'failed',
        error_message: 'Root cause analysis must complete before solution generation.',
      });
      return;
    }

    if (context.evidence && context.evidence.status !== 'evidence_found') {
      console.log(`[solution] Evidence status is "${context.evidence.status}". Proceeding with reduced confidence.`);
    }

    const solutionContext: SolutionContext = {
      issue: context.issue,
      comments: context.comments,
      fingerprint: context.fingerprint,
      relevantFiles: context.relevantFiles,
      sourceFiles: selectedSourceFiles,
      rootCause: context.rootCause,
      evidence: context.evidence,
    };

    const builtContext = buildSolutionContext(solutionContext);
    console.log(`[solution] Context built: ${builtContext.estimatedTokens} estimated tokens`);

    let attemptNumber = 0;
    const startTime = Date.now();
    let response;
    try {
      response = await generate({
        analysisId,
        task: 'solution_generation',
        messages: builtContext.messages,
        temperature: 0.3,
        maxTokens: 4096,
        responseFormat: { type: 'json_object' },
      });
      attemptNumber = response.fallbackCount + 1;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      attemptNumber = 1;

      await recordModelExecution({
        analysisId,
        stage: 'solution_generation',
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

    logStageResult('solution', analysisId, response.provider, response.model, attemptNumber, true, duration);

    await recordModelExecution({
      analysisId,
      stage: 'solution_generation',
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

    const parsedResult = parseSolutionResponse(response.content);
    console.log(`[solution] Parsed solution: confidence ${parsedResult.confidence}, ${parsedResult.affectedFiles.length} affected files`);

    const validationResult = validateSolution(parsedResult);
    if (!validationResult.valid) {
      console.error('[solution] Validation failed:', validationResult.error);
      await updateAnalysis(analysisId, {
        status: 'failed',
        error_message: validationResult.error || 'Solution validation failed',
      });
      return;
    }

    await storeArtifact(analysisId, 'solution', {
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
      status: 'solution_complete',
      current_stage: 'solution_generation',
      ai_provider: response.provider,
      ai_model: response.model,
      ai_duration_ms: duration,
      ai_tokens_input: response.usage?.inputTokens || 0,
      ai_tokens_output: response.usage?.outputTokens || 0,
    });

    console.log(`[solution] Solution generation complete for ${analysisId}`);

  } catch (error) {
    const err = error as Error;
    console.error(`[solution] Generation failed for ${analysisId}:`, err.message);

    await updateAnalysis(analysisId, {
      status: 'failed',
      error_message: err.message.slice(0, 1000),
    });
  }
}
