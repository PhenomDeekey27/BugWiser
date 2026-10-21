import { createBackgroundClient } from '@/lib/supabase/background';
import { fetchIssueComments } from '@/lib/github/comments';
import { fetchRepositoryTree } from '@/lib/github/tree';
import { getRepositoryAccessToken } from '@/lib/github/app/access';
import { filterTreeEntries } from './filter';
import { detectLanguage } from './language';
import { buildFingerprint } from './fingerprint';

type AnalysisStatus =
  | 'queued'
  | 'initializing'
  | 'indexing'
  | 'ready_for_analysis'
  | 'failed'
  | 'completed';

type AnalysisStage =
  | 'issue_context'
  | 'issue_comments'
  | 'repository_tree'
  | 'file_filtering'
  | 'repository_fingerprint'
  | 'ready';

async function updateAnalysis(
  analysisId: string,
  updates: {
    status?: AnalysisStatus;
    current_stage?: AnalysisStage;
    error_message?: string;
    total_files?: number;
    filtered_files?: number;
    fingerprint?: Record<string, unknown>;
    completed_at?: string;
  }
) {
  const supabase = createBackgroundClient();
  const { error } = await supabase
    .from('analyses')
    .update(updates)
    .eq('id', analysisId);

  if (error) {
    console.error('[analysis-runner] Failed to update analysis:', error.message);
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
    console.error('[analysis-runner] Failed to store artifact:', error.message);
  }
}

async function storeRepositoryFiles(
  analysisId: string,
  files: Array<{
    path: string;
    file_type: string;
    size: number;
    sha: string;
    language: string;
    is_ignored: boolean;
  }>
) {
  const supabase = createBackgroundClient();

  const BATCH_SIZE = 500;
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE).map((f) => ({
      analysis_id: analysisId,
      ...f,
    }));

    const { error } = await supabase.from('repository_files').insert(batch);
    if (error) {
      console.error('[analysis-runner] Failed to store repository files:', error.message);
      break;
    }
  }
}

function parseRepoFullName(fullName: string): { owner: string; repo: string } {
  const parts = fullName.split('/');
  return { owner: parts[0], repo: parts[1] };
}

