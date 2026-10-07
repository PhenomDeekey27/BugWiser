// Browser-side auto-detect of the user's local OpenAI-compatible server.
//
// Runs from the connect form (same machine as the server, no relay needed):
// probe the common local-server ports and return the first BASE URL whose
// models endpoint answers with an OpenAI-shaped list. Detection requires a
// CORS-readable answer (reuses the Task J probe): a server that does not
// allow this origin is unusable through BugWiser anyway — relayed requests
// still execute as browser fetches.
//
// Endpoints that are UP but refuse this origin are not silently swallowed:
// their candidates are reported in `blocked` so the form can say "add this
// site to the server's allowed origins" instead of a dead-end not-found.
// The verdict comes from a no-cors follow-up probe (reachability.ts) run
// only after a transport-level failure — an opaque rejection alone cannot
// tell "CORS refusal" from "server down".
//
// Loopback http from an https page is allowed by browsers (trustworthy
// loopback), so probing 127.0.0.1/localhost/[::1] works on the deployed app;
// LAN IPs over plain http would be mixed-content-blocked and are not probed.
//
// All candidates are probed in parallel (each origin is its own connection
// pool); the LOWEST-INDEXED success wins so results stay deterministic.

import { probeLocalModelsList, type FetchLike } from '@/lib/ai/connection/testConnection';
import { diagnoseFetchFailure } from '@/lib/ai/connection/reachability';

/** Common ports: Ollama, LM Studio, llama.cpp & friends, vLLM, text-gen-webui, LOCALAI, ollama-alt, TGI. */
export const DETECT_PORTS = [11434, 1234, 8080, 8000, 5000, 7860, 1337, 30000, 5001] as const;
export const DETECT_HOSTS = ['127.0.0.1', 'localhost', '::1'] as const;

export interface DetectedLocalEndpoint {
  /** Form-ready base URL, e.g. `http://127.0.0.1:11434`. */
  baseUrl: string;
  /** Model IDs discovered on the detected endpoint (0 ⇒ valid but empty). */
  modelIds: string[];
}

export interface DetectResult {
  /** The detected endpoint, or null when nothing usable answered. */
  endpoint: DetectedLocalEndpoint | null;
  /** Candidates whose server ANSWERS this browser but refuses its origin (CORS). */
  blocked: string[];
}

export interface DetectOptions {
  hosts?: readonly string[];
  ports?: readonly number[];
  /** Per-candidate probe timeout (dead ports reject instantly anyway). */
  timeoutMs?: number;
  /** Injectable for tests; defaults to the tab's global fetch. */
  fetchFn?: FetchLike;
}

type CandidateResult =
  | { kind: 'found'; index: number; baseUrl: string; modelIds: string[] }
  | { kind: 'blocked'; baseUrl: string }
  | null;

/**
 * Probe `http://<host>:<port>` for every host × port and return the first
 * (host, port) whose `/models` or `/v1/models` validates as an OpenAI models
 * list — plus the candidates that are up but blocking this origin. Nothing
 * answering and nothing blocked ⇒ `{ endpoint: null, blocked: [] }` (the
 * form keeps manual entry).
 */
export async function detectLocalEndpoint(options: DetectOptions = {}): Promise<DetectResult> {
  const hosts = options.hosts ?? DETECT_HOSTS;
  const ports = options.ports ?? DETECT_PORTS;
  const timeoutMs = options.timeoutMs ?? 1_000;
  const fetchFn = options.fetchFn ?? (globalThis.fetch as FetchLike | undefined);
  if (!fetchFn) return { endpoint: null, blocked: [] };

  const candidates: { baseUrl: string; index: number }[] = [];
  let index = 0;
  for (const host of hosts) {
    // IPv6 literals need brackets in the URL authority (`http://[::1]:11434`).
    const hostPart = host.includes(':') ? `[${host}]` : host;
    for (const port of ports) {
      candidates.push({ baseUrl: `http://${hostPart}:${port}`, index: index++ });
    }
  }

  const results = await Promise.all(
    candidates.map(async (candidate): Promise<CandidateResult> => {
      try {
        const probe = await probeLocalModelsList(
          { baseUrl: candidate.baseUrl },
          { fetchFn, timeoutMs }
        );
        // 'openai-compatible' ⇒ the endpoint validated (even when it lists 0
        // models — an empty-but-correct server is still THE endpoint).
        if (probe.compatibility === 'openai-compatible') {
          return { kind: 'found', index: candidate.index, baseUrl: probe.baseUrl, modelIds: probe.modelIds };
        }
        // Transport-level failure: ask a no-cors probe whether the address is
        // actually UP (opaque response ⇒ the server refuses this origin).
        if (probe.networkFailure === true) {
          const verdict = await diagnoseFetchFailure(candidate.baseUrl, fetchFn);
          if (verdict === 'reachable-blocked') {
            return { kind: 'blocked', baseUrl: candidate.baseUrl };
          }
        }
        return null;
      } catch {
        return null;
      }
    })
  );

  let best: { index: number; baseUrl: string; modelIds: string[] } | null = null;
  const blocked: string[] = [];
  for (const result of results) {
    if (!result) continue;
    if (result.kind === 'found' && (!best || result.index < best.index)) {
      best = { index: result.index, baseUrl: result.baseUrl, modelIds: result.modelIds };
    } else if (result.kind === 'blocked') {
      blocked.push(result.baseUrl);
    }
  }
  return {
    endpoint: best ? { baseUrl: best.baseUrl, modelIds: best.modelIds } : null,
    blocked,
  };
}
