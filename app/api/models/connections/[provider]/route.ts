import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { removeUserConnection } from '@/lib/ai/connection/service';
import type { ProviderName } from '@/lib/ai/providers/registry';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  try {
    const { provider } = await params;
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    await removeUserConnection(user.id, provider as ProviderName);

    // Trigger model catalog refresh in background (fire-and-forget)
    import('@/lib/ai/model-intelligence').then((m) =>
      m.getOrBuildCatalog(user.id, true).catch((err) =>
        console.warn('[disconnect] Catalog refresh failed:', err)
      )
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    const err = error as Error;
    console.error('[api/models/connections] Error:', err.message);
    return NextResponse.json({ error: 'Failed to disconnect provider' }, { status: 500 });
  }
}
