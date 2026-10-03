// Shared JSON extraction for every stage response parser.
//
// Every analysis stage asks for `response_format: { type: 'json_object' }` and
// instructs the model to answer with JSON only. Some OpenAI-compatible servers
// accept that flag but still wrap the answer in a ```json markdown fence, so a
// bare `JSON.parse` silently discards a perfectly good analysis and the stage
// then reports "the model failed to analyze the provided source code".
//
// `extractJsonObject` is strictly MORE PERMISSIVE than `JSON.parse`: it first
// tries the raw text unchanged, and only if that fails does it retry once with a
// single surrounding markdown fence removed. It can therefore never turn a
// response that already parses into a failure, and it never changes what a
// well-behaved provider returns. Only more output is accepted, never less.

const FENCE = /^\s*```(?:json|JSON)?\s*\n?([\s\S]*?)\n?\s*```\s*$/;

/**
 * Parses a model response as JSON, tolerating one surrounding markdown code
 * fence. Returns `null` when the text is not JSON — callers keep their existing
 * "could not parse" handling.
 */
export function extractJsonObject(content: string): unknown | null {
  if (typeof content !== 'string') return null;

  try {
    return JSON.parse(content);
  } catch {
    // fall through to the fenced retry
  }

  const fenced = FENCE.exec(content);
  if (!fenced) return null;

  try {
    return JSON.parse(fenced[1]);
  } catch {
    return null;
  }
}