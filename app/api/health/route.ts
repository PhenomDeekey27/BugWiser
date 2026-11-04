import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { probeDatabase } from '@/lib/auth/neon-user-store';
import { getGitHubOAuthConfigProblem, isGitHubOAuthConfigured } from '@/lib/github/oauth/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Deployment diagnostics for a signed-in user.
 *
 * `github_oauth` answers whether sign-in can work at all (configuration only,
 * never a secret). `database` is reported separately on purpose: the database is
 * not required to sign in with GitHub, so a suspended Neon compute is a warning,
 * not an outage of authentication.
 */
export async function GET() {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const database = await probeDatabase();

    return NextResponse.json({
      ok: true,
      source: user.source,
      github_oauth: {
        configured: isGitHubOAuthConfigured(),
        problem: getGitHubOAuthConfigProblem(),
      },
      // The driver message can name a host, so only a boolean leaves here.
      database: { ok: database.ok },
    });
  } catch (error) {
    const err = error as Error;
    console.error('[api/health] Error:', err.message);
    return NextResponse.json({ error: 'Failed to check health' }, { status: 500 });
  }
}
