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

    // analyses.model_strategy only accepts engine strategies — map /models page
    // UI setups to 'custom' (their concrete picks live in stage_overrides).
    const rawStrategy = preference?.selected_strategy || 'auto';
    const modelStrategy = rawStrategy === 'balanced' || rawStrategy === 'quality' ? 'custom' : rawStrategy;

    // Insert the analysis record. `.select()` is REQUIRED: without it PostgREST
    // answers with `return=minimal`, so supabase-js resolves `data` to null and
    // the inserted id is never available.
    const { data: insertedRows, error: insertError } = await createBackgroundClient()
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

    // Get the full record from the inserted ID
    const { data: analysis, error: fetchError } = await createBackgroundClient()
      .from('analyses')
      .select('*')
      .eq('id', insertedId)
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
