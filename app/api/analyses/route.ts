import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createBackgroundClient } from '@/lib/supabase/background';
import { Repository, Issue } from '@/types';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    let body: { repository?: Repository; issue?: Issue };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      );
    }

    const { repository, issue } = body;

    if (!repository || !issue) {
      return NextResponse.json(
        { error: 'repository and issue are required' },
        { status: 400 }
      );
    }

    if (!repository.fullName || !repository.owner) {
      return NextResponse.json(
        { error: 'repository.fullName and repository.owner are required' },
        { status: 400 }
      );
    }

    const [owner, repo] = repository.fullName.split('/');

    // Get user's preferred strategy from model preferences
    const { data: preference, error: prefError } = await createBackgroundClient()
      .from('user_model_preferences')
      .select('selected_strategy')
      .eq('user_id', user.id)
      .maybeSingle();

    const modelStrategy = preference?.selected_strategy || 'auto';

    // Insert the analysis record
    const insertResult = await createBackgroundClient()
      .from('analyses')
      .insert({
        user_id: user.id,
        repository_id: repository.id,
        repository_full_name: repository.fullName,
        repository_owner: owner,
        repository_name: repo,
        issue_number: issue.number,
        issue_title: issue.title,
        status: 'queued',
        current_stage: 'issue_context',
        model_strategy: modelStrategy,
      });

    if ((insertResult as any)?.error) {
      console.error('[api/analyses] Insert error:', (insertResult as any).error.message);
      return NextResponse.json(
        { error: 'Failed to create analysis: ' + ((insertResult as any).error?.message || 'Unknown error') },
        { status: 500 }
      );
    }

    const insertedId = insertResult as any;
    
    // Get the full record from the inserted ID
    const { data: analysis, error: fetchError } = await createBackgroundClient()
      .from('analyses')
      .select('*')
      .eq('id', insertedId[0].id)
      .single();

    if (fetchError) {
      console.error('[api/analyses] Fetch analysis error:', fetchError.message);
      return NextResponse.json(
        { error: 'Failed to fetch analysis after creation: ' + fetchError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      analysisId: analysis.id,
      status: 'queued',
    });
  } catch (error) {
    const err = error as Error;
    console.error('[api/analyses] Unexpected error:', err.message);
    return NextResponse.json(
      { error: 'Failed to create analysis' },
      { status: 500 }
    );
  }
}
