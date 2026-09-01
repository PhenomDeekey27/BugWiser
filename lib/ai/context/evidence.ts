import { IssueContext, IssueComment, RepositoryFingerprint, RelevantFile, RootCauseResult } from '@/types';

export interface EvidenceContext {
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
}

export interface BuiltEvidenceContext {
  messages: Array<{ role: 'system' | 'user'; content: string }>;
  estimatedTokens: number;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function truncateSourceCode(content: string, maxLines: number = 300): string {
  const lines = content.split('\n');
  if (lines.length <= maxLines) return content;
  return lines.slice(0, maxLines).join('\n') + '\n// ... truncated ...';
}

export function buildEvidenceContext(context: EvidenceContext): BuiltEvidenceContext {
  const issueBlock = `Issue #${context.issue.number}: ${context.issue.title}
State: ${context.issue.state}
Description:
${context.issue.body.slice(0, 2000)}`;

  const rootCauseBlock = `\n\nRoot Cause Analysis:
Summary: ${context.rootCause.rootCause.summary}
Explanation: ${context.rootCause.rootCause.explanation}
Confidence: ${context.rootCause.rootCause.confidence}

Affected Files:
${context.rootCause.affectedFiles.map((f) => `- ${f.path}: ${f.reason}`).join('\n')}

Preliminary Evidence from Root Cause:
${context.rootCause.evidence.map((e) => `- ${e.file} (${e.lineStart}-${e.lineEnd}): ${e.explanation}`).join('\n')}`;

  const relevantFilesBlock = `\n\nRelevant Files (${context.relevantFiles.length}):
${context.relevantFiles
  .map((f) => `- ${f.path} (${f.language}, relevance: ${Math.round(f.relevanceScore * 100)}%)`)
  .join('\n')}`;

  const sourceCodeBlocks = context.sourceFiles
    .slice(0, 10)
    .map((sf) => `\n\n--- ${sf.path} (${sf.language}, ${sf.size} bytes) ---\n${truncateSourceCode(sf.content)}`)
    .join('');

  const systemMessage = `You are BugWiser Evidence Extraction Engine.

TASK: Extract concrete evidence from the source code that supports the identified root cause.

CRITICAL RULES:
- Only report evidence that is ACTUALLY PRESENT in the provided source code
- Never invent file paths, line numbers, symbols, or code
- Never infer that evidence exists simply because a root cause was proposed
- If the available context is insufficient to find concrete evidence, return "no_evidence"
- A "no_evidence" result is a VALID outcome and should be returned instead of hallucinating
- CSS, styling, layout, and responsive issues often have no direct code-level evidence — this is expected
- For styling/layout issues, evidence may be in CSS properties, media queries, or component structure

WHEN TO RETURN "no_evidence":
- The issue is about styling, layout, or visual behavior not directly traceable to code logic
- The source code provided does not contain the affected files
- The code changes required are design decisions, not bug fixes
- There are no specific code sections that can be pointed to as evidence

OUTPUT: Valid JSON with this exact structure:
{
  "status": "evidence_found" | "no_evidence",
  "description": "Overall description of the evidence (or explanation of why no evidence was found)",
  "reason": "When status is no_evidence, explain why",
  "confidence": 0.0-1.0,
  "evidence": [
    {
      "file": "src/example.ts",
      "lineStart": 42,
      "lineEnd": 58,
      "code": "actual code from the file",
      "explanation": "How this code relates to the issue",
      "type": "direct" | "supporting"
    }
  ]
}

When returning "no_evidence":
- Set "status": "no_evidence"
- Set "description" to explain what was analyzed
- Set "reason" to explain why no concrete evidence could be found
- Set "confidence" to reflect overall certainty
- Set "evidence" to an empty array []`;

  const userMessage = `${issueBlock}${rootCauseBlock}${relevantFilesBlock}${sourceCodeBlocks}`;

  const estimatedTokens = estimateTokens(systemMessage + userMessage);

  return {
    messages: [
      { role: 'system', content: systemMessage },
      { role: 'user', content: userMessage },
    ],
    estimatedTokens,
  };
}
