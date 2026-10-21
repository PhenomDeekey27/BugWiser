import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { fetchIssues, isPullRequest } from '@/lib/github/issues';
import {
  assertTokenPermissions,
  getRepositoryAccessToken,
} from '@/lib/github/app/access';
import { githubErrorResponse } from '@/lib/github/app/http';
import { Issue } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const owner = searchParams.get('owner');
  const repo = searchParams.get('repo');
  const state = searchParams.get('state') as 'open' | 'closed' | 'all' | null;
  const pageRaw = searchParams.get('page');
  const page = pageRaw ? Number.parseInt(pageRaw, 10) : 1;

  if (!owner || !repo) {
    return NextResponse.json(
      { error: 'owner and repo query parameters are required' },
      { status: 400 }
    );
  }
  if (!Number.isSafeInteger(page) || page <= 0) {
    return NextResponse.json({ error: 'page must be a positive integer' }, { status: 400 });
  }

  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const { token } = await getRepositoryAccessToken(user.userId, `${owner}/${repo}`);
    assertTokenPermissions(token, { issues: 'read' });

    const { issues: githubIssues } = await fetchIssues(
      token.token,
      owner,
      repo,
      state || 'open',
      page,
      30
    );

    const issues: Issue[] = githubIssues
      .filter((issue) => !isPullRequest(issue))
      .map((issue) => ({
        id: String(issue.id),
        number: issue.number,
        title: issue.title,
        body: issue.body || '',
        state: issue.state,
        labels: issue.labels.map((l) => l.name),
        assignees: issue.assignees.map((a) => a.login),
        createdAt: issue.created_at,
        updatedAt: issue.updated_at,
        closedAt: issue.closed_at,
        comments: issue.comments,
        htmlUrl: issue.html_url,
        userLogin: issue.user.login,
        repositoryId: `${owner}/${repo}`,
      }));

    return NextResponse.json({ issues }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return githubErrorResponse(error);
  }
}
