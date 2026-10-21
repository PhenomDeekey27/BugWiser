import { NextResponse, after } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { createBackgroundClient } from '@/lib/supabase/background';
import { runRelevantFileDiscovery } from '@/lib/analysis/relevant-files';
import { getRepositoryAccessToken } from '@/lib/github/app/access';
import { githubErrorResponse } from '@/lib/github/app/http';

// See root-cause route: must outlive a relayed local-model generation.
export const maxDuration = 300;
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
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
    .select('id, user_id, status, repository_full_name, github_installation_id')
    .eq('id', id)
    .single();

  if (fetchError || !analysis) {
    return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
  }

  if (analysis.user_id !== user.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (analysis.status !== 'ready_for_analysis' && analysis.status !== 'failed') {
    return NextResponse.json(
      {
        error: `Analysis must be ready_for_analysis or failed before relevant file discovery (current: ${analysis.status})`,
      },
      { status: 409 }
    );
  }

  try {
    await getRepositoryAccessToken(user.userId, analysis.repository_full_name);
  } catch (error) {
    return githubErrorResponse(error);
  }

  if (analysis.status === 'failed') {
    await db
      .from('analyses')
      .update({
        status: 'queued',
        current_stage: 'issue_context',
        error_message: null,
      })
      .eq('id', id)
      .eq('user_id', user.userId);
  }

  // after() hands this promise to the platform's waitUntil, so the invocation
  // stays alive for the whole stage (including a relayed local generation).
  // A bare floating promise is frozen as soon as the response is sent.
  after(async () => {
    try {
      await runRelevantFileDiscovery(id, user.userId);
    } catch (err) {
      console.error('[api/relevant-files] Background discovery failed:', err);
      try {
        await db
          .from('analyses')
          .update({
            status: 'failed',
            current_stage: 'relevant_files_discovery',
            error_message:
              err instanceof Error ? err.message : 'Discovery failed unexpectedly',
          })
          .eq('id', id)
          .eq('user_id', user.userId);
        console.error('[api/relevant-files] Updated analysis to failed status');
      } catch (updateErr) {
        console.error('[api/relevant-files] Failed to update to failed status:', updateErr);
      }
    }
  });

  return NextResponse.json({ started: true });
}
