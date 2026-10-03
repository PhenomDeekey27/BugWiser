import { extractJsonObject } from './json';

export interface EvidenceValidationResult {
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

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function parseEvidenceResponse(content: string): EvidenceValidationResult {
  const extracted = extractJsonObject(content);
  if (!extracted || typeof extracted !== 'object') {
    return {
      status: 'no_evidence',
      description: 'Failed to parse AI response',
      reason: 'The AI response could not be parsed',
      evidence: [],
    };
  }
  const parsed = extracted as Record<string, unknown>;
  const rawEvidence = (Array.isArray(parsed.evidence) ? parsed.evidence : []) as Array<Record<string, unknown>>;

  try {
    const hasEvidence = Array.isArray(parsed.evidence) && parsed.evidence.length > 0;
    let status: EvidenceValidationResult['status'] = 'evidence_found';

    if (parsed.status === 'no_evidence' || parsed.status === 'insufficient_evidence') {
      status = parsed.status;
    } else if (!hasEvidence) {
      status = 'no_evidence';
    }

    const genericPatterns = [
      /insufficient/i,
      /unable to find/i,
      /no concrete/i,
      /cannot determine/i,
      /generic/i,
    ];

    if (hasEvidence) {
      const allGeneric = rawEvidence.every((ev: { explanation?: string }) => {
        const exp = (ev.explanation || '').toLowerCase();
        return genericPatterns.some((p) => p.test(exp));
      });
      if (allGeneric && rawEvidence.length <= 2) {
        status = 'insufficient_evidence';
      }
    }

    const cleanedEvidence = hasEvidence
      ? rawEvidence.map((ev: Record<string, unknown>) => ({
          file: typeof ev.file === 'string' ? ev.file : '',
          lineStart: typeof ev.lineStart === 'number' ? ev.lineStart : 1,
          lineEnd: typeof ev.lineEnd === 'number' ? ev.lineEnd : typeof ev.lineStart === 'number' ? ev.lineStart : 1,
          code: typeof ev.code === 'string' ? ev.code : '',
          explanation: typeof ev.explanation === 'string' && ev.explanation.trim()
            ? ev.explanation.trim()
            : typeof ev.reason === 'string' && ev.reason.trim()
              ? ev.reason.trim()
              : 'Evidence found at this location',
          type: (ev.type === 'direct' || ev.type === 'supporting' ? ev.type : 'supporting') as 'direct' | 'supporting',
        }))
      : [];

    return {
      status,
      description: typeof parsed.description === 'string' ? parsed.description : 'No description provided',
      reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : undefined,
      evidence: cleanedEvidence,
      requiredFiles: Array.isArray(parsed.requiredFiles) ? parsed.requiredFiles : undefined,
    };
  } catch {
    return {
      status: 'no_evidence',
      description: 'Failed to parse AI response',
      reason: 'The AI response could not be parsed',
      evidence: [],
    };
  }
}

export function validateEvidence(result: EvidenceValidationResult): ValidationResult {
  if (!result.description || result.description.length < 5) {
    return { valid: false, error: 'Description too short' };
  }

  if (result.status === 'no_evidence' || result.status === 'insufficient_evidence') {
    return { valid: true };
  }

  if (!Array.isArray(result.evidence) || result.evidence.length === 0) {
    return { valid: false, error: 'No evidence provided' };
  }

  const validEntries = result.evidence.filter(
    (ev) => ev.file && typeof ev.file === 'string' && ev.code && typeof ev.code === 'string'
  );

  if (validEntries.length === 0) {
    return { valid: false, error: 'No valid evidence entries found' };
  }

  result.evidence = validEntries;

  return { valid: true };
}
