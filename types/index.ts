export interface Repository {
  id: string;
  name: string;
  fullName: string;
  description: string;
  language: string;
  stars: number;
  forks: number;
  lastUpdated: string;
  private: boolean;
  owner?: string;
  ownerAvatar?: string;
  defaultBranch?: string;
  htmlUrl?: string;
}

export interface Issue {
  id: string;
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  labels: string[];
  assignees: string[];
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  comments: number;
  htmlUrl: string;
  userLogin: string;
  repositoryId: string;
}

export type AnalysisStatus =
  | 'idle'
  | 'indexing'
  | 'analyzing'
  | 'completed'
  | 'failed'
  | 'relevant_file_discovery'
  | 'relevant_files_ready'
  | 'root_cause_complete'
  | 'evidence_complete'
  | 'solution_complete'
  | 'queued'
  | 'initializing'
  | 'ready_for_analysis'
  | 'no_evidence';

export type AnalysisStage =
  | 'REPOSITORY'
  | 'ISSUE'
  | 'RELEVANT_FILES'
  | 'ROOT_CAUSE'
  | 'EVIDENCE'
  | 'SOLUTION'
  | 'PATCH';

export interface AnalysisStageInfo {
  stage: AnalysisStage;
  status: 'completed' | 'running' | 'pending' | 'failed' | 'no_evidence';
  label: string;
  stageDetail?: string;
  onClick?: () => void;
}

export interface RelevantFile {
  path: string;
  language: string;
  relevanceScore: number;
  description: string;
  reason?: string;
  confidence?: number;
  provider?: string;
  model?: string;
  tier?: string;
  source?: 'ai' | 'deterministic';
}

/**
 * A file the analysis could not read at the pinned commit. It is listed so a
 * missing snippet is never mistaken for a hallucinated one.
 */
export interface UnavailableSourceFile {
  path: string;
  reason: string;
}

export interface CodeLine {
  number: number;
  content: string;
  isHighlighted: boolean;
  type: 'added' | 'removed' | 'context';
}

export interface CodeFile {
  path: string;
  language: string;
  lines: CodeLine[];
}

export interface RootCause {
  summary: string;
  description: string;
  confidence: number;
  affectedFiles: string[];
}

export interface Evidence {
  status?: 'evidence_found' | 'no_evidence' | 'insufficient_evidence';
  description: string;
  reason?: string;
  confidence?: number;
  evidence: Array<{
    file: string;
    lineStart: number;
    lineEnd: number;
    code: string;
    explanation: string;
    type: 'direct' | 'supporting';
    verification?: 'verified' | 'unverified' | 'rejected';
    verificationReason?: string;
    correctedRange?: { lineStart: number; lineEnd: number };
  }>;
  requiredFiles?: string[];
}

export interface CodeReference {
  file: string;
  startLine: number;
  endLine: number;
  explanation: string;
}

export interface Solution {
  summary: string;
  description: string;
  steps: string[];
  affectedFiles: Array<{
    path: string;
    change: string;
  }>;
  risks: string[];
  confidence: number;
}

export interface Patch {
  files: PatchFile[];
  summary: string;
}

export interface PatchFile {
  path: string;
  additions: number;
  deletions: number;
  hunks: PatchHunk[];
}

export interface PatchHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: CodeLine[];
}

export type PatchFileOperation = 'modify' | 'create' | 'delete';

export interface StructuredPatchFile {
  path: string;
  operation: PatchFileOperation;
  summary: string;
  reason: string;
  oldContent?: string;
  newContent?: string;
  diff: string;
}

export interface StructuredPatch {
  summary: string;
  files: StructuredPatchFile[];
}

export interface ApplyFixResult {
  success: boolean;
  branch: string;
  commitSha: string;
  commitMessage: string;
  filesChanged: string[];
  repositoryFullName: string;
  defaultBranch: string;
  htmlUrl?: string;
  pullRequestUrl?: string;
}

export interface ApplyFixError {
  success: false;
  error: string;
  code: ApplyFixErrorCode;
}

export type ApplyFixErrorCode =
  | 'auth_failure'
  | 'permission_denied'
  | 'branch_exists'
  | 'branch_creation_failed'
  | 'file_changed'
  | 'patch_validation_failed'
  | 'commit_failed'
  | 'repository_not_found'
  | 'token_expired'
  | 'insufficient_permissions';

export interface Analysis {
  id: string;
  repository: Repository;
  issue: Issue;
  status: AnalysisStatus;
  currentStage: AnalysisStage;
  stages: AnalysisStageInfo[];
  relevantFiles: RelevantFile[];
  rootCause: RootCause | null;
  evidence: Evidence | null;
  solution: Solution | null;
  patch: Patch | null;
  startedAt: string;
  completedAt: string | null;
}

export interface DashboardStats {
  repositories: number;
  issuesAnalyzed: number;
  patchesGenerated: number;
}

export interface NavItem {
  label: string;
  href: string;
  icon?: string;
  active?: boolean;
}

export interface GitHubUser {
  login: string;
  name: string | null;
  avatarUrl: string;
}

export interface AnalysisContext {
  repository: Repository;
  issue: Issue;
}

// Database record types
export interface AnalysisModelSelection {
  mode: 'auto' | 'manual';
  reason?: string;
  manualFallbackOccurred?: boolean;
  startedAt?: string;
  stages?: Record<
    string,
    {
      provider: string;
      model: string;
      fit?: number | null;
      fallbackCount?: number;
      attempted?: Array<{ provider: string; model: string }>;
    }
  >;
}

