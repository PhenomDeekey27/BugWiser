import { createBackgroundClient } from '@/lib/supabase/background';
import { runWithFallback } from '@/lib/ai/model-router';
import { generate } from '@/lib/ai/gateway';
import { buildEvidenceContext, EvidenceContext } from '@/lib/ai/context/evidence';
import { validateEvidence, parseEvidenceResponse } from '@/lib/ai/validation/evidence';
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
    console.error('[evidence] Failed to update analysis:', error.message);
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
    console.error('[evidence] Failed to store artifact:', artifactType, error.message);
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
    console.error('[evidence] Failed to delete downstream artifacts:', error.message);
  }
}

export async function runEvidenceExtraction(analysisId: string): Promise<void> {
  console.log(`[evidence] Starting evidence extraction for ${analysisId}`);

  try {
    const supabase = createBackgroundClient();

    const { data: analysis, error: fetchError } = await supabase
      .from('analyses')
      .select('*')
      .eq('id', analysisId)
      .single();

    if (fetchError || !analysis) {
      console.error('[evidence] Analysis not found:', fetchError?.message);
      throw new Error('Analysis not found in database');
    }

    console.log(`[evidence] Current status: ${analysis.status}, stage: ${analysis.current_stage}`);

    await deleteArtifactsByType(analysisId, ['evidence', 'solution', 'patch']);

    await updateAnalysis(analysisId, {
      status: 'analyzing',
      current_stage: 'evidence_extraction',
      error_message: undefined,
    });

    const context = await buildCanonicalContext(analysisId);
    const sizeInfo = estimateContextSize(context);
    const selectedSourceFiles = selectSourceFilesForStage(context, 'evidence', 12, 40000);

    logStageStart('evidence', analysisId, selectedSourceFiles.length, sizeInfo.sourceFilesChars, sizeInfo.estimatedTokens);

    if (context.sourceFiles.length === 0) {
      console.error('[evidence] No source files available. Cannot extract evidence.');
      await updateAnalysis(analysisId, {
        status: 'failed',
        error_message: 'No source files available for evidence extraction.',
      });
      return;
    }

    if (!context.rootCause) {
      console.error('[evidence] No root cause artifact found. Cannot extract evidence.');
      await updateAnalysis(analysisId, {
        status: 'failed',
        error_message: 'Root cause analysis must complete before evidence extraction.',
      });
      return;
    }

    const evidenceContext: EvidenceContext = {
      issue: context.issue,
      comments: context.comments,
      fingerprint: context.fingerprint,
      relevantFiles: context.relevantFiles,
      sourceFiles: selectedSourceFiles,
      rootCause: context.rootCause,
    };

    const builtContext = buildEvidenceContext(evidenceContext);
    console.log(`[evidence] Context built: ${builtContext.estimatedTokens} estimated tokens`);

    let attemptNumber = 0;
    const startTime = Date.now();
    let response;
    try {
      response = await generate({
        analysisId,
        task: 'evidence_extraction',
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
        stage: 'evidence_extraction',
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

    logStageResult('evidence', analysisId, response.provider, response.model, attemptNumber, true, duration);

    await recordModelExecution({
      analysisId,
      stage: 'evidence_extraction',
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

    const parsedResult = parseEvidenceResponse(response.content);
    console.log(`[evidence] Parsed evidence: status=${parsedResult.status}, ${parsedResult.evidence.length} references`);

    const validationResult = validateEvidence(parsedResult);
    if (!validationResult.valid) {
      console.error('[evidence] Validation failed:', validationResult.error);
      await updateAnalysis(analysisId, {
        status: 'failed',
        error_message: validationResult.error || 'Evidence validation failed',
      });
      return;
    }

    await storeArtifact(analysisId, 'evidence', {
      status: parsedResult.status,
      description: parsedResult.description,
      reason: parsedResult.reason,
      confidence: parsedResult.confidence,
      evidence: parsedResult.evidence,
      requiredFiles: parsedResult.requiredFiles,
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
      status: 'evidence_complete',
      current_stage: 'evidence_extraction',
      ai_provider: response.provider,
      ai_model: response.model,
      ai_duration_ms: duration,
      ai_tokens_input: response.usage?.inputTokens || 0,
      ai_tokens_output: response.usage?.outputTokens || 0,
    });

    console.log(`[evidence] Evidence extraction complete for ${analysisId} (status: ${parsedResult.status})`);
    if (parsedResult.status !== 'evidence_found') {
      console.log(`[evidence] Note: Evidence status is "${parsedResult.status}". Solution stage should handle this appropriately.`);
    }

  } catch (error) {
    const err = error as Error;
    console.error(`[evidence] Extraction failed for ${analysisId}:`, err.message);

    await updateAnalysis(analysisId, {
      status: 'failed',
      error_message: err.message.slice(0, 1000),
    });
  }
}
