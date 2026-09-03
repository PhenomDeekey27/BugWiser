import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getOrBuildCatalog } from '@/lib/ai/model-intelligence';

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const result = await getOrBuildCatalog(user.id, true);
    return NextResponse.json({
      ok: true,
      modelCount: result.models.length,
      classifiedByAi: result.classifiedByAi,
      classificationModel: result.classificationModel,
      fingerprint: result.providerFingerprint,
    });
  } catch (err) {
    const error = err as Error;
    console.error('[api/model-intelligence] Refresh failed:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
