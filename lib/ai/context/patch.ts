import { IssueContext, IssueComment, RepositoryFingerprint, RelevantFile, RootCauseResult, EvidenceResult, SolutionResult } from '@/types';

export interface PatchContext {
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
  solution: SolutionResult;
}

export interface BuiltPatchContext {
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

export function buildPatchContext(context: PatchContext): BuiltPatchContext {
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
  } else {
    evidenceBlock = `\n\nEvidence Status: No concrete evidence available.
Note: Generate the patch based on the solution and source code. Be conservative and only make changes that are clearly supported by the code.`;
  }

  const solutionBlock = `\n\nProposed Solution:
Summary: ${context.solution.summary}
Description: ${context.solution.description}

Steps:
${context.solution.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Affected Files:
${context.solution.affectedFiles.map((f) => `- ${f.path}: ${f.change}`).join('\n')}

Risks:
${context.solution.risks.map((r) => `- ${r}`).join('\n')}

Confidence: ${context.solution.confidence}`;

  const sourceCodeBlocks = context.sourceFiles
    .slice(0, 10)
    .map((sf) => `\n\n--- ${sf.path} (${sf.language}, ${sf.size} bytes) ---\n${truncateSourceCode(sf.content)}`)
    .join('');

  const systemMessage = `You are BugWiser Patch Generation Engine.

TASK: Generate a concrete code patch that implements the proposed solution.

CRITICAL RULES:
- Only modify files that are ACTUALLY provided in the source code
- Never invent file paths, symbols, or line numbers
- Generate actual code changes that fix the issue
- Use unified diff format for each file
- Ensure the patch is complete and can be applied
- Include proper context lines
- Do NOT modify files not related to the issue
- Follow the existing code style
- Preserve all existing functionality
- If you cannot safely generate a patch, return an empty files array with an explanation in summary
- For styling/CSS issues, focus on the actual CSS/component changes needed

OUTPUT: Valid JSON with this exact structure:
{
  "summary": "Brief summary of the patch",
  "files": [
    {
      "path": "src/example.ts",
      "hunks": [
        {
          "oldStart": 42,
          "oldLines": 10,
          "newStart": 42,
          "newLines": 12,
          "lines": [
            {
              "type": "context",
              "content": "  existing code line"
            },
            {
              "type": "removed",
              "content": "  line to remove"
            },
            {
              "type": "added",
              "content": "  new line to add"
            }
          ]
        }
      ]
    }
  ]
}`;

  const userMessage = `${issueBlock}${rootCauseBlock}${evidenceBlock}${solutionBlock}${sourceCodeBlocks}`;

  const estimatedTokens = estimateTokens(systemMessage + userMessage);

  return {
    messages: [
      { role: 'system', content: systemMessage },
      { role: 'user', content: userMessage },
    ],
    estimatedTokens,
  };
}
