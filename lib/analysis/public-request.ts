// Pure validation for a public-analysis request.
//
// Extracted from the route so the rules that decide whether an issue can be
// investigated at all are testable without a request context, a session, or
// the network.

import {
  normalizeCommitSha,
  parseGitHubIssueUrl,
  parsePublicRepositoryUrl,
  type ParsedIssueUrl,
  type ParsedRepositoryUrl,
} from '../github/public.ts';

export const PUBLIC_ANALYSIS_LIMITS = {
  minDescriptionLength: 20,
  maxDescriptionLength: 20_000,
  maxTitleLength: 200,
} as const;

export interface PublicAnalysisInput {
  repositoryUrl: string;
  commit?: string | null;
  issueUrl?: string | null;
  issueNumber?: unknown;
  description?: string | null;
  title?: string | null;
}

export type PublicAnalysisValidation =
  | {
      ok: true;
      repository: ParsedRepositoryUrl;
      commit: string | null;
      issue: ParsedIssueUrl | null;
      issueNumber: number | null;
      description: string | null;
      title: string;
    }
  | {
      ok: false;
      code:
        | 'invalid_url'
        | 'invalid_issue_url'
        | 'invalid_issue_number'
        | 'issue_repository_mismatch'
        | 'invalid_commit'
        | 'description_too_short'
        | 'description_too_long';
      message: string;
    };

/**
 * Validates the parts of the request that do not need GitHub data. Repository
 * metadata, the commit, and the issue itself are still resolved server-side.
 */
export function validatePublicAnalysisInput(
  input: PublicAnalysisInput
): PublicAnalysisValidation {
  let repository: ParsedRepositoryUrl;
  try {
    repository = parsePublicRepositoryUrl(input.repositoryUrl);
  } catch (error) {
    return {
      ok: false,
      code: 'invalid_url',
      message: error instanceof Error ? error.message : 'Repository URL is not valid.',
    };
  }

  let commit: string | null = null;
  if (typeof input.commit === 'string' && input.commit.trim()) {
    commit = normalizeCommitSha(input.commit);
    if (!commit) {
      return {
        ok: false,
        code: 'invalid_commit',
        message: 'Commit must be a full 40-character SHA.',
      };
    }
  }

  if (typeof input.issueUrl === 'string' && input.issueUrl.trim()) {
    let issue: ParsedIssueUrl;
    try {
      issue = parseGitHubIssueUrl(input.issueUrl);
    } catch (error) {
      return {
        ok: false,
        code: 'invalid_issue_url',
        message: error instanceof Error ? error.message : 'Issue URL is not valid.',
      };
    }

    if (issue.fullName.toLowerCase() !== repository.fullName.toLowerCase()) {
      return {
        ok: false,
        code: 'issue_repository_mismatch',
        message: `The issue belongs to ${issue.fullName}, not ${repository.fullName}.`,
      };
    }

    return {
      ok: true,
      repository,
      commit,
      issue,
      issueNumber: null,
      description: null,
      title: issue.fullName,
    };
  }

  if (input.issueNumber !== undefined && input.issueNumber !== null) {
    const requested = input.issueNumber;
    if (
      typeof requested !== 'number' ||
      !Number.isSafeInteger(requested) ||
      requested <= 0
    ) {
      return {
        ok: false,
        code: 'invalid_issue_number',
        message: 'Issue number must be a positive integer.',
      };
    }

    return {
      ok: true,
      repository,
      commit,
      issue: null,
      issueNumber: requested,
      description: null,
      title: `Issue #${requested}`,
    };
  }

  const description = typeof input.description === 'string' ? input.description.trim() : '';
  if (description.length < PUBLIC_ANALYSIS_LIMITS.minDescriptionLength) {
    return {
      ok: false,
      code: 'description_too_short',
      message: `Describe the issue in at least ${PUBLIC_ANALYSIS_LIMITS.minDescriptionLength} characters, or link a GitHub issue.`,
    };
  }
  if (description.length > PUBLIC_ANALYSIS_LIMITS.maxDescriptionLength) {
    return {
      ok: false,
      code: 'description_too_long',
      message: `The issue description is too long (maximum ${PUBLIC_ANALYSIS_LIMITS.maxDescriptionLength.toLocaleString()} characters).`,
    };
  }

  const firstLine =
    description.split('\n').map((line) => line.trim()).find(Boolean) || 'Reported issue';
  const requestedTitle =
    typeof input.title === 'string' && input.title.trim()
      ? input.title.trim().slice(0, PUBLIC_ANALYSIS_LIMITS.maxTitleLength)
      : firstLine.slice(0, PUBLIC_ANALYSIS_LIMITS.maxTitleLength);

  return {
    ok: true,
    repository,
    commit,
    issue: null,
    issueNumber: null,
    description,
    title: requestedTitle,
  };
}
