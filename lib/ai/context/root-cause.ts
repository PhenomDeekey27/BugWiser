import { IssueContext, IssueComment, RepositoryFingerprint, RelevantFile } from '@/types';

export interface RootCauseContext {
  issue: IssueContext;
  comments: IssueComment[];
  fingerprint: RepositoryFingerprint;
  relevantFiles: RelevantFile[];
  sourceFiles: Array<{
    path: string;
    content: string;
    size: number;
    language: string;
  }>;
}

export interface BuiltRootCauseContext {
  messages: Array<{ role: 'system' | 'user'; content: string }>;
  estimatedTokens: number;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function truncateSourceCode(content: string, maxLines: number = 500): string {
  const lines = content.split('\n');
  if (lines.length <= maxLines) return content;
  return lines.slice(0, maxLines).join('\n') + '\n// ... truncated ...';
}

export function buildRootCauseContext(context: RootCauseContext): BuiltRootCauseContext {
  const issueBlock = `Issue #${context.issue.number}: ${context.issue.title}
State: ${context.issue.state}
Labels: ${context.issue.labels.join(', ') || 'none'}
Author: ${context.issue.author}

Description:
${context.issue.body.slice(0, 3000)}`;

  const commentsBlock =
    context.comments.length > 0
      ? `\n\nComments (${context.comments.length} total):\n${context.comments
          .slice(0, 10)
          .map((c) => `- ${c.author}: ${c.body.slice(0, 500)}`)
          .join('\n')}`
      : '';

  const fingerprintBlock = `\n\nRepository Fingerprint:
Language: ${context.fingerprint.primaryLanguage || 'Unknown'}
Framework: ${context.fingerprint.framework || 'Unknown'}
Package Manager: ${context.fingerprint.packageManager || 'Unknown'}
Project Type: ${context.fingerprint.projectType}
Active Files: ${context.fingerprint.activeFiles}
Source Dirs: ${context.fingerprint.sourceDirectories.join(', ') || 'root'}`;

  const relevantFilesBlock = `\n\nRelevant Files (${context.relevantFiles.length}):
${context.relevantFiles
  .map((f) => `- ${f.path} (${f.language}, relevance: ${Math.round(f.relevanceScore * 100)}%)
  Reason: ${f.description || f.reason || 'No reason provided'}`)
  .join('\n')}`;

  const sourceCodeBlocks = context.sourceFiles
    .slice(0, 10)
    .map((sf) => `\n\n--- ${sf.path} (${sf.language}, ${sf.size} bytes) ---\n${truncateSourceCode(sf.content)}`)
    .join('');

  const systemMessage = `You are BugWiser Root Cause Analysis Engine.

TASK: Analyze the GitHub issue and repository code to identify the root cause of the problem.

RULES:
- Analyze the issue description, comments, and relevant source code
- Identify the most likely root cause based on evidence
- Distinguish between confirmed evidence, strong inference, and weak inference
- Do NOT fabricate code or evidence
- If you cannot determine root cause with sufficient confidence, set confidence below 0.5
- Focus on the actual code that causes the issue

OUTPUT: Valid JSON with this exact structure:
{
  "rootCause": {
    "summary": "Brief one-line summary",
    "explanation": "Detailed explanation of the root cause",
    "confidence": 0.85
  },
  "affectedFiles": [
    {
      "path": "src/example.ts",
      "reason": "How this file contributes to the issue"
    }
  ],
  "evidence": [
    {
      "file": "src/example.ts",
      "lineStart": 42,
      "lineEnd": 58,
      "explanation": "What this code does and why it causes the issue"
    }
  ]
}`;

  const userMessage = `${issueBlock}${commentsBlock}${fingerprintBlock}${relevantFilesBlock}${sourceCodeBlocks}`;

  const estimatedTokens = estimateTokens(systemMessage + userMessage);

  return {
    messages: [
      { role: 'system', content: systemMessage },
      { role: 'user', content: userMessage },
    ],
    estimatedTokens,
  };
}
