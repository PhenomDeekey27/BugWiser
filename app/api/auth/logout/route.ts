import { NextResponse } from 'next/server';
import { clearAuthCookies } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const response = NextResponse.json(
    { ok: true },
    { headers: { 'Cache-Control': 'no-store' } }
  );

  clearAuthCookies(response);

  // End the optional Supabase fallback session too. Failure here must not keep
  // the BugWiser session alive, so it is best-effort.
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch {
    // Ignore.
  }

  return response;
}
