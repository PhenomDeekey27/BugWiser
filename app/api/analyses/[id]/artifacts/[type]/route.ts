import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { createBackgroundClient } from '@/lib/supabase/background';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_ARTIFACT_TYPES = new Set([
  'issue_context',
  'issue_comments',
  'repository_tree',
  'fingerprint',
  'relevant_files',
  'source_files',
  'root_cause',
  'evidence',
  'solution',
  'patch',
  'model_execution',
]);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; type: string }> }
) {
  const { id, type } = await params;
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  if (!ALLOWED_ARTIFACT_TYPES.has(type)) {
    return NextResponse.json({ error: 'Invalid artifact type' }, { status: 400 });
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

  const { data: artifact, error: artifactError } = await db
    .from('analysis_artifacts')
    .select('data')
    .eq('analysis_id', id)
    .eq('artifact_type', type)
    .single();

  if (artifactError || !artifact) {
    return NextResponse.json({ artifact: null });
  }

  return NextResponse.json(
    { artifact: { data: artifact.data } },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
