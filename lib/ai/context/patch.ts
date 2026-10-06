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

PATCH STRUCTURE RULES (a patch that breaks any of these is rejected before it is stored):
- Copy context lines VERBATIM from the provided source code. Never reformat, reindent or paraphrase them.
- The OLD side of a hunk (all context + removed entries) must be a CONTIGUOUS run of file lines, in file order. Include blank lines as "context" entries — never skip a line between two context lines.
- Start and end every hunk with at least one context line. A hunk containing only "added" entries has nothing to locate it in the file and is rejected.
- Every "removed" entry must be a line you copied verbatim from the file. Never remove a line you did not quote.
- "oldLines" must equal the number of context + removed entries in that hunk. "newLines" must equal the number of context + added entries.
- Emit exactly ONE physical line per entry. Never put two lines into a single "content" value.
- oldStart / newStart are advisory only; content matching finds the real location, but keep them as accurate as you can.
- The file must still be syntactically valid after your change (balanced braces, no stray lines).

OUTPUT: Valid JSON with this exact structure.
Note how oldLines (4) counts context + removed, newLines (5) counts context + added, and the blank line is kept as a context entry so the block stays contiguous:
{
  "summary": "Brief summary of the patch",
  "files": [
    {
      "path": "src/example.js",
      "hunks": [
        {
          "oldStart": 42,
          "oldLines": 4,
          "newStart": 42,
          "newLines": 5,
          "lines": [
            {
              "type": "context",
              "content": "function total(items) {"
            },
            {
              "type": "context",
              "content": ""
            },
            {
              "type": "removed",
              "content": "  return subtotal - discount;"
            },
            {
              "type": "added",
              "content": "  const net = subtotal - discount;"
            },
            {
              "type": "added",
              "content": "  return net;"
            },
            {
              "type": "context",
              "content": "}"
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
