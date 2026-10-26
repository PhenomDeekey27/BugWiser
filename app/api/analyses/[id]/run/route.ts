import { NextResponse, after } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { createBackgroundClient } from '@/lib/supabase/background';
import { runAnalysisInitialization } from '@/lib/analysis/runner';
import { getRepositoryAccessToken } from '@/lib/github/app/access';
import { githubErrorResponse } from '@/lib/github/app/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Initialization is scheduled via after(), which runs for the route's max
// duration — give it the same budget as the stage routes.
export const maxDuration = 300;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const db = createBackgroundClient();
    const { data: analysis, error: fetchError } = await db
      .from('analyses')
      .select('id, user_id, status, repository_full_name, github_installation_id, repository_source, repository_commit')
      .eq('id', id)
      .single();

    if (fetchError || !analysis) {
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
    }

    if (analysis.user_id !== user.userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (analysis.status !== 'queued') {
      return NextResponse.json({ error: 'Analysis already started' }, { status: 409 });
    }

    // Fail fast when the installation no longer covers this repository, rather
    // than starting a job that can only fail later. Public analyses have no
    // installation: their pinned commit is the only requirement.
    if (analysis.repository_source === 'public') {
      if (!analysis.repository_commit) {
        return NextResponse.json(
          { error: 'Public analysis is not pinned to a commit.', code: 'invalid_base_commit' },
          { status: 409 }
        );
      }
    } else {
      try {
        await getRepositoryAccessToken(user.userId, analysis.repository_full_name);
      } catch (error) {
        return githubErrorResponse(error);
      }
    }

    // after() hands this promise to the platform's waitUntil, so initialization
    // is not frozen the moment this response is sent.
    after(async () => {
      try {
        await runAnalysisInitialization(id, user.userId);
      } catch (err) {
        console.error('[api/analyses/run] Background analysis failed:', err);
      }
    });

    return NextResponse.json({ started: true });
  } catch (error) {
    const err = error as Error;
    console.error('[api/analyses/run] Unexpected error:', err.message);
    return NextResponse.json({ error: 'Failed to start analysis' }, { status: 500 });
  }
}
