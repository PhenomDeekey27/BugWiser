import { IssueContext, IssueComment, RepositoryFingerprint } from '@/types';

const SAFETY_MARGIN = 0.7;

export interface RelevantFileContext {
  issue: IssueContext;
  comments: IssueComment[];
  fingerprint: RepositoryFingerprint;
  files: Array<{
    path: string;
    language: string;
    size: number;
    isIgnored: boolean;
  }>;
  contextLimit: number;
}

export interface BuiltContext {
  messages: Array<{ role: 'system' | 'user'; content: string }>;
  estimatedTokens: number;
  contextReduced: boolean;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function truncateToBudget(
  files: RelevantFileContext['files'],
  budget: number
): RelevantFileContext['files'] {
  const activeFiles = files.filter((f) => !f.isIgnored);
  const sorted = [...activeFiles].sort((a, b) => {
    const aScore = a.path.includes('/') ? 1 : 0;
    const bScore = b.path.includes('/') ? 1 : 0;
    return bScore - aScore;
  });

  let totalTokens = 0;
  const result: RelevantFileContext['files'] = [];

  for (const file of sorted) {
    const fileTokens = estimateTokens(file.path + ' ' + file.language);
    if (totalTokens + fileTokens > budget) break;
    result.push(file);
    totalTokens += fileTokens;
  }

  return result;
}

function buildFileManifest(
  files: RelevantFileContext['files']
): string {
  const activeFiles = files.filter((f) => !f.isIgnored);
  const byLanguage: Record<string, typeof activeFiles> = {};

  for (const file of activeFiles) {
    const lang = file.language || 'Other';
    if (!byLanguage[lang]) byLanguage[lang] = [];
    byLanguage[lang].push(file);
  }

  const lines: string[] = [];
  for (const [lang, langFiles] of Object.entries(byLanguage).sort(
    ([a], [b]) => a.localeCompare(b)
  )) {
    lines.push(`\n[${lang}] (${langFiles.length} files)`);
    for (const f of langFiles) {
      lines.push(`  ${f.path}`);
    }
  }

  return lines.join('\n');
}

function buildDirectorySummary(
  files: RelevantFileContext['files']
): string {
  const activeFiles = files.filter((f) => !f.isIgnored);
  const dirs: Record<string, number> = {};

  for (const file of activeFiles) {
    const parts = file.path.split('/');
    if (parts.length > 1) {
      dirs[parts[0]] = (dirs[parts[0]] || 0) + 1;
    }
  }

  return Object.entries(dirs)
    .sort(([, a], [, b]) => b - a)
    .map(([dir, count]) => `  ${dir}/ (${count} files)`)
    .join('\n');
}

export function buildRelevantFileContext(context: RelevantFileContext): BuiltContext {
  const usableBudget = Math.floor(
    context.contextLimit * SAFETY_MARGIN - 2000
  );

  const issueBlock = `Issue #${context.issue.number}: ${context.issue.title}
State: ${context.issue.state}
Labels: ${context.issue.labels.join(', ') || 'none'}
Author: ${context.issue.author}

Description:
${context.issue.body.slice(0, 2000)}`;

  const commentsBlock =
    context.comments.length > 0
      ? `\n\nTop Comments (${context.comments.length} total):\n${context.comments
          .slice(0, 5)
          .map((c) => `- ${c.author}: ${c.body.slice(0, 300)}`)
          .join('\n')}`
      : '';

  const fingerprintBlock = `\n\nRepository Fingerprint:
Language: ${context.fingerprint.primaryLanguage || 'Unknown'}
Framework: ${context.fingerprint.framework || 'Unknown'}
Package Manager: ${context.fingerprint.packageManager || 'Unknown'}
Project Type: ${context.fingerprint.projectType}
Active Files: ${context.fingerprint.activeFiles}
Source Dirs: ${context.fingerprint.sourceDirectories.join(', ') || 'root'}
Test Dirs: ${context.fingerprint.testDirectories.join(', ') || 'none'}`;

  const directorySummary = `\n\nDirectory Structure:\n${buildDirectorySummary(context.files)}`;

  const overhead = estimateTokens(issueBlock + commentsBlock + fingerprintBlock + directorySummary + 1500);
  const fileBudget = Math.max(500, usableBudget - overhead);
  const reducedFiles = truncateToBudget(context.files, fileBudget);
  const contextReduced = reducedFiles.length < context.files.filter((f) => !f.isIgnored).length;

  const fileManifest = `\n\nFile Manifest (${reducedFiles.filter((f) => !f.isIgnored).length} of ${context.files.filter((f) => !f.isIgnored).length} files):\n${buildFileManifest(reducedFiles)}`;

  const systemMessage = `You are BugWiser Relevant File Discovery Engine.

TASK: Given a GitHub issue and a repository file list, identify the files most likely related to the issue.

RULES:
- You MUST return at least 1 file, even if you are uncertain
- Return ONLY file paths that EXACTLY match paths in the provided File Manifest
- Rank by relevance (highest confidence first)
- Return 3-15 files maximum
- Each file needs: path (exact from manifest), confidence (0.0-1.0), reason (1 sentence)
- Do NOT solve the issue or generate code
- If unsure which files are relevant, pick the ones whose paths or names relate to keywords in the issue title

OUTPUT: Valid JSON only. No markdown, no explanation outside JSON.
{
  "relevantFiles": [
    {
      "path": "exact/path/from/manifest",
      "confidence": 0.9,
      "reason": "Brief reason"
    }
  ]
}`;

  const userMessage = `${issueBlock}${commentsBlock}${fingerprintBlock}${directorySummary}${fileManifest}`;

  const estimatedTokens = estimateTokens(systemMessage + userMessage);

  return {
    messages: [
      { role: 'system', content: systemMessage },
      { role: 'user', content: userMessage },
    ],
    estimatedTokens,
    contextReduced,
  };
}
