// Browser-side auto-detect of the user's local OpenAI-compatible server.
//
// Runs from the connect form (same machine as the server, no relay needed):
// probe the common local-server ports and return the first BASE URL whose
// models endpoint answers with an OpenAI-shaped list. Detection deliberately
// REQUIRES a CORS-readable answer (reuses the Task J probe): a server that
// does not allow this origin is unusable through BugWiser anyway — relayed
// requests still execute as browser fetches — so silently suggesting one
// would only set the user up for a later CORS failure.
//
// Loopback http from an https page is allowed by browsers (trustworthy
// loopback), so probing 127.0.0.1/localhost works on the deployed app; LAN
// IPs over plain http would be mixed-content-blocked and are not probed.
//
// All candidates are probed in parallel (each origin is its own connection
// pool); the LOWEST-INDEXED success wins so results stay deterministic.

import { probeLocalModelsList, type FetchLike } from '@/lib/ai/connection/testConnection';

/** Common ports: 11434 (Ollama), 1234 (LM Studio), 8080/8000/5000 (llama.cpp & friends). */
export const DETECT_PORTS = [11434, 1234, 8080, 8000, 5000] as const;
export const DETECT_HOSTS = ['127.0.0.1', 'localhost'] as const;

export interface DetectedLocalEndpoint {
  /** Form-ready base URL, e.g. `http://127.0.0.1:11434`. */
  baseUrl: string;
  /** Model IDs discovered on the detected endpoint (0 ⇒ valid but empty). */
  modelIds: string[];
}

export interface DetectOptions {
  hosts?: readonly string[];
  ports?: readonly number[];
  /** Per-candidate probe timeout (dead ports reject instantly anyway). */
  timeoutMs?: number;
  /** Injectable for tests; defaults to the tab's global fetch. */
  fetchFn?: FetchLike;
}

/**
 * Probe `http://<host>:<port>` for every host × port and return the first
 * (host, port) whose `/models` or `/v1/models` validates as an OpenAI models
 * list — or null when nothing answers (the form keeps manual entry).
 */
export async function detectLocalEndpoint(
  options: DetectOptions = {}
): Promise<DetectedLocalEndpoint | null> {
  const hosts = options.hosts ?? DETECT_HOSTS;
  const ports = options.ports ?? DETECT_PORTS;
  const timeoutMs = options.timeoutMs ?? 1_000;
  const fetchFn = options.fetchFn ?? (globalThis.fetch as FetchLike | undefined);
  if (!fetchFn) return null;

  const candidates: { baseUrl: string; index: number }[] = [];
  let index = 0;
  for (const host of hosts) {
    for (const port of ports) {
      candidates.push({ baseUrl: `http://${host}:${port}`, index: index++ });
    }
  }

  const results = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        const probe = await probeLocalModelsList(
          { baseUrl: candidate.baseUrl },
          { fetchFn, timeoutMs }
        );
        // 'openai-compatible' ⇒ the endpoint validated (even when it lists 0
        // models — an empty-but-correct server is still THE endpoint).
        return probe.compatibility === 'openai-compatible'
          ? { ...candidate, modelIds: probe.modelIds }
          : null;
      } catch {
        return null;
      }
    })
  );

  let best: (DetectedLocalEndpoint & { index: number }) | null = null;
  for (const result of results) {
    if (result && (!best || result.index < best.index)) best = result;
  }
  return best ? { baseUrl: best.baseUrl, modelIds: best.modelIds } : null;
}
