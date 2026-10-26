// Verifies AI evidence claims against the source files that were actually
// retrieved for the analysis.
//
// The point is to stop the pipeline from presenting an invented file, line
// range, or snippet as verified evidence. Claims that cannot be confirmed are
// kept as hypotheses (visible to the user) or rejected outright.

export interface EvidenceClaimLike {
  file?: string;
  lineStart?: number;
  lineEnd?: number;
  code?: string;
  explanation?: string;
  type?: 'direct' | 'supporting';
  [key: string]: unknown;
}

export type EvidenceVerificationStatus = 'verified' | 'unverified' | 'rejected';

export interface EvidenceVerification {
  file: string;
  lineStart: number;
  lineEnd: number;
  status: EvidenceVerificationStatus;
  reason: string;
  correctedRange?: { lineStart: number; lineEnd: number };
}

export interface VerifiedEvidence<T extends EvidenceClaimLike> {
  claim: T;
  verification: EvidenceVerification;
}

export interface EvidenceVerificationReport<T extends EvidenceClaimLike> {
  verified: Array<VerifiedEvidence<T>>;
  unverified: Array<VerifiedEvidence<T>>;
  rejected: Array<VerifiedEvidence<T>>;
  summary: {
    total: number;
    verified: number;
    unverified: number;
    rejected: number;
    status: 'verified' | 'partial' | 'unverified';
  };
}

const MAX_CLAIM_LINES = 400;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function sourceLines(content: string): string[] {
  return content.split('\n');
}

function clampRange(
  claim: EvidenceClaimLike,
  lineCount: number
): { lineStart: number; lineEnd: number } | null {
  const start = Number(claim.lineStart);
  const end = Number(claim.lineEnd);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return null;
  if (start < 1 || end < start) return null;
  if (end > lineCount) return null;
  if (end - start + 1 > MAX_CLAIM_LINES) return null;
  return { lineStart: start, lineEnd: end };
}

function locateSnippet(lines: string[], code: string): { lineStart: number; lineEnd: number } | null {
  const wanted = code
    .split('\n')
    .map((line) => normalizeWhitespace(line))
    .filter((line) => line.length > 0);
  if (wanted.length === 0) return null;

  const normalized = lines.map((line) => normalizeWhitespace(line));
  const first = wanted[0];

  for (let index = 0; index < normalized.length; index++) {
    if (normalized[index] !== first && !normalized[index].includes(first)) continue;
    let matched = true;
    for (let offset = 1; offset < wanted.length; offset++) {
      const candidate = normalized[index + offset] || '';
      if (candidate !== wanted[offset] && !candidate.includes(wanted[offset])) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return { lineStart: index + 1, lineEnd: index + wanted.length };
    }
  }

  return null;
}

/**
 * Verifies every claim against a map of path -> exact source content.
 * `knownPaths` lets a claim for a file that exists in the repository but was
 * not fetched be reported as unverified instead of fabricated.
 */
export function verifyEvidenceClaims<T extends EvidenceClaimLike>(
  claims: readonly T[],
  sources: ReadonlyMap<string, string> | Readonly<Record<string, string>>,
  knownPaths?: readonly string[]
): EvidenceVerificationReport<T> {
  const sourceMap =
    sources instanceof Map ? sources : new Map(Object.entries(sources));
  const known = new Set(knownPaths ?? []);

  const verified: Array<VerifiedEvidence<T>> = [];
  const unverified: Array<VerifiedEvidence<T>> = [];
  const rejected: Array<VerifiedEvidence<T>> = [];

  for (const claim of claims) {
    const file = typeof claim.file === 'string' ? claim.file : '';
    const push = (
      status: EvidenceVerificationStatus,
      reason: string,
      correctedRange?: { lineStart: number; lineEnd: number }
    ): void => {
      const verification: EvidenceVerification = {
        file,
        lineStart: Number(claim.lineStart) || 0,
        lineEnd: Number(claim.lineEnd) || 0,
        status,
        reason,
        ...(correctedRange ? { correctedRange } : {}),
      };
      const entry = { claim, verification };
      if (status === 'verified') verified.push(entry);
      else if (status === 'unverified') unverified.push(entry);
      else rejected.push(entry);
    };

    if (!file) {
      push('rejected', 'Claim has no file path.');
      continue;
    }

    if (file.startsWith('/') || file.includes('\\') || file.split('/').some((part) => part === '..')) {
      push('rejected', 'Claim path is not a repository-relative path.');
      continue;
    }

    const content = sourceMap.get(file);
    if (content === undefined) {
      if (knownPaths !== undefined && !known.has(file)) {
        push('rejected', 'File is not part of the indexed repository snapshot.');
      } else {
        push('unverified', 'File exists in the repository but its content was not retrieved for this analysis.');
      }
      continue;
    }

    const lines = sourceLines(content);
    const bounded = clampRange(claim, lines.length);
    if (!bounded) {
      const corrected = typeof claim.code === 'string' ? locateSnippet(lines, claim.code) : null;
      const start = Number(claim.lineStart);
      const end = Number(claim.lineEnd);
      const shapeValid =
        Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 1 && end >= start;
      push(
        'rejected',
        shapeValid
          ? 'Line range is outside the file bounds.'
          : 'Line range is malformed.',
        corrected ?? undefined
      );
      continue;
    }

    if (typeof claim.code !== 'string' || claim.code.trim().length === 0) {
      push('unverified', 'No code snippet was supplied, so the claim cannot be confirmed.');
      continue;
    }

    const rangeText = lines.slice(bounded.lineStart - 1, bounded.lineEnd).join('\n');
    const rangeNormalized = normalizeWhitespace(rangeText);
    const snippetNormalized = normalizeWhitespace(claim.code);

    const snippetLines = claim.code
      .split('\n')
      .map((line) => normalizeWhitespace(line))
      .filter((line) => line.length > 0);

    const matchesRange =
      rangeNormalized.includes(snippetNormalized) ||
      (snippetLines.length > 0 && snippetLines.every((line) => rangeNormalized.includes(line)));

    if (matchesRange) {
      push('verified', 'Snippet matches the referenced source lines.');
      continue;
    }

    const elsewhere = locateSnippet(lines, claim.code);
    if (elsewhere) {
      push(
        'unverified',
        'Snippet exists in the file but not at the referenced line range.',
        elsewhere
      );
      continue;
    }

    push('rejected', 'Snippet was not found anywhere in the retrieved file.');
  }

  const total = claims.length;
  const status: 'verified' | 'partial' | 'unverified' =
    total === 0
      ? 'unverified'
      : verified.length === total
        ? 'verified'
        : verified.length > 0
          ? 'partial'
          : 'unverified';

  return {
    verified,
    unverified,
    rejected,
    summary: {
      total,
      verified: verified.length,
      unverified: unverified.length,
      rejected: rejected.length,
      status,
    },
  };
}

export interface AffectedFileVerification {
  files: string[];
  unknownFiles: string[];
}

/** Only files present in the snapshot may be presented as affected files. */
export function verifyAffectedFiles(
  paths: readonly string[],
  knownPaths: readonly string[]
): AffectedFileVerification {
  const known = new Set(knownPaths);
  const files: string[] = [];
  const unknownFiles: string[] = [];
  for (const path of paths) {
    if (typeof path !== 'string' || path.length === 0) continue;
    if (known.has(path)) {
      if (!files.includes(path)) files.push(path);
    } else if (!unknownFiles.includes(path)) {
      unknownFiles.push(path);
    }
  }
  return { files, unknownFiles };
}
