import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    return NextResponse.json({ ok: true, source: user.source });
  } catch (error) {
    const err = error as Error;
    console.error('[api/health] Error:', err.message);
    return NextResponse.json({ error: 'Failed to check health' }, { status: 500 });
  }
}
