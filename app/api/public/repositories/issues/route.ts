import { NextResponse } from 'next/server';
import { fetchPublicIssues } from '@/lib/github/public';
import { publicErrorResponse } from '@/lib/github/public-http';
import { publicReadToken } from '@/lib/analysis/repository-source';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_STATES = new Set(['open', 'closed', 'all']);

/**
 * Read-only issue list for a public repository. This is what lets the public
 * flow behave like the installed-repository flow: pick an issue instead of
 * pasting its URL.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const owner = (params.get('owner') || '').trim();
  const repo = (params.get('repo') || '').trim();
  const state = (params.get('state') || 'open').trim();

  if (!owner || !repo) {
    return NextResponse.json(
      { error: 'owner and repo are required.', code: 'invalid_url' },
      { status: 400 }
    );
  }
  if (!ALLOWED_STATES.has(state)) {
    return NextResponse.json(
      { error: 'state must be open, closed or all.', code: 'invalid_url' },
      { status: 400 }
    );
  }

  try {
    const issues = await fetchPublicIssues(
      owner,
      repo,
      { token: publicReadToken() },
      { state: state as 'open' | 'closed' | 'all', perPage: 30 }
    );
    return NextResponse.json({ issues }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return publicErrorResponse(error);
  }
}
