import { createBackgroundClient } from '@/lib/supabase/background';
import { generate } from '@/lib/ai/gateway';
import { buildRelevantFileContext, RelevantFileContext } from '@/lib/ai/context';
import { deterministicPreFilter } from '@/lib/ai/context/prefilter';
import { validateRelevantFiles, parseAIResponse } from '@/lib/ai/validation';
import { IssueContext, IssueComment, RepositoryFingerprint, RepositoryFileRecord } from '@/types';

async function updateAnalysis(
  analysisId: string,
  updates: {
    status?: string;
    current_stage?: string;
    error_message?: string;
  }
) {
  const supabase = createBackgroundClient();
  const { error } = await supabase.from('analyses').update(updates).eq('id', analysisId);
  if (error) {
    console.error('[relevant-files] Failed to update analysis:', error.message);
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
    console.error('[relevant-files] Failed to store artifact:', artifactType, error.message);
  }
}

async function getArtifact(
  analysisId: string,
  artifactType: string
): Promise<Record<string, unknown> | null> {
  const supabase = createBackgroundClient();
  const { data, error } = await supabase
    .from('analysis_artifacts')
    .select('data')
    .eq('analysis_id', analysisId)
    .eq('artifact_type', artifactType)
    .single();
  if (error) {
    console.error('[relevant-files] Failed to fetch artifact:', artifactType, error.message);
    return null;
  }
  return data?.data || null;
}

async function getRepositoryFiles(analysisId: string): Promise<RepositoryFileRecord[]> {
  const supabase = createBackgroundClient();
  const { data, error } = await supabase
    .from('repository_files')
    .select('*')
    .eq('analysis_id', analysisId);
  if (error) {
    console.error('[relevant-files] Failed to fetch repository files:', error.message);
    return [];
  }
  return (data as RepositoryFileRecord[]) || [];
}

