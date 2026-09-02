'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { AnalysisStepper } from '@/components/analysis/AnalysisStepper';
import { AnalysisHeader } from '@/components/analysis/AnalysisHeader';
import { AnalysisTabContent } from '@/components/analysis/AnalysisTabContent';
import { AnalysisDetailsSidebar } from '@/components/analysis/AnalysisDetailsSidebar';
import { ModelTierPipeline } from '@/components/analysis/ModelTierBadge';
import { ProgressOverlay } from '@/components/analysis/ProgressOverlay';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import {
  Analysis,
  AnalysisContext,
  AnalysisRecord,
  AnalysisStageInfo,
  RepositoryFileRecord,
  RelevantFile,
  GitHubUser,
  IssueContext,
  IssueComment,
  RootCause,
  Evidence,
  Solution,
  Patch,
} from '@/types';

type ActiveTab = 'overview' | 'files' | 'root-cause' | 'evidence' | 'solution' | 'patch';

const STAGE_ORDER = [
  'issue_context',
  'issue_comments',
  'repository_tree',
  'file_filtering',
  'repository_fingerprint',
  'ready',
  'relevant_files_discovery',
  'relevant_files_fetch',
  'relevant_files_complete',
  'root_cause_analysis',
  'evidence_extraction',
  'solution_generation',
  'patch_generation',
  'completed',
];

function buildStagesFromRecord(record: AnalysisRecord): AnalysisStageInfo[] {
  const currentIdx = STAGE_ORDER.indexOf(record.current_stage);
  const status = record.status;

  const isRelevantDone = status === 'relevant_files_ready' || status === 'root_cause_complete' || status === 'evidence_complete' || status === 'solution_complete' || status === 'completed';
  const isRootCauseDone = status === 'root_cause_complete' || status === 'evidence_complete' || status === 'solution_complete' || status === 'completed';
  const isEvidenceDone = status === 'evidence_complete' || status === 'solution_complete' || status === 'completed';
  const isSolutionDone = status === 'solution_complete' || status === 'completed';
  const isCompleted = status === 'completed';
  const isRunning = status === 'queued' || status === 'initializing' || status === 'indexing' || status === 'relevant_file_discovery' || status === 'relevant_files_fetch' || status === 'analyzing';
  const isFailed = status === 'failed';

  const getStageDetail = (stage: string): string | undefined => {
    if (!isRunning) return undefined;
    if (stage === 'RELEVANT_FILES' && status === 'relevant_file_discovery') return 'AI analyzing files...';
    if (stage === 'ROOT_CAUSE' && status === 'analyzing' && record.current_stage === 'root_cause_analysis') return 'AI identifying root cause...';
    if (stage === 'EVIDENCE' && status === 'analyzing' && record.current_stage === 'evidence_extraction') return 'AI extracting evidence...';
    if (stage === 'SOLUTION' && status === 'analyzing' && record.current_stage === 'solution_generation') return 'AI generating solution...';
    if (stage === 'PATCH' && status === 'analyzing' && record.current_stage === 'patch_generation') return 'AI generating patch...';
    return undefined;
  };

  return [
    { stage: 'REPOSITORY', status: currentIdx >= 2 ? 'completed' : 'pending', label: 'Repository', stageDetail: getStageDetail('REPOSITORY') },
    { stage: 'ISSUE', status: currentIdx >= 1 ? 'completed' : 'pending', label: 'Issue', stageDetail: getStageDetail('ISSUE') },
    { stage: 'RELEVANT_FILES', status: isRelevantDone ? 'completed' : currentIdx >= 5 && currentIdx <= 8 ? 'running' : isFailed && record.current_stage === 'relevant_files_discovery' ? 'failed' : 'pending', label: 'Relevant Files', stageDetail: getStageDetail('RELEVANT_FILES') },
    { stage: 'ROOT_CAUSE', status: isRootCauseDone ? 'completed' : currentIdx >= 9 && currentIdx <= 10 ? 'running' : isFailed && record.current_stage === 'root_cause_analysis' ? 'failed' : 'pending', label: 'Root Cause', stageDetail: getStageDetail('ROOT_CAUSE') },
    { stage: 'EVIDENCE', status: isEvidenceDone ? 'completed' : currentIdx >= 10 && currentIdx <= 11 ? 'running' : isFailed && record.current_stage === 'evidence_extraction' ? 'failed' : 'pending', label: 'Evidence', stageDetail: getStageDetail('EVIDENCE') },
    { stage: 'SOLUTION', status: isSolutionDone ? 'completed' : currentIdx >= 11 && currentIdx <= 12 ? 'running' : isFailed && record.current_stage === 'solution_generation' ? 'failed' : 'pending', label: 'Solution', stageDetail: getStageDetail('SOLUTION') },
    { stage: 'PATCH', status: isCompleted ? 'completed' : currentIdx >= 12 ? 'running' : isFailed && record.current_stage === 'patch_generation' ? 'failed' : 'pending', label: 'Patch', stageDetail: getStageDetail('PATCH') },
  ];
}

