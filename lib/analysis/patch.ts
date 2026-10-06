import { createBackgroundClient } from '@/lib/supabase/background';
import { runWithFallback } from '@/lib/ai/model-router';
import { generate, GenerateResult } from '@/lib/ai/gateway';
import { buildPatchContext, PatchContext } from '@/lib/ai/context/patch';
import { validatePatch, parsePatchResponse, PatchResult } from '@/lib/ai/validation/patch';
import { buildCanonicalContext, estimateContextSize, selectSourceFilesForStage } from '@/lib/ai/context/canonical';
import { recordModelExecution, logStageStart, logStageResult } from '@/lib/ai/model-execution-tracker';
import { verifyPatchAgainstSources } from './patch-verify';

const MAX_PATCH_ATTEMPTS = 3;

/**
 * Feedback appended to the original context when an attempt produced a patch
 * that could not be applied. It names the concrete problem so the next attempt
 * fixes THAT instead of guessing, and restates the structural rules the
 * applier enforces — none of which are provider-specific, so the same retry
 * path corrects a local model and a cloud model alike.
 */
function buildPatchRetryMessage(problem: string): string {
  return `Your previous patch could not be used:

${problem}

Generate the patch again, following every rule below:
- Copy context lines EXACTLY as they appear in the provided source code, including blank lines. Never skip a line between two context lines.
- The OLD side of a hunk (context + removed) must be a contiguous run of file lines; likewise the NEW side (context + added).
- "oldLines" must equal the number of context + removed entries, and "newLines" the number of context + added entries.
- Emit exactly one physical line per entry. Never pack more than one line into a single "content" value.
- Start and end every hunk with at least one context line; a hunk made only of added lines cannot be located in the file and will be rejected.
- Remove only lines you quote verbatim, and only touch files that appear in the provided source code.`;
}

async function updateAnalysis(
  analysisId: string,
  updates: {
    status?: string;
    current_stage?: string;
    error_message?: string | null;
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
      // Explicit null, not `undefined`: supabase-js drops undefined keys, so a
      // stale failure reason from an earlier run would otherwise survive a
      // successful re-run and keep showing next to a completed analysis.
      error_message: null,
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

    const startTime = Date.now();
    let response: GenerateResult | undefined;
    let parsedResult: PatchResult | undefined;
    let attemptNumber = 0;
    let lastProblem = '';

    // Generate → validate → DRY-RUN the patch against the exact source files
    // it was produced from, and retry with the concrete failure reason when it
    // would not apply. Without this the only feedback comes at the apply
    // button, after a branch has already been created.
    for (let attempt = 1; attempt <= MAX_PATCH_ATTEMPTS; attempt++) {
      const attemptStartedAt = Date.now();
      const messages =
        attempt === 1
          ? builtContext.messages
          : [...builtContext.messages, { role: 'user' as const, content: buildPatchRetryMessage(lastProblem) }];

      let attemptResponse: GenerateResult;
      try {
        attemptResponse = await generate({
          analysisId,
          task: 'patch_generation',
          messages,
          temperature: 0.3,
          maxTokens: 8192,
          responseFormat: { type: 'json_object' },
        });
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        attemptNumber = attempt;

        await recordModelExecution({
          analysisId,
          stage: 'patch_generation',
          provider: 'unknown',
          model: 'unknown',
          attemptNumber,
          startedAt: new Date(attemptStartedAt).toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - attemptStartedAt,
          success: false,
          error: error.message.slice(0, 500),
          inputTokens: null,
          outputTokens: null,
          fallbackCount: 0,
          contextChars: sizeInfo.totalChars,
          estimatedTokens: sizeInfo.estimatedTokens,
        });

        // The gateway already exhausted its own model fallbacks; one more pass
        // may still succeed with the feedback from this failure.
        if (attempt < MAX_PATCH_ATTEMPTS) {
          lastProblem = `The model call failed: ${error.message}`;
          console.warn(`[patch] attempt ${attempt}: ${lastProblem}`);
          continue;
        }
        throw error;
      }

      attemptNumber = attempt + attemptResponse.fallbackCount;
      response = attemptResponse;

      await recordModelExecution({
        analysisId,
        stage: 'patch_generation',
        provider: attemptResponse.provider,
        model: attemptResponse.model,
        attemptNumber,
        startedAt: new Date(attemptStartedAt).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - attemptStartedAt,
        success: true,
        error: null,
        inputTokens: attemptResponse.usage?.inputTokens || null,
        outputTokens: attemptResponse.usage?.outputTokens || null,
        fallbackCount: attemptResponse.fallbackCount,
        contextChars: sizeInfo.totalChars,
        estimatedTokens: sizeInfo.estimatedTokens,
      });

      const candidate = parsePatchResponse(attemptResponse.content);
      console.log(`[patch] attempt ${attempt}: parsed ${candidate.files.length} files`);

      const validationResult = validatePatch(candidate);
      if (!validationResult.valid) {
        lastProblem = `Patch validation failed: ${validationResult.error}`;
        console.warn(`[patch] attempt ${attempt}: ${lastProblem}`);
        continue;
      }

      const verification = verifyPatchAgainstSources(candidate.files, context.sourceFiles);
      if (!verification.ok) {
        lastProblem = verification.message;
        console.warn(`[patch] attempt ${attempt}: ${lastProblem}`);
        continue;
      }

      parsedResult = candidate;
      break;
    }

    const duration = Date.now() - startTime;

    if (!response) {
      throw new Error(lastProblem || 'Patch generation did not run.');
    }

    logStageResult(
      'patch',
      analysisId,
      response.provider,
      response.model,
      attemptNumber,
      parsedResult !== undefined,
      duration
    );

    if (!parsedResult) {
      const message = lastProblem || 'The model did not produce a patch that can be applied.';
      console.error('[patch] No usable patch:', message);
      await updateAnalysis(analysisId, {
        status: 'failed',
        error_message: message.slice(0, 1000),
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
      error_message: null,
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
