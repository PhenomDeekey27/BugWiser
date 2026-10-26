import { NextResponse } from 'next/server';
import { createBackgroundClient } from '@/lib/supabase/background';
import { isMissingSchema } from '@/lib/analysis/idempotency';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PUBLIC_MIGRATION = 'supabase/migrations/020_public_repository_workspaces.sql';

/**
 * Tells the UI whether the database can store public-repository analyses.
 * A SELECT of the new columns is the cheapest reliable probe: PostgREST
 * validates column names before it returns any rows.
 */
export async function GET() {
  try {
    const db = createBackgroundClient();
    const { error } = await db
      .from('analyses')
      .select('repository_source, repository_url, repository_commit, issue_source, issue_description, workspace_status')
      .limit(1);

    if (!error) {
      return NextResponse.json({ ready: true }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (isMissingSchema(error)) {
      return NextResponse.json(
        {
          ready: false,
          code: 'schema_missing',
          error:
            'This database is missing the public-repository schema. Run the migration in the Supabase SQL editor, then reload.',
          migration: PUBLIC_MIGRATION,
        },
        { status: 503, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    console.error('[api/public/schema] Probe failed:', error.message);
    return NextResponse.json(
      { ready: false, code: 'schema_error', error: 'The database schema could not be checked.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error(
      '[api/public/schema] Unexpected failure:',
      error instanceof Error ? error.message : String(error)
    );
    return NextResponse.json(
      { ready: false, code: 'schema_error', error: 'The database schema could not be checked.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
