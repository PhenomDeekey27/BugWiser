'use client';

import { RelevantFilesPanel } from '@/components/analysis/RelevantFilesPanel';
import { RootCausePanel } from '@/components/analysis/RootCausePanel';
import { EvidencePanel } from '@/components/analysis/EvidencePanel';
import { SolutionPanel } from '@/components/analysis/SolutionPanel';
import { PatchViewer } from '@/components/analysis/PatchViewer';
import { WorkspacePanel } from '@/components/analysis/WorkspacePanel';
import { RepositoryFileTree } from '@/components/analysis/RepositoryFileTree';
import { AnalysisOverview } from '@/components/analysis/AnalysisOverview';
import {
  Analysis,
  AnalysisRecord,
  ApplyFixResult,
  RepositoryFileRecord,
  RelevantFile,
  IssueContext,
  IssueComment,
  UnavailableSourceFile,
} from '@/types';

type ActiveTab = 'overview' | 'files' | 'root-cause' | 'evidence' | 'solution' | 'patch';

interface AnalysisTabContentProps {
  activeTab: ActiveTab;
  analysis: Analysis;
  record: AnalysisRecord;
  repositoryFiles: RepositoryFileRecord[];
  relevantFiles: RelevantFile[];
  unavailableSourceFiles?: UnavailableSourceFile[];
  issueContext: IssueContext | null;
  comments: IssueComment[];
  /** Lets the page reflect a push immediately, so the clone panel appears. */
  onApplied?: (result: ApplyFixResult) => void;
}

export function AnalysisTabContent({
  activeTab,
  analysis,
  record,
  repositoryFiles,
  relevantFiles,
  unavailableSourceFiles = [],
  issueContext,
  comments,
  onApplied,
}: AnalysisTabContentProps) {
  return (
    <div className="max-w-3xl">
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <AnalysisOverview
            fingerprint={record.fingerprint}
            issue={issueContext || {
              number: record.issue_number,
              title: record.issue_title,
              body: '',
              state: 'open',
              labels: [],
              author: '',
              createdAt: record.created_at,
              updatedAt: record.updated_at,
              commentsCount: 0,
              htmlUrl: '',
            }}
            comments={comments}
            totalFiles={record.total_files}
            filteredFiles={record.filtered_files}
            repositoryFullName={record.repository_full_name}
          />
          {(relevantFiles.length > 0 || unavailableSourceFiles.length > 0) && (
            <RelevantFilesPanel files={relevantFiles} unavailableFiles={unavailableSourceFiles} />
          )}
          {analysis.rootCause && <RootCausePanel rootCause={analysis.rootCause} />}
        </div>
      )}

      {activeTab === 'files' && (
        <div className="space-y-4">
          <RepositoryFileTree
            files={repositoryFiles}
            relevantFiles={relevantFiles}
          />
          {(relevantFiles.length > 0 || unavailableSourceFiles.length > 0) && (
            <RelevantFilesPanel files={relevantFiles} unavailableFiles={unavailableSourceFiles} />
          )}
        </div>
      )}

      {activeTab === 'root-cause' && analysis.rootCause && (
        <RootCausePanel rootCause={analysis.rootCause} />
      )}

      {activeTab === 'evidence' && analysis.evidence && (
        <EvidencePanel evidence={analysis.evidence} />
      )}

      {activeTab === 'solution' && analysis.solution && (
        <SolutionPanel solution={analysis.solution} rootCause={analysis.rootCause} />
      )}

      {activeTab === 'patch' && analysis.patch && (
        <div>
          <WorkspacePanel
            analysisId={record.id}
            repositorySource={record.repository_source}
            patchStatus={record.patch_status}
            onApplied={onApplied}
          />
          <PatchViewer
            patch={analysis.patch}
            analysisId={record.id}
            repositoryFullName={record.repository_full_name}
            patchStatus={record.patch_status}
            createdBranch={record.created_branch}
            commitSha={record.commit_sha}
            commitMessage={record.commit_message}
            changedFiles={record.changed_files}
            pullRequestUrl={record.pull_request_url}
          />
        </div>
      )}
    </div>
  );
}
