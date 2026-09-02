import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getModelPreference, saveModelPreference } from '@/lib/ai/preferences';
import type { ProviderName } from '@/lib/ai/providers/registry';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const preference = await getModelPreference(user.id);
    return NextResponse.json({ preference });
  } catch (error) {
    const err = error as Error;
    console.error('[api/models/preference] Error:', err.message);
    return NextResponse.json({ error: 'Failed to load preference' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    let body: {
      selection_mode?: 'auto' | 'manual';
      provider?: ProviderName | null;
      model?: string | null;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    if (!body.selection_mode || !['auto', 'manual'].includes(body.selection_mode)) {
      return NextResponse.json({ error: 'selection_mode must be "auto" or "manual"' }, { status: 400 });
    }

    const result = await saveModelPreference(user.id, {
      selection_mode: body.selection_mode,
      provider: body.provider || null,
      model: body.model || null,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error || 'Failed to save preference' }, { status: 400 });
    }

    return NextResponse.json({ preference: result.preference });
  } catch (error) {
    const err = error as Error;
    console.error('[api/models/preference] Error:', err.message);
    return NextResponse.json({ error: 'Failed to save preference' }, { status: 500 });
  }
}