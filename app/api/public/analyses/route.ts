import { NextResponse } from 'next/server';
import { resolveOrCreateGuest } from '@/lib/auth/guest';
import { setSessionCookie } from '@/lib/auth/session';
import { createBackgroundClient } from '@/lib/supabase/background';
import { publicErrorResponse } from '@/lib/github/public-http';
import {
  fetchPublicIssue,
  fetchPublicRepository,
  PublicRepositoryError,
  resolvePublicCommit,
  resolvePublicRef,
} from '@/lib/github/public';
import { validatePublicAnalysisInput } from '@/lib/analysis/public-request';
import { publicReadToken } from '@/lib/analysis/repository-source';
import {
  ANALYSIS_IDEMPOTENCY_HEADER,
  isMissingSchema,
  isUniqueViolation,
  normalizeAnalysisIdempotencyKey,
} from '@/lib/analysis/idempotency';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface PublicAnalysisBody {
  repositoryUrl?: unknown;
  branch?: unknown;
  commit?: unknown;
  issueUrl?: unknown;
  issueNumber?: unknown;
  description?: unknown;
  title?: unknown;
  idempotencyKey?: unknown;
}

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
    if (isMissingSchema(error)) {
      throw new Error(
        'Analysis idempotency is not available: apply supabase/migrations/019_analysis_idempotency.sql.'
      );
    }
    throw new Error(`Failed to check existing analysis: ${error.message}`);
  }
  return data ? { id: data.id as string, status: (data.status as string | null) ?? null } : null;
}

/**
 * Creates a public-repository analysis without a GitHub App installation.
 * The request is validated and pinned to a full commit SHA before any row is
 * written; nothing from the client (ids, owner, branch head) is trusted.
 */
export async function POST(request: Request) {
  let body: PublicAnalysisBody;
  try {
    body = (await request.json()) as PublicAnalysisBody;
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (typeof body.repositoryUrl !== 'string' || !body.repositoryUrl.trim()) {
    return NextResponse.json(
      { error: 'Repository URL is required.', code: 'invalid_url' },
      { status: 400 }
    );
  }

  // Pure validation first: an invalid request must not provision a guest or
  // consume GitHub API calls.
  const validated = validatePublicAnalysisInput({
    repositoryUrl: body.repositoryUrl,
    commit: typeof body.commit === 'string' ? body.commit : null,
    issueUrl: typeof body.issueUrl === 'string' ? body.issueUrl : null,
    issueNumber: body.issueNumber,
    description: typeof body.description === 'string' ? body.description : null,
    title: typeof body.title === 'string' ? body.title : null,
  });

  if (!validated.ok) {
    return NextResponse.json(
      { error: validated.message, code: validated.code },
      { status: 400 }
    );
  }

  let guestCreated = false;
  let cookieUser = null;
  let userId: string;
  try {
    const guest = await resolveOrCreateGuest();
    guestCreated = guest.created;
    cookieUser = guest.user;
    userId = guest.user.userId;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not start a session.';
    return NextResponse.json({ error: message }, { status: 503 });
  }

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

  try {
    const parsedRepo = validated.repository;
    const options = { token: publicReadToken() };
    const repository = await fetchPublicRepository(parsedRepo.owner, parsedRepo.repo, options);

    const requestedBranch =
      typeof body.branch === 'string' && body.branch.trim()
        ? body.branch.trim()
        : parsedRepo.ref || repository.defaultBranch;

    const commitSha =
      validated.commit ||
      (await resolvePublicRef(parsedRepo.owner, parsedRepo.repo, requestedBranch, options))
        .commitSha;

    // Re-resolve through the commit endpoint so the pinned SHA is proven to
    // exist on this repository even when the client supplied it.
    const resolved = await resolvePublicCommit(
      parsedRepo.owner,
      parsedRepo.repo,
      commitSha,
      options
    );

    let issueNumber = 0;
    let issueTitle = validated.title;
    let issueUrl: string | null = null;
    let issueDescription: string | null = validated.description;
    let issueSource: 'github' | 'description' = 'description';

    const requestedIssueNumber = validated.issue?.number ?? validated.issueNumber ?? null;
    if (requestedIssueNumber !== null) {
      // Resolve through the API so the issue exists, belongs to this repository,
      // and is not a pull request served from the issues endpoint.
      const issue = await fetchPublicIssue(
        parsedRepo.owner,
        parsedRepo.repo,
        requestedIssueNumber,
        options
      );
      issueNumber = issue.number;
      issueTitle = issue.title;
      issueUrl = issue.htmlUrl;
      issueDescription = null;
      issueSource = 'github';
    }

    const db = createBackgroundClient();

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
        repository_id: String(repository.repoId),
        repository_full_name: repository.fullName,
        repository_owner: repository.owner,
        repository_name: repository.name,
        issue_number: issueNumber,
        issue_title: issueTitle,
        status: 'queued',
        current_stage: 'issue_context',
        model_strategy: modelStrategy,
        github_installation_id: null,
        idempotency_key: idempotencyKey,
        repository_source: 'public',
        repository_url: repository.htmlUrl,
        repository_branch: requestedBranch,
        repository_default_branch: repository.defaultBranch,
        repository_commit: resolved.commitSha,
        issue_source: issueSource,
        issue_url: issueUrl,
        issue_description: issueDescription,
      })
      .select('id')
      .single();

    if (insertError) {
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
        console.error('[api/public/analyses] Migration missing:', insertError.message);
        return NextResponse.json(
          {
            error:
              'This database is missing the public-repository schema. Run supabase/migrations/020_public_repository_workspaces.sql in the Supabase SQL editor (or `supabase db push`), then retry.',
            code: 'schema_missing',
            migration: 'supabase/migrations/020_public_repository_workspaces.sql',
          },
          { status: 503 }
        );
      }

      console.error('[api/public/analyses] Insert error:', insertError.message);
      return NextResponse.json(
        { error: `Failed to create analysis: ${insertError.message}` },
        { status: 500 }
      );
    }

    const response = NextResponse.json({
      analysisId: insertedRows.id,
      status: 'queued',
      repository: repository.fullName,
      branch: requestedBranch,
      commitSha: resolved.commitSha,
      issueNumber,
      issueSource,
    });

    if (guestCreated && cookieUser) setSessionCookie(response, cookieUser);
    return response;
  } catch (error) {
    if (error instanceof PublicRepositoryError) {
      return publicErrorResponse(error);
    }
    console.error(
      '[api/public/analyses] Unexpected failure:',
      error instanceof Error ? error.message : String(error)
    );
    return NextResponse.json(
      { error: 'Could not create the analysis. Check the server logs and retry.', code: 'analysis_create_failed' },
      { status: 500 }
    );
  }
}
