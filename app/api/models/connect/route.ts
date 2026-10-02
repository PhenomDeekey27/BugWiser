import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { saveUserConnection } from '@/lib/ai/connection/service';
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

// Fire-and-forget catalog refresh after a connection change.
// rebuildCatalogOnce dedupes concurrent rebuilds so a page GET racing this
// refresh shares one build instead of two competing ones.
function scheduleCatalogRebuild(userId: string): void {
  import('@/lib/ai/model-intelligence').then((m) =>
    m.rebuildCatalogOnce(userId).catch((err) =>
      console.warn('[connect] Catalog refresh failed:', err)
    )
  );
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

      scheduleCatalogRebuild(user.id);
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

    scheduleCatalogRebuild(user.id);

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