export type AnalysisModelStrategy =
  | 'auto'
  | 'free'
  | 'free_paid'
  | 'fully_paid'
  | 'custom';

export interface AnalysisRecord {
  id: string;
  user_id: string;
  repository_id: string;
  repository_full_name: string;
  repository_owner: string;
  repository_name: string;
  issue_number: number;
  issue_title: string;
  status:
    | 'queued'
    | 'initializing'
    | 'indexing'
    | 'ready_for_analysis'
    | 'relevant_file_discovery'
    | 'relevant_files_fetch'
    | 'relevant_files_discovery'
    | 'relevant_files_ready'
    | 'analyzing'
    | 'root_cause_complete'
    | 'evidence_complete'
    | 'solution_complete'
    | 'failed'
    | 'completed';
  current_stage:
    | 'issue_context'
    | 'issue_comments'
    | 'repository_tree'
    | 'file_filtering'
    | 'repository_fingerprint'
    | 'ready'
    | 'relevant_files_discovery'
    | 'relevant_files_fetch'
    | 'relevant_files_complete'
    | 'root_cause_analysis'
    | 'evidence_extraction'
    | 'solution_generation'
    | 'patch_generation'
    | 'completed';
  model_strategy: AnalysisModelStrategy | null;

  /** Where repository data came from. Legacy rows are 'installation'. */
  repository_source?: 'installation' | 'public';
  repository_url?: string | null;
  repository_branch?: string | null;
  repository_default_branch?: string | null;
  /** Pinned commit the analysis was generated from. */
  repository_commit?: string | null;
  issue_source?: 'github' | 'description';
  issue_url?: string | null;
  issue_description?: string | null;
  workspace_status?: 'none' | 'staged' | 'discarded';
  workspace_staged_at?: string | null;

  error_message: string | null;
  total_files: number;
  filtered_files: number;
  fingerprint: RepositoryFingerprint | null;
  ai_provider: string | null;
  ai_model: string | null;
  ai_tier: string | null;
  ai_tokens_input: number | null;
  ai_tokens_output: number | null;
  ai_duration_ms: number | null;
  model_config: {
    fast: string;
    balanced: string;
    deep: string;
  } | null;
  model_selection: AnalysisModelSelection | null;
  patch_status: 'none' | 'pending' | 'applied' | 'failed' | null;
  created_branch: string | null;
  commit_sha: string | null;
  commit_message: string | null;
  changed_files: string[] | null;
  applied_at: string | null;
  /** Set only when the fix was opened as a pull request. */
  pull_request_url?: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface RepositoryFileRecord {
  id: string;
  analysis_id: string;
  path: string;
  file_type: string;
  size: number;
  sha: string;
  language: string;
  is_ignored: boolean;
  created_at: string;
}

export interface AnalysisArtifactRecord {
  id: string;
  analysis_id: string;
  artifact_type:
    | 'issue_context'
    | 'issue_comments'
    | 'repository_tree'
    | 'fingerprint'
    | 'relevant_files'
    | 'source_files'
    | 'root_cause'
    | 'evidence'
    | 'solution'
    | 'patch'
    | 'model_execution'
    | 'model_selection'
    | 'repository_context'
    | 'evidence_verification'
    | 'verification'
    | 'workspace';
  data: Record<string, unknown>;
  created_at: string;
}

// Analysis initialization types
export interface IssueContext {
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
}

export interface IssueComment {
  id: number;
  author: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
}

export interface RepositoryFingerprint {
  primaryLanguage: string | null;
  framework: string | null;
  packageManager: string | null;
  projectType: string;
  configFiles: string[];
  sourceDirectories: string[];
  testDirectories: string[];
  languages: string[];
  totalFiles: number;
  activeFiles: number;
}

export interface RootCauseResult {
  rootCause: {
    summary: string;
    explanation: string;
    confidence: number;
  };
  affectedFiles: Array<{
    path: string;
    reason: string;
  }>;
  evidence: Array<{
    file: string;
    lineStart: number;
    lineEnd: number;
    explanation: string;
  }>;
}

export interface EvidenceResult {
  status: 'evidence_found' | 'no_evidence' | 'insufficient_evidence';
  description: string;
  reason?: string;
  confidence?: number;
  evidence: Array<{
    file: string;
    lineStart: number;
    lineEnd: number;
    code: string;
    explanation: string;
    type: 'direct' | 'supporting';
  }>;
  requiredFiles?: string[];
}

export interface SolutionResult {
  summary: string;
  description: string;
  steps: string[];
  affectedFiles: Array<{
    path: string;
    change: string;
  }>;
  risks: string[];
  confidence: number;
}

export interface PatchResult {
  summary: string;
  files: Array<{
    path: string;
    hunks: Array<{
      oldStart: number;
      oldLines: number;
      newStart: number;
      newLines: number;
      lines: Array<{
        type: 'context' | 'removed' | 'added';
        content: string;
      }>;
    }>;
  }>;
}

export interface VerificationCommandRecord {
  name: string;
  command: string;
  source: string;
  required: boolean;
}

export interface VerificationPlanRecord {
  commands: VerificationCommandRecord[];
  status: 'not_run';
  reason: string;
  regressionTests: string[];
}

export interface WorkspaceFileRecord {
  id: string;
  analysis_id: string;
  path: string;
  base_commit: string;
  base_content: string;
  content: string;
  diff: string;
  additions: number;
  deletions: number;
  created_at: string;
}

export interface WorkspaceSummary {
  status: 'none' | 'staged' | 'discarded';
  stagedAt: string | null;
  baseCommit: string | null;
  files: WorkspaceFileRecord[];
  verification: VerificationPlanRecord | null;
}
