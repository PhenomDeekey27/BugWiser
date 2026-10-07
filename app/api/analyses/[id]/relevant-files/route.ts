import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createBackgroundClient } from '@/lib/supabase/background';
import { runRelevantFileDiscovery } from '@/lib/analysis/relevant-files';

// See root-cause route: must outlive a relayed local-model generation.
export const maxDuration = 300;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    );
  }

  const { data: analysis, error: fetchError } = await supabase
    .from('analyses')
    .select('id, user_id, status')
    .eq('id', id)
    .single();

  if (fetchError || !analysis) {
    return NextResponse.json(
      { error: 'Analysis not found' },
      { status: 404 }
    );
  }

  if (analysis.user_id !== user.id) {
    return NextResponse.json(
      { error: 'Forbidden' },
      { status: 403 }
    );
  }

  if (analysis.status !== 'ready_for_analysis' && analysis.status !== 'failed') {
    return NextResponse.json(
      { error: `Analysis must be ready_for_analysis or failed before relevant file discovery (current: ${analysis.status})` },
      { status: 409 }
    );
  }

  if (analysis.status === 'failed') {
    await supabase.from('analyses').update({
      status: 'queued',
      current_stage: 'issue_context',
      error_message: null,
    }).eq('id', id);
  }

  const { data: { session } } = await supabase.auth.getSession();
  const githubToken = session?.provider_token || null;

  if (!githubToken) {
    return NextResponse.json(
      { error: 'GitHub token not available. Please re-authenticate with GitHub.' },
      { status: 401 }
    );
  }

  runRelevantFileDiscovery(id, githubToken).catch(async (err) => {
    console.error('[api/relevant-files] Background discovery failed:', err);
    try {
      const bg = createBackgroundClient();
      await bg.from('analyses').update({
        status: 'failed',
        current_stage: 'relevant_files_discovery',
        error_message: err instanceof Error ? err.message : 'Discovery failed unexpectedly',
      }).eq('id', id);
      console.error('[api/relevant-files] Updated analysis to failed status');
    } catch (updateErr) {
      console.error('[api/relevant-files] Failed to update to failed status:', updateErr);
    }
  });

  return NextResponse.json({ started: true });
}
