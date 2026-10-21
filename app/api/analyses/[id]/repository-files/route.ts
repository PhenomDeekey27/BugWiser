import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { createBackgroundClient } from '@/lib/supabase/background';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const db = createBackgroundClient();
  const { data: analysis, error: fetchError } = await db
    .from('analyses')
    .select('id, user_id')
    .eq('id', id)
    .single();

  if (fetchError || !analysis) {
    return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
  }

  if (analysis.user_id !== user.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: files, error: filesError } = await db
    .from('repository_files')
    .select('*')
    .eq('analysis_id', id)
    .order('path');

  if (filesError) {
    return NextResponse.json({ error: 'Failed to fetch files' }, { status: 500 });
  }

  return NextResponse.json(
    { files: files || [] },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