function buildAnalysisFromRecord(record: AnalysisRecord, ctx: AnalysisContext | null): Analysis {
  const repo = ctx?.repository || {
    id: record.repository_id,
    name: record.repository_name,
    fullName: record.repository_full_name,
    description: '',
    language: record.fingerprint?.primaryLanguage || '',
    stars: 0,
    forks: 0,
    lastUpdated: record.created_at,
    private: false,
    owner: record.repository_owner,
  };

  const issue = ctx?.issue || {
    id: '',
    number: record.issue_number,
    title: record.issue_title,
    body: '',
    state: 'open' as const,
    labels: [],
    assignees: [],
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    closedAt: null,
    comments: 0,
    htmlUrl: '',
    userLogin: '',
    repositoryId: record.repository_full_name,
  };

  const uiStatus =
    record.status === 'ready_for_analysis' || record.status === 'relevant_files_ready' || record.status === 'root_cause_complete' || record.status === 'evidence_complete' || record.status === 'solution_complete'
      ? 'completed'
      : record.status === 'failed'
        ? 'failed'
        : record.status === 'completed'
          ? 'completed'
          : 'indexing';

  return {
    id: record.id,
    repository: repo,
    issue,
    status: uiStatus,
    currentStage: 'REPOSITORY',
    stages: buildStagesFromRecord(record),
    relevantFiles: [],
    rootCause: null,
    evidence: null,
    solution: null,
    patch: null,
    startedAt: record.created_at,
    completedAt: record.completed_at,
  };
}

