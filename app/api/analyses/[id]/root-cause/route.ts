import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { createBackgroundClient } from '@/lib/supabase/background';
import { runRootCauseAnalysis } from '@/lib/analysis/root-cause';

// A local-model generation may wait up to RELAY_GENERATION_TIMEOUT_MS on the
// browser relay (lib/ai/connection/relay.ts) — the stage must outlive that
// wait even on a deployment plan with a short default function timeout.
export const maxDuration = 300;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    );
  }

  const db = createBackgroundClient();
  const { data: analysis, error: fetchError } = await db
    .from('analyses')
    .select('id, user_id, status, current_stage')
    .eq('id', id)
    .single();

  if (fetchError || !analysis) {
    return NextResponse.json(
      { error: 'Analysis not found' },
      { status: 404 }
    );
  }

  if (analysis.user_id !== user.userId) {
    return NextResponse.json(
      { error: 'Forbidden' },
      { status: 403 }
    );
  }

  const canStart = analysis.status === 'relevant_files_ready';
  const canRetry = analysis.status === 'failed' && analysis.current_stage === 'root_cause_analysis';

  if (!canStart && !canRetry) {
    return NextResponse.json(
      { error: `Analysis must have relevant files ready or be retrying root cause (current: ${analysis.status}, stage: ${analysis.current_stage})` },
      { status: 409 }
    );
  }

  runRootCauseAnalysis(id).catch(async (err) => {
    console.error('[api/root-cause] Background analysis failed:', err);
    try {
      await db.from('analyses').update({
        status: 'failed',
        current_stage: 'root_cause_analysis',
        error_message: err instanceof Error ? err.message : 'Root cause analysis failed unexpectedly',
      }).eq('id', id).eq('user_id', user.userId);
      console.error('[api/root-cause] Updated analysis to failed status');
    } catch (updateErr) {
      console.error('[api/root-cause] Failed to update to failed status:', updateErr);
    }
  });

  return NextResponse.json({ started: true });
}
