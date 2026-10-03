// OPT-IN manual smoke test for a user-provided local OpenAI-compatible server.
//
// This script is NEVER invoked by any spec, test, npm script, or build step —
// it only runs when a person types the command below. It exists so the five
// analysis stages can be verified against a REAL local endpoint without any
// automated test ever making a real model call.
//
//   npx tsx scripts/local-llm-smoke.ts --base-url http://127.0.0.1:8000/v1 \
//        --model <model-id-from-your-/models> --confirm
//
// Optional:
//   --api-key <key>    sent as `Authorization: Bearer` (keyless is the norm)
//   --stage <id>       run ONE stage instead of all five (repeatable)
//   --prompt <text>    override the probe prompt (default: a tiny text probe)
//
// Safety properties (all enforced in code below):
//   * refuses to run unless --base-url, --model AND --confirm are supplied;
//   * refuses to run inside a test runner, so it can never be triggered by CI;
//   * never reads the database, never touches the catalog, and never triggers
//     the catalog classifier — it calls ONLY the existing model router;
//   * uses the SAME normalize + SSRF screen as registration, so it can never
//     reach a blocked (link-local / cloud-metadata) address;
//   * prints only status, byte counts and the first line of the reply. The API
//     key is never printed and never placed in an error message.
//
// Exit codes: 0 = every requested stage succeeded, 1 = at least one failed.

import { runWithFallback } from '@/lib/ai/model-router';
import { normalizeLocalBaseUrl, blockedLocalTargetReason } from '@/lib/ai/connection/local';
import { STAGE_WEIGHTS, STAGE_CONTEXT_MIN, type StageKey } from '@/lib/ai/catalog/stageSelection';
import { STAGE_TOKEN_PROFILES } from '@/lib/ai/catalog/stageTokenProfiles';

interface Args {
  baseUrl: string;
  model: string;
  apiKey?: string;
  stages: StageKey[];
  prompt: string;
  confirmed: boolean;
}

function parseArgs(argv: string[]): Args {
  const take = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  const all = argv.slice(2);
  const stages: StageKey[] = [];
  for (let i = 0; i < all.length; i++) {
    if (all[i] === '--stage') {
      const v = all[i + 1];
      if (v && Object.prototype.hasOwnProperty.call(STAGE_WEIGHTS, v)) stages.push(v as StageKey);
      else {
        console.error(`--stage must be one of: ${Object.keys(STAGE_WEIGHTS).join(', ')}`);
        process.exit(1);
      }
      i++;
    }
  }
  return {
    baseUrl: take('--base-url') ?? '',
    model: take('--model') ?? '',
    apiKey: take('--api-key'),
    stages: stages.length > 0 ? stages : (Object.keys(STAGE_WEIGHTS) as StageKey[]),
    prompt: take('--prompt') ?? 'Reply with the single word: ok',
    confirmed: all.includes('--confirm'),
  };
}

function refuseUnderTestRunner(): void {
  const runner =
    process.env.VITEST ||
    process.env.JEST_WORKER_ID ||
    process.env.NODE_ENV === 'test' ||
    process.env.TS_NODE_PROJECT;
  if (runner) {
    console.error('Refusing to run: a test runner is active. This script is manual-only.');
    process.exit(1);
  }
}

async function main(): Promise<void> {
  refuseUnderTestRunner();
  const args = parseArgs(process.argv);

  if (!args.baseUrl || !args.model || !args.confirmed) {
    console.error(
      'Usage: npx tsx scripts/local-llm-smoke.ts --base-url <url> --model <id> --confirm\n' +
        '       [--api-key <key>] [--stage <stage-id>] [--prompt <text>]'
    );
    console.error('Aborting: --base-url, --model and --confirm are all required (manual opt-in only).');
    process.exit(1);
  }

  const normalized = normalizeLocalBaseUrl(args.baseUrl);
  if (!normalized.ok) {
    console.error(`Base URL rejected: ${normalized.error}`);
    process.exit(1);
  }
  const baseUrl = normalized.baseUrl;
  const blocked = blockedLocalTargetReason(baseUrl);
  if (blocked) {
    console.error(`Target blocked: ${blocked}`);
    process.exit(1);
  }

  console.log(`Endpoint : ${baseUrl}`);
  console.log(`Model    : ${args.model}`);
  console.log(`Auth     : ${args.apiKey ? 'Bearer <redacted>' : 'none (keyless)'}`);
  console.log(`Stages   : ${args.stages.join(', ')}`);
  console.log('');

  let failed = 0;
  for (const stage of args.stages) {
    // The same OpenAI-compatible request shape every analysis stage sends:
    // JSON-object response, per-stage output budget from the shared token
    // profile. Nothing stage-specific is reimplemented here.
    const maxTokens = STAGE_TOKEN_PROFILES[stage].outputTokens;
    const started = Date.now();
    try {
      const res = await runWithFallback({
        task: stage,
        messages: [
          { role: 'system', content: 'You are a smoke-test probe. Reply concisely.' },
          { role: 'user', content: args.prompt },
        ],
        temperature: 0.3,
        maxTokens,
        responseFormat: { type: 'json_object' },
        // Exactly what a saved stage override produces at run time.
        stageOverrides: { provider: 'local', model: args.model },
        localEndpoint: args.apiKey ? { baseUrl, apiKey: args.apiKey } : { baseUrl },
      });
      const firstLine = res.content.trim().split('\n')[0] ?? '';
      console.log(
        `PASS ${stage} | provider=${res.provider} model=${res.model} | ` +
          `${Date.now() - started}ms | fallbackCount=${res.fallbackCount} | ` +
          `attempts=${res.attemptedProviders.length} | contextMin=${STAGE_CONTEXT_MIN[stage]} | ` +
          `reply="${firstLine.slice(0, 120)}"`
      );
      if (res.provider !== 'local') {
        failed++;
        console.error(`     NOTE: executed on ${res.provider} (local attempt failed; fallback used).`);
      }
    } catch (err) {
      failed++;
      console.error(`FAIL ${stage} :: ${(err as Error).message}`);
    }
  }

  console.log('');
  console.log(failed === 0 ? 'ALL STAGES SUCCEEDED ON THE LOCAL ENDPOINT' : `${failed} stage(s) failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('SMOKE CRASH :: ' + ((err as Error).message || String(err)));
  process.exit(1);
});
