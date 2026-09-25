import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { saveUserConnection } from '@/lib/ai/connection/service';
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
];

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    let body: { provider?: string; apiKey?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { provider, apiKey } = body;
    if (!provider || !VALID_PROVIDERS.includes(provider as ProviderName)) {
      return NextResponse.json({ error: 'A valid provider is required' }, { status: 400 });
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

    // Trigger model catalog refresh in background (fire-and-forget).
    // rebuildCatalogOnce dedupes concurrent rebuilds so a page GET racing this
    // refresh shares one build instead of two competing ones.
    import('@/lib/ai/model-intelligence').then((m) =>
      m.rebuildCatalogOnce(user.id).catch((err) =>
        console.warn('[connect] Catalog refresh failed:', err)
      )
    );

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