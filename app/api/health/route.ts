import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const err = error as Error;
    console.error('[api/health] Error:', err.message);
    return NextResponse.json({ error: 'Failed to check health' }, { status: 500 });
  }
}
