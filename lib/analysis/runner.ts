import { createBackgroundClient } from '@/lib/supabase/background';
import {
  fetchSnapshotIssue,
  fetchSnapshotIssueComments,
  fetchSnapshotTree,
  resolveRepositorySnapshot,
} from './repository-source';
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
    repository_branch?: string;
    repository_default_branch?: string;
    repository_commit?: string;
    github_installation_id?: number | null;
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

    // Resolve the exact source of truth once: installation or public, and pin
    // the commit SHA that every later stage must read from.
    const snapshot = await resolveRepositorySnapshot(analysis, actorUserId);
    console.log(
      `[analysis-runner] Source ${snapshot.source} ${snapshot.fullName}@${snapshot.commitSha.slice(0, 12)}`
    );

    await updateAnalysis(analysisId, {
      repository_branch: snapshot.branch,
      repository_default_branch: snapshot.defaultBranch,
      repository_commit: snapshot.commitSha,
      github_installation_id: snapshot.installationId,
    });

    // Step 1: Fetch Issue Context
    await updateAnalysis(analysisId, {
      status: 'initializing',
      current_stage: 'issue_context',
    });

    const descriptionOnly =
      analysis.issue_source === 'description' ||
      !Number.isSafeInteger(analysis.issue_number) ||
      analysis.issue_number <= 0;

    let issueContext: {
      number: number;
      title: string;
      body: string;
      state: string;
      labels: string[];
      author: string;
      createdAt: string;
      updatedAt: string;
      commentsCount: number;
      htmlUrl: string;
    };

    if (descriptionOnly) {
      const description = String(analysis.issue_description || '').trim();
      if (description.length < 20) {
        throw new Error(
          'A written issue description of at least 20 characters is required when no GitHub issue is linked.'
        );
      }
      const firstLine = description.split('\n').map((line) => line.trim()).find(Boolean) || 'Reported issue';
      const now = new Date().toISOString();
      issueContext = {
        number: 0,
        title: analysis.issue_title || firstLine.slice(0, 200),
        body: description,
        state: 'open',
        labels: [],
        author: '',
        createdAt: analysis.created_at || now,
        updatedAt: now,
        commentsCount: 0,
        htmlUrl: analysis.issue_url || snapshot.htmlUrl,
      };
      console.log('[analysis-runner] Using the written issue description');
    } else {
      console.log(`[analysis-runner] Fetching issue #${analysis.issue_number} context`);
      const issue = await fetchSnapshotIssue(snapshot, analysis.issue_number);
      if (!issue) {
        throw new Error(`Issue #${analysis.issue_number} was not found in ${snapshot.fullName}.`);
      }
      issueContext = {
        number: issue.number,
        title: issue.title,
        body: issue.body,
        state: issue.state,
        labels: issue.labels,
        author: issue.author,
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
        commentsCount: issue.commentsCount,
        htmlUrl: issue.htmlUrl,
      };
    }

    await storeArtifact(analysisId, 'issue_context', issueContext as unknown as Record<string, unknown>);

    // Step 2: Fetch Issue Comments
    await updateAnalysis(analysisId, {
      current_stage: 'issue_comments',
    });

    const normalizedComments = descriptionOnly
      ? []
      : (await fetchSnapshotIssueComments(snapshot, analysis.issue_number)).map((comment) => ({
          id: comment.id,
          author: comment.author,
          body: comment.body,
          createdAt: comment.createdAt,
          updatedAt: comment.updatedAt,
          htmlUrl: comment.htmlUrl,
        }));

    await storeArtifact(analysisId, 'issue_comments', {
      comments: normalizedComments,
      totalCount: normalizedComments.length,
    } as unknown as Record<string, unknown>);

    // Step 3: Fetch Repository Tree at the pinned commit
    await updateAnalysis(analysisId, {
      status: 'indexing',
      current_stage: 'repository_tree',
    });
    console.log(
      `[analysis-runner] Fetching repository tree for ${analysis.repository_full_name}@${snapshot.commitSha.slice(0, 12)}`
    );

    const { tree, truncated } = await fetchSnapshotTree(snapshot);

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
    console.log(`[analysis-runner]   Snapshot: ${snapshot.fullName}@${snapshot.commitSha}`);
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