export default function InvestigationPage() {
  const { id: analysisId } = useParams<{ id: string }>();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<ActiveTab>('overview');
  const [record, setRecord] = useState<AnalysisRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [repositoryFiles, setRepositoryFiles] = useState<RepositoryFileRecord[]>([]);
  const [relevantFiles, setRelevantFiles] = useState<RelevantFile[]>([]);
  const [issueContext, setIssueContext] = useState<IssueContext | null>(null);
  const [comments, setComments] = useState<IssueComment[]>([]);
  const [rootCause, setRootCause] = useState<RootCause | null>(null);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [solution, setSolution] = useState<Solution | null>(null);
  const [patch, setPatch] = useState<Patch | null>(null);
  const [startingDiscovery, setStartingDiscovery] = useState(false);
  const [startingRootCause, setStartingRootCause] = useState(false);
  const [startingEvidence, setStartingEvidence] = useState(false);
  const [startingSolution, setStartingSolution] = useState(false);
  const [startingPatch, setStartingPatch] = useState(false);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const prevStatusRef = useRef<string | null>(null);
  const [pendingStart, setPendingStart] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user: authUser } }) => {
      if (authUser?.user_metadata) {
        setUser({
          login: authUser.user_metadata.user_name || authUser.user_metadata.login || 'user',
          name: authUser.user_metadata.full_name || authUser.user_metadata.name || null,
          avatarUrl: authUser.user_metadata.avatar_url || '',
        });
      }
    });
  }, []);

  const storedContext = useMemo<AnalysisContext | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const stored = localStorage.getItem('analysis-selection');
      if (stored) return JSON.parse(stored);
    } catch { /* ignore */ }
    return null;
  }, []);

  const analysis = useMemo<Analysis>(() => {
    if (record) return buildAnalysisFromRecord(record, storedContext);
    return buildAnalysisFromRecord(
      {
        id: analysisId,
        user_id: '',
        repository_id: '',
        repository_full_name: storedContext?.repository?.fullName || '',
        repository_owner: storedContext?.repository?.owner || '',
        repository_name: storedContext?.repository?.name || '',
        issue_number: storedContext?.issue?.number || 0,
        issue_title: storedContext?.issue?.title || '',
        status: 'queued',
        current_stage: 'issue_context',
        error_message: null,
        total_files: 0,
        filtered_files: 0,
        fingerprint: null,
        ai_provider: null,
        ai_model: null,
        ai_tier: null,
        ai_tokens_input: null,
        ai_tokens_output: null,
        ai_duration_ms: null,
        model_config: null,
        model_selection: null,
        patch_status: null,
        created_branch: null,
        commit_sha: null,
        commit_message: null,
        changed_files: null,
        applied_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        completed_at: null,
      },
      storedContext
    );
  }, [record, analysisId, storedContext]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(`/api/analyses/${analysisId}`);
        if (cancelled) return;
        if (response.status === 404) {
          setError('Analysis not found');
          setLoading(false);
          return;
        }
        if (!response.ok) throw new Error('Failed to fetch analysis');
        const data = await response.json();
        if (cancelled) return;
        setRecord(data.analysis);
        setLoading(false);

        if (prevStatusRef.current && prevStatusRef.current !== data.analysis.status) {
          if (data.analysis.status === 'ready_for_analysis') {
            toast.success('Repository index ready!');
          } else if (data.analysis.status === 'relevant_files_ready') {
            toast.success('Relevant files discovered!');
          } else if (data.analysis.status === 'failed') {
            toast.error(data.analysis.error_message || 'Analysis failed');
          }
        }
        prevStatusRef.current = data.analysis.status;
      } catch {
        if (!cancelled) {
          setError('Failed to load analysis');
          setLoading(false);
        }
      }
    };
    load();
    return () => { cancelled = true; };
  }, [analysisId]);

  useEffect(() => {
    if (!record) return;

    const isActive = ['queued', 'initializing', 'indexing', 'relevant_file_discovery', 'relevant_files_fetch', 'relevant_files_discovery', 'analyzing'].includes(record.status);
    const isAtStage = ['ready_for_analysis', 'relevant_files_ready', 'root_cause_complete', 'evidence_complete', 'solution_complete'].includes(record.status);
    const shouldPoll = pendingStart || isActive || isAtStage;
    if (!shouldPoll) return;

    const pollInterval = (pendingStart || isActive) ? 2000 : 4000;

    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(`/api/analyses/${analysisId}`);
        if (cancelled || !response.ok) return;
        const data = await response.json();
        if (cancelled) return;

        const prevStatus = prevStatusRef.current;
        setRecord(data.analysis);

        if (prevStatus && prevStatus !== data.analysis.status) {
          setPendingStart(false);
          if (data.analysis.status === 'ready_for_analysis') {
            toast.success('Repository index ready!');
          } else if (data.analysis.status === 'relevant_files_ready') {
            toast.success('Relevant files discovered!');
          } else if (data.analysis.status === 'root_cause_complete') {
            toast.success('Root cause analysis complete!');
          } else if (data.analysis.status === 'evidence_complete') {
            toast.success('Evidence extraction complete!');
          } else if (data.analysis.status === 'solution_complete') {
            toast.success('Solution generation complete!');
          } else if (data.analysis.status === 'completed') {
            toast.success('Analysis complete!');
          } else if (data.analysis.status === 'failed') {
            setPendingStart(false);
            toast.error(data.analysis.error_message || 'Analysis failed');
          }
        }
        prevStatusRef.current = data.analysis.status;
      } catch { /* ignore */ }
    };

    pollRef.current = setInterval(poll, pollInterval);
    return () => {
      cancelled = true;
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [record?.status, analysisId, pendingStart]);

  useEffect(() => {
    if (record?.status === 'ready_for_analysis' || record?.status === 'relevant_files_ready' || record?.status === 'root_cause_complete' || record?.status === 'evidence_complete' || record?.status === 'solution_complete' || record?.status === 'completed') {
      let cancelled = false;
      const load = async () => {
        try {
          const [filesRes, issueRes, commentsRes, relevantRes, rootCauseRes, evidenceRes, solutionRes, patchRes] = await Promise.all([
            fetch(`/api/analyses/${analysisId}/repository-files`),
            fetch(`/api/analyses/${analysisId}/artifacts/issue_context`),
            fetch(`/api/analyses/${analysisId}/artifacts/issue_comments`),
            fetch(`/api/analyses/${analysisId}/artifacts/relevant_files`),
            fetch(`/api/analyses/${analysisId}/artifacts/root_cause`),
            fetch(`/api/analyses/${analysisId}/artifacts/evidence`),
            fetch(`/api/analyses/${analysisId}/artifacts/solution`),
            fetch(`/api/analyses/${analysisId}/artifacts/patch`),
          ]);
          if (cancelled) return;
          if (filesRes.ok) {
            const data = await filesRes.json();
            setRepositoryFiles(data.files || []);
          }
          if (issueRes.ok) {
            const data = await issueRes.json();
            setIssueContext(data.artifact?.data || null);
          }
          if (commentsRes.ok) {
            const data = await commentsRes.json();
            setComments(data.artifact?.data?.comments || []);
          }
          if (relevantRes.ok) {
            const data = await relevantRes.json();
            setRelevantFiles(data.artifact?.data?.files || []);
          }
          if (rootCauseRes.ok) {
            const data = await rootCauseRes.json();
            if (data.artifact?.data) {
              setRootCause({
                summary: data.artifact.data.rootCause?.summary || '',
                description: data.artifact.data.rootCause?.explanation || '',
                confidence: data.artifact.data.rootCause?.confidence || 0,
                affectedFiles: data.artifact.data.affectedFiles?.map((f: { path: string }) => f.path) || [],
              });
            }
          }
          if (evidenceRes.ok) {
            const data = await evidenceRes.json();
            if (data.artifact?.data) {
              setEvidence({
                status: data.artifact.data.status || 'evidence_found',
                description: data.artifact.data.description || '',
                reason: data.artifact.data.reason,
                confidence: data.artifact.data.confidence,
                evidence: data.artifact.data.evidence || [],
              });
            }
          }
          if (solutionRes.ok) {
            const data = await solutionRes.json();
            if (data.artifact?.data) {
              setSolution({
                summary: data.artifact.data.summary || '',
                description: data.artifact.data.description || '',
                steps: data.artifact.data.steps || [],
                affectedFiles: data.artifact.data.affectedFiles || [],
                risks: data.artifact.data.risks || [],
                confidence: data.artifact.data.confidence || 0,
              });
            }
          }
          if (patchRes.ok) {
            const data = await patchRes.json();
            if (data.artifact?.data) {
              setPatch({
                summary: data.artifact.data.summary || '',
                files: data.artifact.data.files || [],
              });
            }
          }
        } catch { /* ignore */ }
      };
      load();
      return () => { cancelled = true; };
    }
  }, [record?.status, analysisId]);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const refreshRecord = async () => {
    const refreshRes = await fetch(`/api/analyses/${analysisId}`);
    if (refreshRes.ok) {
      const data = await refreshRes.json();
      setRecord(data.analysis);
    }
  };

  const handleStartDiscovery = async () => {
    setStartingDiscovery(true);
    setPendingStart(true);
    try {
      const response = await fetch(`/api/analyses/${analysisId}/relevant-files`, { method: 'POST' });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to start discovery');
      }
      toast.success('Starting relevant file discovery...');
      await refreshRecord();
    } catch (err) {
      const e = err as Error;
      toast.error(e.message || 'Failed to start discovery');
    } finally {
      setStartingDiscovery(false);
    }
  };

  const handleStartRootCause = async (isRerun = false) => {
    setStartingRootCause(true);
    setPendingStart(true);
    try {
      const response = await fetch(`/api/analyses/${analysisId}/root-cause`, { method: 'POST' });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to start root cause analysis');
      }
      toast.success(isRerun ? 'Re-running root cause analysis...' : 'Starting root cause analysis...');
      await refreshRecord();
    } catch (err) {
      const e = err as Error;
      toast.error(e.message || 'Failed to start root cause analysis');
    } finally {
      setStartingRootCause(false);
    }
  };

  const handleStartEvidence = async (isRerun = false) => {
    setStartingEvidence(true);
    setPendingStart(true);
    try {
      const response = await fetch(`/api/analyses/${analysisId}/evidence`, { method: 'POST' });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to start evidence extraction');
      }
      toast.success(isRerun ? 'Re-running evidence extraction...' : 'Starting evidence extraction...');
      await refreshRecord();
    } catch (err) {
      const e = err as Error;
      toast.error(e.message || 'Failed to start evidence extraction');
    } finally {
      setStartingEvidence(false);
    }
  };

  const handleStartSolution = async (isRerun = false) => {
    setStartingSolution(true);
    setPendingStart(true);
    try {
      const response = await fetch(`/api/analyses/${analysisId}/solution`, { method: 'POST' });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to start solution generation');
      }
      toast.success(isRerun ? 'Re-generating solution...' : 'Starting solution generation...');
      await refreshRecord();
    } catch (err) {
      const e = err as Error;
      toast.error(e.message || 'Failed to start solution generation');
    } finally {
      setStartingSolution(false);
    }
  };

  const handleStartPatch = async (isRerun = false) => {
    setStartingPatch(true);
    setPendingStart(true);
    try {
      const response = await fetch(`/api/analyses/${analysisId}/patch`, { method: 'POST' });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to start patch generation');
      }
      toast.success(isRerun ? 'Re-generating patch...' : 'Starting patch generation...');
      await refreshRecord();
    } catch (err) {
      const e = err as Error;
      toast.error(e.message || 'Failed to start patch generation');
    } finally {
      setStartingPatch(false);
    }
  };

  const handleStageClick = useCallback((stage: AnalysisStageInfo) => {
    const tabMap: Record<string, ActiveTab> = {
      'REPOSITORY': 'overview',
      'ISSUE': 'overview',
      'RELEVANT_FILES': 'files',
      'ROOT_CAUSE': 'root-cause',
      'EVIDENCE': 'evidence',
      'SOLUTION': 'solution',
      'PATCH': 'patch',
    };
    const tab = tabMap[stage.stage];
    if (tab) setActiveTab(tab);
  }, []);

  const anyStageRunning = startingDiscovery || startingRootCause || startingEvidence || startingSolution || startingPatch || record?.status === 'relevant_file_discovery' || record?.status === 'relevant_files_fetch' || record?.status === 'relevant_files_discovery' || record?.status === 'analyzing' || record?.status === 'queued' || record?.status === 'initializing' || record?.status === 'indexing';
  const isRunning = anyStageRunning;
  const isComplete = record?.status === 'completed';
  const isFailed = record?.status === 'failed';
  const isDiscoveryReady = record?.status === 'ready_for_analysis' || (record?.status === 'failed' && record?.current_stage === 'relevant_files_discovery');
  const isDiscoveryRunning = record?.status === 'relevant_file_discovery' || record?.status === 'relevant_files_fetch' || record?.status === 'relevant_files_discovery';
  const isRootCauseReady = record?.status === 'relevant_files_ready' || (record?.status === 'failed' && record?.current_stage === 'root_cause_analysis');
  const isRootCauseRunning = record?.status === 'analyzing' && record?.current_stage === 'root_cause_analysis';
  const isEvidenceReady = record?.status === 'root_cause_complete' || (record?.status === 'failed' && record?.current_stage === 'evidence_extraction');
  const isEvidenceRunning = record?.status === 'analyzing' && record?.current_stage === 'evidence_extraction';
  const isSolutionReady = record?.status === 'evidence_complete' || (record?.status === 'failed' && record?.current_stage === 'solution_generation');
  const isSolutionRunning = record?.status === 'analyzing' && record?.current_stage === 'solution_generation';
  const isPatchReady = record?.status === 'solution_complete' || (record?.status === 'failed' && record?.current_stage === 'patch_generation');
  const isPatchRunning = record?.status === 'analyzing' && record?.current_stage === 'patch_generation';

  const showProgress = isRunning || isFailed || record?.status === 'ready_for_analysis' || record?.status === 'relevant_files_ready' || record?.status === 'root_cause_complete' || record?.status === 'evidence_complete' || record?.status === 'solution_complete';
  const showMainContent = isDiscoveryReady || isDiscoveryRunning || isComplete || isRootCauseReady || isEvidenceReady || isSolutionReady || isPatchReady || record?.status === 'relevant_files_ready' || record?.status === 'root_cause_complete' || record?.status === 'evidence_complete' || record?.status === 'solution_complete';

  return (
    <AppShell user={user}>
      <div className="flex h-[calc(100vh-48px)]">
        <div className="w-48 border-r border-border bg-surface-glass-sidebar p-3 hidden md:block overflow-y-auto scrollbar-thin">
          <AnalysisStepper stages={analysis.stages} onStageClick={handleStageClick} />
        </div>

        <div className="flex-1 overflow-auto p-6 surface-primary">
          {loading && (
            <div className="flex items-center justify-center py-16">
              <div className="flex items-center gap-3 text-bw-peach">
                <div className="w-5 h-5 border-2 border-primary-container/30 border-t-primary-container rounded-full animate-spin" />
                <span className="text-sm">Loading analysis...</span>
              </div>
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="w-12 h-12 rounded-full bg-error-container/20 flex items-center justify-center mb-4">
                <span className="text-error-default text-xl">✕</span>
              </div>
              <p className="text-sm text-bw-peach-light mb-4">{error}</p>
              <Button variant="outline" size="sm" className="border-border text-bw-peach" onClick={() => router.push('/analysis/new')}>
                Start New Analysis
              </Button>
            </div>
          )}

          {!loading && !error && showProgress && record && (
            <ProgressOverlay record={record} />
          )}

          {!loading && !error && showMainContent && record && (
            <>
              <AnalysisHeader analysis={analysis} />

              {(isComplete || record.status === 'ready_for_analysis' || record.status === 'relevant_files_ready' || isDiscoveryRunning) && (
                <div className="mb-6 p-4 rounded-lg bg-bw-surface border border-green-500/30 bg-green-500/5">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-2 h-2 rounded-full bg-green-500" />
                    <span className="text-sm font-semibold text-bw-peach-light">
                      {record.status === 'relevant_files_ready' ? 'Relevant Files Ready' : 
                       isDiscoveryRunning ? 'Discovering Relevant Files...' :
                       'Repository Index Ready'}
                    </span>
                  </div>
                  {record.fingerprint && (
                    <div className="flex flex-wrap gap-4 text-xs font-mono text-bw-peach mt-2">
                      {record.fingerprint.primaryLanguage && <span>{record.fingerprint.primaryLanguage}</span>}
                      {record.fingerprint.framework && <span>{record.fingerprint.framework}</span>}
                      {record.fingerprint.packageManager && <span>{record.fingerprint.packageManager}</span>}
                      <span>{record.filtered_files.toLocaleString()} files indexed</span>
                    </div>
                  )}
                </div>
              )}

              {(isDiscoveryReady || isDiscoveryRunning) && (
                <div className="mb-6">
                  <ModelTierPipeline
                    activeModel={isDiscoveryRunning ? (record.ai_model || null) : null}
                    fallbackChain={['nemotron-3.5-lightning-free', 'ling-3.0-flash-fin-free', 'mimo-v2.5-free', 'muse-spark-1.2-free']}
                    currentModel={record.ai_model || undefined}
                    provider={record.ai_provider || 'opencode-zen'}
                  />
                  <div className="mt-3">
                    <Button
                      onClick={handleStartDiscovery}
                      disabled={startingDiscovery || isDiscoveryRunning || anyStageRunning}
                      className="btn-bw-primary font-medium"
                    >
                      {startingDiscovery || isDiscoveryRunning ? (
                        <span className="flex items-center gap-2">
                          <span className="w-4 h-4 border-2 border-bw-peach-light/30 border-t-bw-peach-light rounded-full animate-spin" />
                          {isDiscoveryRunning ? 'Discovering Relevant Files...' : 'Starting...'}
                        </span>
                      ) : record?.status === 'failed' ? (
                        'Retry Discovery'
                      ) : (
                        'Start Relevant File Discovery'
                      )}
                    </Button>
                  </div>
                </div>
              )}

              {isRootCauseReady && (
                <div className="mb-6">
                  <ModelTierPipeline
                    activeModel={isRootCauseRunning ? (record.ai_model || null) : null}
                    fallbackChain={['nemotron-3.5-lightning-free', 'ling-3.0-flash-fin-free', 'mimo-v2.5-free', 'muse-spark-1.2-free']}
                    currentModel={record.ai_model || undefined}
                    provider={record.ai_provider || 'opencode-zen'}
                  />
                  <div className="mt-3 flex gap-2">
                    <Button
                      onClick={() => handleStartRootCause(false)}
                      disabled={startingRootCause || isRootCauseRunning || anyStageRunning}
                      className="btn-bw-primary font-medium"
                    >
                      {startingRootCause || isRootCauseRunning ? (
                        <span className="flex items-center gap-2">
                          <span className="w-4 h-4 border-2 border-bw-peach-light/30 border-t-bw-peach-light rounded-full animate-spin" />
                          Analyzing...
                        </span>
                      ) : record?.status === 'failed' && record?.current_stage === 'root_cause_analysis' ? (
                        'Retry Root Cause Analysis'
                      ) : (
                        'Start Root Cause Analysis'
                      )}
                    </Button>
                    {record?.status === 'root_cause_complete' && (
                      <Button
                        onClick={() => handleStartRootCause(true)}
                        disabled={startingRootCause || anyStageRunning}
                        variant="outline"
                        className="border-border text-bw-peach"
                      >
                        Re-run
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {isEvidenceReady && (
                <div className="mb-6">
                  <ModelTierPipeline
                    activeModel={isEvidenceRunning ? (record.ai_model || null) : null}
                    fallbackChain={['nemotron-3.5-lightning-free', 'ling-3.0-flash-fin-free', 'mimo-v2.5-free', 'muse-spark-1.2-free']}
                    currentModel={record.ai_model || undefined}
                    provider={record.ai_provider || 'opencode-zen'}
                  />
                  <div className="mt-3 flex gap-2">
                    <Button
                      onClick={() => handleStartEvidence(false)}
                      disabled={startingEvidence || isEvidenceRunning || anyStageRunning}
                      className="btn-bw-primary font-medium"
                    >
                      {startingEvidence || isEvidenceRunning ? (
                        <span className="flex items-center gap-2">
                          <span className="w-4 h-4 border-2 border-bw-peach-light/30 border-t-bw-peach-light rounded-full animate-spin" />
                          Extracting...
                        </span>
                      ) : record?.status === 'failed' && record?.current_stage === 'evidence_extraction' ? (
                        'Retry Evidence Extraction'
                      ) : (
                        'Start Evidence Extraction'
                      )}
                    </Button>
                    {record?.status === 'evidence_complete' && (
                      <Button
                        onClick={() => handleStartEvidence(true)}
                        disabled={startingEvidence || anyStageRunning}
                        variant="outline"
                        className="border-border text-bw-peach"
                      >
                        Re-run
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {isSolutionReady && (
                <div className="mb-6">
                  <ModelTierPipeline
                    activeModel={isSolutionRunning ? (record.ai_model || null) : null}
                    fallbackChain={['nemotron-3.5-lightning-free', 'ling-3.0-flash-fin-free', 'mimo-v2.5-free', 'muse-spark-1.2-free']}
                    currentModel={record.ai_model || undefined}
                    provider={record.ai_provider || 'opencode-zen'}
                  />
                  <div className="mt-3 flex gap-2">
                    <Button
                      onClick={() => handleStartSolution(false)}
                      disabled={startingSolution || isSolutionRunning || anyStageRunning}
                      className="btn-bw-primary font-medium"
                    >
                      {startingSolution || isSolutionRunning ? (
                        <span className="flex items-center gap-2">
                          <span className="w-4 h-4 border-2 border-bw-peach-light/30 border-t-bw-peach-light rounded-full animate-spin" />
                          Generating...
                        </span>
                      ) : record?.status === 'failed' && record?.current_stage === 'solution_generation' ? (
                        'Retry Solution Generation'
                      ) : (
                        'Start Solution Generation'
                      )}
                    </Button>
                    {record?.status === 'solution_complete' && (
                      <Button
                        onClick={() => handleStartSolution(true)}
                        disabled={startingSolution || anyStageRunning}
                        variant="outline"
                        className="border-border text-bw-peach"
                      >
                        Re-run
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {isPatchReady && (
                <div className="mb-6">
                  <ModelTierPipeline
                    activeModel={isPatchRunning ? (record.ai_model || null) : null}
                    fallbackChain={['nemotron-3.5-lightning-free', 'ling-3.0-flash-fin-free', 'mimo-v2.5-free', 'muse-spark-1.2-free']}
                    currentModel={record.ai_model || undefined}
                    provider={record.ai_provider || 'opencode-zen'}
                  />
                  <div className="mt-3 flex gap-2">
                    <Button
                      onClick={() => handleStartPatch(false)}
                      disabled={startingPatch || isPatchRunning || anyStageRunning}
                      className="btn-bw-primary font-medium"
                    >
                      {startingPatch || isPatchRunning ? (
                        <span className="flex items-center gap-2">
                          <span className="w-4 h-4 border-2 border-bw-peach-light/30 border-t-bw-peach-light rounded-full animate-spin" />
                          Generating...
                        </span>
                      ) : record?.status === 'failed' && record?.current_stage === 'patch_generation' ? (
                        'Retry Patch Generation'
                      ) : (
                        'Start Patch Generation'
                      )}
                    </Button>
                    {isComplete && (
                      <Button
                        onClick={() => handleStartPatch(true)}
                        disabled={startingPatch || anyStageRunning}
                        variant="outline"
                        className="border-border text-bw-peach"
                      >
                        Re-run
                      </Button>
                    )}
                  </div>
                </div>
              )}

              <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
                {(['overview', 'files', 'root-cause', 'evidence', 'solution', 'patch'] as ActiveTab[]).map((tab) => {
                  const isTabLocked = (tab === 'files' && !relevantFiles.length && !record?.status?.startsWith('relevant')) ||
                    (tab === 'root-cause' && !rootCause && !isRootCauseReady && !isRootCauseRunning && record?.status !== 'root_cause_complete') ||
                    (tab === 'evidence' && !evidence && !isEvidenceReady && !isEvidenceRunning && record?.status !== 'evidence_complete') ||
                    (tab === 'solution' && !solution && !isSolutionReady && !isSolutionRunning && record?.status !== 'solution_complete') ||
                    (tab === 'patch' && !patch && !isPatchReady && !isPatchRunning && !isComplete);

                  return (
                    <Button
                      key={tab}
                      variant={activeTab === tab ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => setActiveTab(tab)}
                      disabled={isTabLocked && activeTab !== tab}
                      className={activeTab === tab ? 'bg-primary-container text-on-primary-container font-medium' : 'text-bw-peach hover:text-bw-peach-light'}
                    >
                      {tab === 'root-cause' ? 'Root Cause' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </Button>
                  );
                })}
              </div>

              <AnalysisTabContent
                activeTab={activeTab}
                analysis={{
                  ...analysis,
                  rootCause: rootCause || analysis.rootCause,
                  evidence: evidence || analysis.evidence,
                  solution: solution || analysis.solution,
                  patch: patch || analysis.patch,
                }}
                record={record}
                repositoryFiles={repositoryFiles}
                relevantFiles={relevantFiles}
                issueContext={issueContext}
                comments={comments}
              />
            </>
          )}
        </div>

        <AnalysisDetailsSidebar
          analysis={analysis}
          record={record}
          isRunning={isRunning}
          isComplete={isComplete}
          isFailed={isFailed}
        />
      </div>
    </AppShell>
  );
}
