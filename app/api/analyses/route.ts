import { NextResponse } from 'next/server';
import {
  applyCredentialRefresh,
  githubAuthErrorResponse,
  resolveGitHubCredential,
} from '@/lib/auth/github-token';
import { createBackgroundClient } from '@/lib/supabase/background';
import { Repository, Issue } from '@/types';
import { resolveRepositoryAccess } from '@/lib/github/access';
import { githubErrorResponse } from '@/lib/github/http';
import {
  ANALYSIS_IDEMPOTENCY_HEADER,
  isMissingSchema,
  isUniqueViolation,
  normalizeAnalysisIdempotencyKey,
} from '@/lib/analysis/idempotency';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CreateAnalysisBody {
  repository?: Repository;
  issue?: Issue;
  idempotencyKey?: unknown;
}

/** The already-created row for this user+key, or null. */
async function findExistingAnalysis(
  db: ReturnType<typeof createBackgroundClient>,
  userId: string,
  idempotencyKey: string
): Promise<{ id: string; status: string | null } | null> {
  const { data, error } = await db
    .from('analyses')
    .select('id, status')
    .eq('user_id', userId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();

  if (error) {
    // A missing column means the additive migration has not been applied yet.
    // Surface it instead of silently creating duplicate rows.
    if (isMissingSchema(error)) {
      throw new Error(
        'Analysis idempotency is not available: apply supabase/migrations/019_analysis_idempotency.sql.'
      );
    }
    throw new Error(`Failed to check existing analysis: ${error.message}`);
  }
  return data ? { id: data.id as string, status: (data.status as string | null) ?? null } : null;
}

export async function POST(request: Request) {
  try {
    // An analysis reads the repository with the caller's own GitHub token, so a
    // guest session (public imports only) and a revoked token are both refused
    // here rather than starting a job that cannot read its source.
    const credential = await resolveGitHubCredential();
    if (!credential.ok) {
      return githubAuthErrorResponse(credential.reason);
    }
    const userId = credential.session.userId;

    let body: CreateAnalysisBody;
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

    // A supplied but invalid key is a client bug — reject it rather than
    // creating an analysis that cannot be retried idempotently.
    const rawIdempotencyKey =
      body.idempotencyKey ?? request.headers.get(ANALYSIS_IDEMPOTENCY_HEADER);
    const idempotencyKey =
      rawIdempotencyKey == null ? null : normalizeAnalysisIdempotencyKey(rawIdempotencyKey);
    if (rawIdempotencyKey != null && idempotencyKey == null) {
      return NextResponse.json(
        { error: 'idempotencyKey is invalid (expected an 8–200 character opaque token)' },
        { status: 400 }
      );
    }

    const db = createBackgroundClient();

    // Same operation retried (double submit / network retry): return the
    // analysis that already exists instead of inserting a second row.
    if (idempotencyKey) {
      const existing = await findExistingAnalysis(db, userId, idempotencyKey);
      if (existing) {
        return NextResponse.json({
          analysisId: existing.id,
          status: existing.status || 'queued',
          reused: true,
        });
      }
    }

    // Never trust the client's repository id/owner/name: GitHub decides whether
    // this user can see the repository, and the resolved record is what we store.
    let access;
    try {
      access = await resolveRepositoryAccess(
        credential.credential.accessToken,
        repository.fullName
      );
    } catch (error) {
      return applyCredentialRefresh(githubErrorResponse(error), credential);
    }

    const { data: preference } = await db
      .from('user_model_preferences')
      .select('selected_strategy')
      .eq('user_id', userId)
      .maybeSingle();

    const rawStrategy = preference?.selected_strategy || 'auto';
    const modelStrategy =
      rawStrategy === 'balanced' || rawStrategy === 'quality' ? 'custom' : rawStrategy;

    const { data: insertedRows, error: insertError } = await db
      .from('analyses')
      .insert({
        user_id: userId,
        repository_id: String(access.repository.repoId),
        repository_full_name: access.repository.fullName,
        repository_owner: access.repository.owner,
        repository_name: access.repository.name,
        repository_source: 'github',
        issue_number: issue.number,
        issue_title: issue.title,
        status: 'queued',
        current_stage: 'issue_context',
        model_strategy: modelStrategy,
        // OAuth App authentication has no installation to record.
        github_installation_id: null,
        idempotency_key: idempotencyKey,
      })
      .select();

    if (insertError) {
      // Concurrent double submit: the other request won the unique index.
      // Treat the loser exactly like a sequential retry.
      if (idempotencyKey && isUniqueViolation(insertError)) {
        const existing = await findExistingAnalysis(db, userId, idempotencyKey);
        if (existing) {
          return NextResponse.json({
            analysisId: existing.id,
            status: existing.status || 'queued',
            reused: true,
          });
        }
      }

      if (isMissingSchema(insertError)) {
        console.error('[api/analyses] Idempotency migration missing:', insertError.message);
        return NextResponse.json(
          {
            error:
              'Failed to create analysis: apply supabase/migrations/019_analysis_idempotency.sql (idempotency_key column).',
          },
          { status: 500 }
        );
      }

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
      .eq('user_id', userId)
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
