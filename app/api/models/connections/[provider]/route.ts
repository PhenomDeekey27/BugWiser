import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  disableUserConnection,
  isProviderConfiguredBysEnv,
  removeUserConnection,
} from '@/lib/ai/connection/service';
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

    const pid = provider as ProviderName;

    // Unified lifecycle (Design B): disconnecting a SERVER-ENV-backed provider
    // writes the per-user tombstone {status:'disabled', key=NULL} instead of a
    // row deletion — deleting the row would silently revert to the env
    // credential on the next read. Every other provider (user-key rows and the
    // always-row-driven local provider) keeps the plain row deletion.
    let disconnectStatus: 'disabled' | 'disconnected';
    if (isProviderConfiguredBysEnv(pid)) {
      const result = await disableUserConnection(user.id, pid);
      if (!result.ok) {
        return NextResponse.json(
          { error: result.error || 'Failed to disconnect provider' },
          { status: 500 }
        );
      }
      disconnectStatus = 'disabled';
    } else {
      await removeUserConnection(user.id, pid);
      disconnectStatus = 'disconnected';
    }

    // Trigger model catalog rebuild asynchronously (deduped) so the refresh
    // that follows reflects the changed provider set. markCatalogDirty first,
    // so a build already in flight from BEFORE the disconnect can never be
    // handed to this refresh (it would still contain the removed provider's
    // models).
    const { markCatalogDirty, rebuildCatalogOnce } = await import('@/lib/ai/model-intelligence');
    markCatalogDirty(user.id);
    rebuildCatalogOnce(user.id).catch((err) =>
      console.warn('[disconnect] Catalog refresh failed:', err)
    );

    return NextResponse.json({ ok: true, status: disconnectStatus });
  } catch (error) {
    const err = error as Error;
    console.error('[api/models/connections] Error:', err.message);
    return NextResponse.json({ error: 'Failed to disconnect provider' }, { status: 500 });
  }
}