export async function runAnalysisInitialization(analysisId: string, actorUserId: string): Promise<void> {
  console.log(`[analysis-runner] Starting analysis ${analysisId}`);

  try {
    const supabase = createBackgroundClient();

    const { data: analysis, error: fetchError } = await supabase
      .from('analyses')
      .select('*')
      .eq('id', analysisId)
      .single();

    if (fetchError || !analysis) {
      console.error('[analysis-runner] Analysis not found:', fetchError?.message);
      return;
    }

    if (analysis.user_id !== actorUserId) {
      throw new Error('Analysis does not belong to the requesting user');
    }

    const { owner, repo } = parseRepoFullName(analysis.repository_full_name);

    // Resolve a short-lived installation token inside the job. The browser
    // session is not used, so a job that outlives the session still works.
    const repositoryAccess = await getRepositoryAccessToken(
      actorUserId,
      analysis.repository_full_name
    );
    const token = repositoryAccess.token.token;

    // Step 1: Fetch Issue Context
    await updateAnalysis(analysisId, {
      status: 'initializing',
      current_stage: 'issue_context',
    });
    console.log(`[analysis-runner] Fetching issue #${analysis.issue_number} context`);

    const issueUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${analysis.issue_number}`;
    const issueResponse = await fetch(issueUrl, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!issueResponse.ok) {
      const errText = await issueResponse.text();
      throw new Error(`Failed to fetch issue: ${issueResponse.status} ${errText}`);
    }

    const issueData = await issueResponse.json() as {
      title: string;
      body: string | null;
      state: string;
      labels: Array<{ name: string }>;
      user: { login: string };
      created_at: string;
      updated_at: string;
      comments: number;
      html_url: string;
    };

    const issueContext = {
      number: analysis.issue_number,
      title: issueData.title,
      body: issueData.body || '',
      state: issueData.state,
      labels: issueData.labels.map((l) => l.name),
      author: issueData.user.login,
      createdAt: issueData.created_at,
      updatedAt: issueData.updated_at,
      commentsCount: issueData.comments,
      htmlUrl: issueData.html_url,
    };

    await storeArtifact(analysisId, 'issue_context', issueContext as unknown as Record<string, unknown>);

    // Step 2: Fetch Issue Comments
    await updateAnalysis(analysisId, {
      current_stage: 'issue_comments',
    });
    console.log(`[analysis-runner] Fetching issue #${analysis.issue_number} comments`);

    const comments = await fetchIssueComments(
      token, owner, repo, analysis.issue_number, 1, 100
    );

    const normalizedComments = comments.comments.map((c) => ({
      id: c.id,
      author: c.user.login,
      body: c.body,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
      htmlUrl: c.html_url,
    }));

    await storeArtifact(analysisId, 'issue_comments', {
      comments: normalizedComments,
      totalCount: normalizedComments.length,
    } as unknown as Record<string, unknown>);

    // Step 3: Fetch Repository Tree
    await updateAnalysis(analysisId, {
      status: 'indexing',
      current_stage: 'repository_tree',
    });
    console.log(`[analysis-runner] Fetching repository tree for ${analysis.repository_full_name}`);

    const branch = analysis.repository_full_name.includes('nextjs')
      ? 'main'
      : 'main';

    const { tree, truncated } = await fetchRepositoryTree(
      token, owner, repo, branch
    );

    console.log(`[analysis-runner] Tree fetched: ${tree.length} entries, truncated: ${truncated}`);

    // Step 4: Filter Files
    await updateAnalysis(analysisId, {
      current_stage: 'file_filtering',
    });
    console.log(`[analysis-runner] Filtering ${tree.length} files`);

    const filteredFiles = filterTreeEntries(tree, detectLanguage);
    const activeFiles = filteredFiles.filter((f) => !f.isIgnored);

    console.log(`[analysis-runner] ${activeFiles.length} active files, ${filteredFiles.length - activeFiles.length} ignored`);

    // Step 5: Build Fingerprint
    await updateAnalysis(analysisId, {
      current_stage: 'repository_fingerprint',
    });
    console.log(`[analysis-runner] Building repository fingerprint`);

    const fingerprint = buildFingerprint(filteredFiles);

    await storeArtifact(analysisId, 'fingerprint', fingerprint as unknown as Record<string, unknown>);

    // Step 6: Persist file metadata
    const fileRecords = filteredFiles.map((f) => ({
      path: f.path,
      file_type: f.type,
      size: f.size,
      sha: f.sha,
      language: f.language,
      is_ignored: f.isIgnored,
    }));

    await storeRepositoryFiles(analysisId, fileRecords);

    // Step 7: Finalize
    await updateAnalysis(analysisId, {
      status: 'ready_for_analysis',
      current_stage: 'ready',
      total_files: tree.length,
      filtered_files: activeFiles.length,
      fingerprint: fingerprint as unknown as Record<string, unknown>,
      completed_at: new Date().toISOString(),
    });

    console.log(`[analysis-runner] Analysis ${analysisId} completed successfully`);
    console.log(`[analysis-runner]   Total files: ${tree.length}`);
    console.log(`[analysis-runner]   Active files: ${activeFiles.length}`);
    console.log(`[analysis-runner]   Framework: ${fingerprint.framework || 'Unknown'}`);
    console.log(`[analysis-runner]   Primary language: ${fingerprint.primaryLanguage || 'Unknown'}`);

  } catch (error) {
    const err = error as Error;
    console.error(`[analysis-runner] Analysis ${analysisId} failed:`, err.message);

    await updateAnalysis(analysisId, {
      status: 'failed',
      error_message: err.message.slice(0, 1000),
    });
  }
}