async function fetchGitHubFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  ref: string
): Promise<{ path: string; content: string; size: number; sha: string } | null> {
  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${ref}`;
    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github.v3.raw',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!response.ok) return null;

    const content = await response.text();
    return {
      path,
      content,
      size: content.length,
      sha: response.headers.get('etag') || '',
    };
  } catch {
    return null;
  }
}

export async function runRelevantFileDiscovery(analysisId: string, githubToken: string): Promise<void> {
  console.log(`[relevant-files] Starting relevant file discovery for ${analysisId}`);

  try {
    const supabase = createBackgroundClient();

    const { data: analysis, error: fetchError } = await supabase
      .from('analyses')
      .select('*')
      .eq('id', analysisId)
      .single();

    if (fetchError || !analysis) {
      console.error('[relevant-files] Analysis not found:', fetchError?.message);
      throw new Error('Analysis not found in database');
    }

    const token = githubToken;
    const [owner, repo] = analysis.repository_full_name.split('/');

    await updateAnalysis(analysisId, {
      status: 'relevant_file_discovery',
      current_stage: 'relevant_files_discovery',
    });

    const issueContextData = await getArtifact(analysisId, 'issue_context');
    const commentsData = await getArtifact(analysisId, 'issue_comments');
    const fingerprintData = await getArtifact(analysisId, 'fingerprint');

    if (!issueContextData || !fingerprintData) {
      await updateAnalysis(analysisId, {
        status: 'failed',
        error_message: 'Required artifacts not found',
      });
      return;
    }

    const issue = issueContextData as unknown as IssueContext;
    const comments = (commentsData as unknown as { comments: IssueComment[] })?.comments || [];
    const fingerprint = fingerprintData as unknown as RepositoryFingerprint;
    const repositoryFiles = await getRepositoryFiles(analysisId);

    console.log(`[relevant-files] Building deterministic candidates from ${repositoryFiles.length} files`);

    const candidates = deterministicPreFilter(repositoryFiles, issue, fingerprint);
    console.log(`[relevant-files] Deterministic filter produced ${candidates.length} candidates`);

    const contextLimit = 128000;

    const relevantFileContext: RelevantFileContext = {
      issue,
      comments,
      fingerprint,
      files: repositoryFiles.map((f) => ({
        path: f.path,
        language: f.language,
        size: f.size,
        isIgnored: f.is_ignored,
      })),
      contextLimit,
    };

    console.log(`[relevant-files] Building AI context (limit: ${contextLimit})`);

    const builtContext = buildRelevantFileContext(relevantFileContext);
    console.log(`[relevant-files] Estimated tokens: ${builtContext.estimatedTokens}, context reduced: ${builtContext.contextReduced}`);

    const startTime = Date.now();
    const response = await generate({
      analysisId,
      task: 'relevant_file_discovery',
      messages: builtContext.messages,
      temperature: 0.3,
      maxTokens: 2048,
      responseFormat: { type: 'json_object' },
    });
    const duration = Date.now() - startTime;

    console.log(`[relevant-files] AI response received in ${duration}ms from model: ${response.model}`);
    console.log(`[relevant-files] Raw response length: ${response.content.length} chars`);

    const parsedResults = parseAIResponse(response.content);
    console.log(`[relevant-files] Parsed ${parsedResults.length} file results`);
    if (parsedResults.length === 0) {
      console.log(`[relevant-files] WARNING: AI returned 0 results. Raw response (first 500 chars): ${response.content.slice(0, 500)}`);
    }

    const { validFiles, rejectedPaths } = validateRelevantFiles(parsedResults, repositoryFiles);
    console.log(`[relevant-files] Validated: ${validFiles.length} valid, ${rejectedPaths.length} rejected`);

    let enrichedFiles;
    let discoverySource: 'ai' | 'deterministic_fallback';

    if (validFiles.length === 0 && candidates.length > 0) {
      console.log(`[relevant-files] AI returned 0 valid files. Using deterministic fallback from ${candidates.length} pre-filter candidates`);

      enrichedFiles = candidates.slice(0, 15).map((c) => ({
        path: c.path,
        language: repositoryFiles.find((f) => f.path === c.path)?.language || 'Unknown',
        relevanceScore: Math.min(1, Math.max(0.3, c.score)),
        description: c.reason,
        reason: c.reason,
        confidence: Math.min(1, Math.max(0.3, c.score)),
        provider: response.provider,
        model: response.model,
        source: 'deterministic_fallback' as const,
      }));
      discoverySource = 'deterministic_fallback';
    } else {
      enrichedFiles = validFiles.map((f) => ({
        ...f,
        reason: parsedResults.find((r) => r.path === f.path)?.reason || '',
        confidence: parsedResults.find((r) => r.path === f.path)?.confidence || f.relevanceScore,
        provider: response.provider,
        model: response.model,
        source: 'ai' as const,
      }));
      discoverySource = 'ai';
    }

    await storeArtifact(analysisId, 'relevant_files', {
      files: enrichedFiles,
      totalCandidates: candidates.length,
      validFiles: enrichedFiles.length,
      rejectedPaths,
      contextReduced: builtContext.contextReduced,
      estimatedTokens: builtContext.estimatedTokens,
      provider: response.provider,
      model: response.model,
      duration,
      usage: response.usage,
      discoverySource,
      selection: {
        mode: response.selection?.mode || 'auto',
        reason: response.selection?.reason || '',
        manualFallbackOccurred: response.manualFallbackOccurred || false,
      },
    } as unknown as Record<string, unknown>);

    await updateAnalysis(analysisId, {
      current_stage: 'relevant_files_fetch',
    });

    console.log(`[relevant-files] Fetching ${enrichedFiles.length} files from GitHub`);

    const sourceFiles: Array<{
      path: string;
      content: string;
      size: number;
      language: string;
      sha: string;
      lineCount: number;
    }> = [];

    for (const file of enrichedFiles.slice(0, 15)) {
      const fetched = await fetchGitHubFile(token, owner, repo, file.path, 'HEAD');
      if (fetched) {
        const lineCount = fetched.content.split('\n').length;
        sourceFiles.push({
          path: file.path,
          content: fetched.content,
          size: fetched.size,
          language: file.language,
          sha: fetched.sha,
          lineCount,
        });
        console.log(`[relevant-files] Fetched ${file.path} (${fetched.size} bytes, ${lineCount} lines)`);
      }
    }

    await storeArtifact(analysisId, 'source_files', {
      files: sourceFiles,
      totalFetched: sourceFiles.length,
    } as unknown as Record<string, unknown>);

    await updateAnalysis(analysisId, {
      status: 'relevant_files_ready',
      current_stage: 'relevant_files_complete',
    });

    console.log(`[relevant-files] Discovery complete: ${enrichedFiles.length} relevant files, ${sourceFiles.length} source files fetched`);

  } catch (error) {
    const err = error as Error;
    console.error(`[relevant-files] Discovery failed for ${analysisId}:`, err.message);

    await updateAnalysis(analysisId, {
      status: 'failed',
      error_message: err.message.slice(0, 1000),
    });
  }
}
