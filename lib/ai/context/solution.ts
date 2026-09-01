import { IssueContext, IssueComment, RepositoryFingerprint, RelevantFile, RootCauseResult, EvidenceResult } from '@/types';

export interface SolutionContext {
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
  rootCause: RootCauseResult;
  evidence?: EvidenceResult | null;
}

export interface BuiltSolutionContext {
  messages: Array<{ role: 'system' | 'user'; content: string }>;
  estimatedTokens: number;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function truncateSourceCode(content: string, maxLines: number = 200): string {
  const lines = content.split('\n');
  if (lines.length <= maxLines) return content;
  return lines.slice(0, maxLines).join('\n') + '\n// ... truncated ...';
}

export function buildSolutionContext(context: SolutionContext): BuiltSolutionContext {
  const issueBlock = `Issue #${context.issue.number}: ${context.issue.title}
State: ${context.issue.state}
Description:
${context.issue.body.slice(0, 2000)}`;

  const rootCauseBlock = `\n\nRoot Cause Analysis:
Summary: ${context.rootCause.rootCause.summary}
Explanation: ${context.rootCause.rootCause.explanation}
Confidence: ${context.rootCause.rootCause.confidence}`;

  let evidenceBlock: string;
  if (context.evidence && context.evidence.evidence && context.evidence.evidence.length > 0) {
    evidenceBlock = `\n\nEvidence:
Description: ${context.evidence.description}

Evidence References:
${context.evidence.evidence.map((e) => `- ${e.file} (${e.lineStart}-${e.lineEnd}): ${e.explanation}`).join('\n')}`;
  } else if (context.evidence?.status === 'no_evidence') {
    evidenceBlock = `\n\nEvidence Status: No strong evidence found.
Reason: ${context.evidence.reason || 'The evidence extraction did not find concrete code-level evidence.'}
Note: Proceed with the solution based on root cause analysis and available source code. Adjust confidence accordingly.`;
  } else {
    evidenceBlock = `\n\nEvidence Status: Not yet analyzed.
Note: Proceed with the solution based on root cause analysis and available source code.`;
  }

  const relevantFilesBlock = `\n\nRelevant Files (${context.relevantFiles.length}):
${context.relevantFiles
  .map((f) => `- ${f.path} (${f.language}, relevance: ${Math.round(f.relevanceScore * 100)}%)`)
  .join('\n')}`;

  const sourceCodeBlocks = context.sourceFiles
    .slice(0, 8)
    .map((sf) => `\n\n--- ${sf.path} (${sf.language}, ${sf.size} bytes) ---\n${truncateSourceCode(sf.content)}`)
    .join('');

  const systemMessage = `You are BugWiser Solution Generation Engine.

TASK: Generate a proposed solution to fix the identified root cause.

RULES:
- Base the solution on the root cause analysis and available evidence
- If evidence is unavailable, rely more heavily on root cause analysis and source code inspection
- Provide clear, actionable steps
- Consider potential side effects and risks
- Estimate confidence in the solution — lower confidence when evidence is absent
- Do NOT generate patches yet (that comes later)
- Focus on the approach and rationale
- When evidence is absent, acknowledge the uncertainty in your confidence score

OUTPUT: Valid JSON with this exact structure:
{
  "summary": "Brief one-line summary of the solution",
  "description": "Detailed explanation of the proposed solution",
  "steps": [
    "Step 1: Describe what to do",
    "Step 2: Describe what to do next"
  ],
  "affectedFiles": [
    {
      "path": "src/example.ts",
      "change": "Description of what needs to change"
    }
  ],
  "risks": [
    "Potential side effect or risk"
  ],
  "confidence": 0.85
}`;

  const userMessage = `${issueBlock}${rootCauseBlock}${evidenceBlock}${relevantFilesBlock}${sourceCodeBlocks}`;

  const estimatedTokens = estimateTokens(systemMessage + userMessage);

  return {
    messages: [
      { role: 'system', content: systemMessage },
      { role: 'user', content: userMessage },
    ],
    estimatedTokens,
  };
}
