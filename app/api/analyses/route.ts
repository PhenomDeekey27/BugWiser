import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { createBackgroundClient } from '@/lib/supabase/background';
import { Repository, Issue } from '@/types';
import { resolveRepositoryAccess } from '@/lib/github/app/access';
import { githubErrorResponse } from '@/lib/github/app/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    let body: { repository?: Repository; issue?: Issue };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { repository, issue } = body;
    if (!repository || !issue) {
      return NextResponse.json({ error: 'repository and issue are required' }, { status: 400 });
    }
    if (!repository.fullName) {
      return NextResponse.json({ error: 'repository.fullName is required' }, { status: 400 });
    }
    if (!Number.isSafeInteger(issue.number) || issue.number <= 0) {
      return NextResponse.json({ error: 'issue.number must be a positive integer' }, { status: 400 });
    }

    // Never trust the client's repository id/owner/name: resolve the repository
    // through the signed-in user's GitHub App installation.
    let access;
    try {
      access = await resolveRepositoryAccess(user.userId, repository.fullName);
    } catch (error) {
      return githubErrorResponse(error);
    }

    const db = createBackgroundClient();

    const { data: preference } = await db
      .from('user_model_preferences')
      .select('selected_strategy')
      .eq('user_id', user.userId)
      .maybeSingle();

    const rawStrategy = preference?.selected_strategy || 'auto';
    const modelStrategy =
      rawStrategy === 'balanced' || rawStrategy === 'quality' ? 'custom' : rawStrategy;

    const { data: insertedRows, error: insertError } = await db
      .from('analyses')
      .insert({
        user_id: user.userId,
        repository_id: String(access.repository.repoId),
        repository_full_name: access.repository.fullName,
        repository_owner: access.repository.owner,
        repository_name: access.repository.name,
        issue_number: issue.number,
        issue_title: issue.title,
        status: 'queued',
        current_stage: 'issue_context',
        model_strategy: modelStrategy,
        github_installation_id: access.installationId,
      })
      .select();

    if (insertError) {
      console.error('[api/analyses] Insert error:', insertError.message);
      return NextResponse.json(
        { error: 'Failed to create analysis: ' + (insertError.message || 'Unknown error') },
        { status: 500 }
      );
    }

    const insertedId = insertedRows?.[0]?.id;
    if (!insertedId) {
      console.error('[api/analyses] Insert returned no row');
      return NextResponse.json(
        { error: 'Failed to create analysis: no row returned by insert' },
        { status: 500 }
      );
    }

    const { data: analysis, error: fetchError } = await db
      .from('analyses')
      .select('*')
      .eq('id', insertedId)
      .eq('user_id', user.userId)
      .single();

    if (fetchError || !analysis) {
      console.error('[api/analyses] Fetch analysis error:', fetchError?.message);
      return NextResponse.json(
        { error: 'Failed to fetch analysis after creation' },
        { status: 500 }
      );
    }

    return NextResponse.json({ analysisId: analysis.id, status: 'queued' });
  } catch (error) {
    const err = error as Error;
    console.error('[api/analyses] Unexpected error:', err.message);
    return NextResponse.json({ error: 'Failed to create analysis' }, { status: 500 });
  }
}
