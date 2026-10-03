import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  enableServerEnvConnection,
  isProviderConfiguredBysEnv,
  saveUserConnection,
} from '@/lib/ai/connection/service';
import { registerLocalConnection } from '@/lib/ai/connection/registerLocal';
import { LOCAL_PROVIDER_ID } from '@/lib/ai/connection/local';
import { createProviderInstanceWithApiKey } from '@/lib/ai/providers/registry';
import type { ProviderName } from '@/lib/ai/providers/registry';

const VALID_PROVIDERS: ProviderName[] = [
  'chutes',
  'openrouter',
  'opencode',
  'openai',
  'gemini',
  'deepseek',
  'zai',
  'local',
];

// Schedules the catalog refresh for a connection change, without awaiting the
// build itself (the rebuild itself is never on the response path).
//
// markCatalogDirty runs BEFORE the response is returned — not inside the
// dynamic import's .then() — so a page GET that arrives the moment this
// response does can never reuse a build that started before the connect.
// rebuildCatalogOnce then dedupes concurrent rebuilds at the same generation,
// so the background refresh and that page GET share ONE fresh build instead of
// two competing ones (or — worse — the stale pre-connect one, which is missing
// the newly connected provider's models).
async function scheduleCatalogRebuild(userId: string): Promise<void> {
  try {
    const m = await import('@/lib/ai/model-intelligence');
    m.markCatalogDirty(userId);
    void m.rebuildCatalogOnce(userId).catch((err) =>
      console.warn('[connect] Catalog refresh failed:', err)
    );
  } catch (err) {
    console.warn('[connect] Catalog refresh could not start:', (err as Error).message);
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    let body: { provider?: string; apiKey?: string; baseUrl?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { provider, apiKey } = body;
    if (!provider || !VALID_PROVIDERS.includes(provider as ProviderName)) {
      return NextResponse.json({ error: 'A valid provider is required' }, { status: 400 });
    }

    // Keyless SERVER-ENV reconnect (Design B): a provider configured through
    // the server environment can be connected/enabled without any
    // browser-visible credential — the existing UI's empty-key submit is the
    // whole flow, and no key-shaped value is ever invented, stored, or
    // returned. The row upserted here ({status:'connected', key:NULL}) is what
    // clears a `disabled` tombstone. Providers without a server credential
    // keep the strict "API key is required" rule below.
    if ((!apiKey || apiKey.trim().length === 0) && provider !== LOCAL_PROVIDER_ID) {
      if (!isProviderConfiguredBysEnv(provider as ProviderName)) {
        return NextResponse.json({ error: 'API key is required' }, { status: 400 });
      }
      // Validate with the SERVER env credential (the same health check the
      // key flow runs) so a broken env key fails loudly instead of persisting
      // a connected row nobody can execute with.
      const validationError = await validateCredentials(provider as ProviderName, '');
      if (validationError) {
        return NextResponse.json(
          { error: `Provider validation failed: ${validationError}` },
          { status: 400 }
        );
      }
      const result = await enableServerEnvConnection(user.id, provider as ProviderName);
      if (!result.ok) {
        return NextResponse.json({ error: result.error || 'Failed to connect provider' }, { status: 500 });
      }
      await scheduleCatalogRebuild(user.id);
      return NextResponse.json({ ok: true, provider, status: 'connected' });
    }

    // Local OpenAI-compatible endpoint: base URL (+ optional key). Registration
    // is GATED on a successful connection test inside registerLocalConnection —
    // a URL alone can never persist a connected provider, and a failed test
    // saves nothing (same validate-before-save semantics as the key providers).
    if (provider === LOCAL_PROVIDER_ID) {
      if (typeof body.baseUrl !== 'string' || body.baseUrl.trim().length === 0) {
        return NextResponse.json({ error: 'A base URL is required' }, { status: 400 });
      }
      if (apiKey !== undefined && apiKey !== null && typeof apiKey !== 'string') {
        return NextResponse.json({ error: 'API key must be a string' }, { status: 400 });
      }

      const registration = await registerLocalConnection(user.id, {
        baseUrl: body.baseUrl,
        apiKey: typeof apiKey === 'string' ? apiKey : undefined,
      });
      if (!registration.ok) {
        return NextResponse.json(
          {
            error: `Provider validation failed: ${registration.error}`,
            compatibility: registration.compatibility ?? null,
          },
          { status: 400 }
        );
      }

      await scheduleCatalogRebuild(user.id);
      return NextResponse.json({
        ok: true,
        provider: LOCAL_PROVIDER_ID,
        status: 'connected',
        modelCount: registration.modelCount,
      });
    }

    if (!apiKey || apiKey.trim().length === 0) {
      return NextResponse.json({ error: 'API key is required' }, { status: 400 });
    }

    // Best-effort credential validation before persisting. If the provider is
    // reachable and rejects the key, report the problem clearly instead of
    // silently proceeding.
    const validationError = await validateCredentials(provider as ProviderName, apiKey.trim());
    if (validationError) {
      return NextResponse.json(
        { error: `Provider validation failed: ${validationError}` },
        { status: 400 }
      );
    }

    const result = await saveUserConnection(user.id, provider as ProviderName, apiKey.trim());
    if (!result.ok) {
      return NextResponse.json({ error: result.error || 'Failed to save connection' }, { status: 500 });
    }

    await scheduleCatalogRebuild(user.id);

    return NextResponse.json({
      ok: true,
      provider,
      status: 'connected',
    });
  } catch (error) {
    const err = error as Error;
    console.error('[api/models/connect] Error:', err.message);
    return NextResponse.json({ error: 'Failed to connect provider' }, { status: 500 });
  }
}

async function validateCredentials(provider: ProviderName, apiKey: string): Promise<string | null> {
  try {
    const instance = createProviderInstanceWithApiKey(provider, apiKey);
    const healthy = await instance.healthCheck();
    return healthy ? null : `could not reach ${provider}. Check the API key and try again.`;
  } catch (err) {
    const e = err as Error;
    return e.message || `validation failed for ${provider}`;
  }
}
