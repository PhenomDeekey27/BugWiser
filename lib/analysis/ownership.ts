// Analysis ownership rule.
//
// Every analysis API route must prove the caller owns the analysis. Keeping the
// rule in one pure function means the check cannot drift between routes, and the
// isolation behaviour can be tested without a database.
//
// The rule is deliberately strict: an analysis with no owner, or an empty
// session id, is never visible. Only an exact match is visible.

export class AnalysisAccessError extends Error {
  constructor(message = 'Analysis not found') {
    super(message);
    this.name = 'AnalysisAccessError';
  }
}

export function isAnalysisVisibleTo(
  analysisUserId: string | null | undefined,
  viewerUserId: string | null | undefined
): boolean {
  if (typeof analysisUserId !== 'string' || analysisUserId.length === 0) return false;
  if (typeof viewerUserId !== 'string' || viewerUserId.length === 0) return false;
  return analysisUserId === viewerUserId;
}

/**
 * Throws when the viewer does not own the analysis. Callers map this to a 404 so
 * the existence of another user's analysis is never confirmed.
 */
export function assertAnalysisVisible(
  analysisUserId: string | null | undefined,
  viewerUserId: string | null | undefined
): void {
  if (!isAnalysisVisibleTo(analysisUserId, viewerUserId)) {
    throw new AnalysisAccessError();
  }
}
