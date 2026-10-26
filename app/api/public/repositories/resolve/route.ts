import { NextResponse } from 'next/server';
import { resolveOrCreateGuest } from '@/lib/auth/guest';
import { setSessionCookie } from '@/lib/auth/session';
import { publicErrorResponse } from '@/lib/github/public-http';
import {
  fetchPublicBranches,
  fetchPublicRepository,
  normalizeCommitSha,
  parsePublicRepositoryUrl,
  resolvePublicCommit,
  resolvePublicRef,
} from '@/lib/github/public';
import { publicReadToken } from '@/lib/analysis/repository-source';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface ResolveBody {
  url?: unknown;
  branch?: unknown;
  commit?: unknown;
}

/**
 * Validates a public repository reference and pins it to a commit. The branch
 * is resolved once, here and again when the analysis is created, so the
 * analysis always reads one immutable snapshot.
 */
export async function POST(request: Request) {
  let body: ResolveBody;
  try {
    body = (await request.json()) as ResolveBody;
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (typeof body.url !== 'string') {
    return NextResponse.json(
      { error: 'Repository URL is required.', code: 'invalid_url' },
      { status: 400 }
    );
  }

  // Validate the URL before provisioning anything: an invalid request must not
  // create a guest user or spend GitHub rate limit.
  let parsed: ReturnType<typeof parsePublicRepositoryUrl>;
  try {
    parsed = parsePublicRepositoryUrl(body.url);
  } catch (error) {
    return publicErrorResponse(error);
  }

  const requestedCommit =
    typeof body.commit === 'string' ? normalizeCommitSha(body.commit) : null;
  if (typeof body.commit === 'string' && !requestedCommit) {
    return NextResponse.json(
      { error: 'Commit must be a full 40-character SHA.', code: 'invalid_commit' },
      { status: 400 }
    );
  }

  // Importing does not require a GitHub account, but every analysis needs an
  // owning session. Anonymous visitors are upgraded to a guest session.
  let guestCreated = false;
  let cookieUser = null;
  try {
    const guest = await resolveOrCreateGuest();
    guestCreated = guest.created;
    cookieUser = guest.user;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Could not start a session.';
    return NextResponse.json({ error: message }, { status: 503 });
  }

  try {
    const options = { token: publicReadToken() };
    const repository = await fetchPublicRepository(parsed.owner, parsed.repo, options);
    const branches = await fetchPublicBranches(parsed.owner, parsed.repo, options);

    const requestedBranch =
      typeof body.branch === 'string' && body.branch.trim()
        ? body.branch.trim()
        : parsed.ref || repository.defaultBranch;

    const resolved = requestedCommit
      ? await resolvePublicCommit(parsed.owner, parsed.repo, requestedCommit, options)
      : await resolvePublicRef(parsed.owner, parsed.repo, requestedBranch, options);

    const response = NextResponse.json(
      {
        repository: {
          id: String(repository.repoId),
          name: repository.name,
          fullName: repository.fullName,
          owner: repository.owner,
          description: repository.description,
          language: repository.language,
          stars: repository.stars,
          forks: repository.forks,
          defaultBranch: repository.defaultBranch,
          htmlUrl: repository.htmlUrl,
          private: false,
        },
        branch: requestedBranch,
        defaultBranch: repository.defaultBranch,
        commit: {
          sha: resolved.commitSha,
          message: resolved.message,
          committedAt: resolved.committedAt,
          htmlUrl: resolved.htmlUrl,
        },
        pinnedFrom: requestedCommit ? 'commit' : 'branch',
        branches: branches.map((branch) => ({
          name: branch.name,
          sha: branch.sha,
          protected: branch.protected,
        })),
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );

    if (guestCreated && cookieUser) setSessionCookie(response, cookieUser);
    return response;
  } catch (error) {
    return publicErrorResponse(error);
  }
}
