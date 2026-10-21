// Maps a verified GitHub numeric identity onto a BugWiser user UUID.
//
// Rules:
//  - The stable GitHub numeric id is the external key. Login/email are never
//    used to match.
//  - An existing Supabase user with the same GitHub provider identity keeps its
//    UUID, so analyses, artifacts, settings, and ownership rows are preserved.
//  - Otherwise a user record is provisioned in auth.users with a reserved,
//    non-deliverable `.invalid` address. Email is never used for matching.

import { createBackgroundClient } from '@/lib/supabase/background';
import { decryptSecret, encryptSecret } from '@/lib/ai/connection/encryption';

export interface GitHubIdentityProfile {
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string;
}

export class IdentityLinkError extends Error {
  code: 'identity_conflict' | 'identity_storage_failed' | 'user_provision_failed';

  constructor(message: string, code: IdentityLinkError['code']) {
    super(message);
    this.name = 'IdentityLinkError';
    this.code = code;
  }
}

function isNumericId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function syntheticEmail(githubUserId: number): string {
  // RFC 2606 reserved TLD: can never be delivered and is not a real contact.
  return `github-${githubUserId}@accounts.bugwiser.invalid`;
}

export async function findOrCreateUserId(profile: GitHubIdentityProfile): Promise<string> {
  if (!isNumericId(profile.id)) {
    throw new IdentityLinkError('GitHub returned an invalid user id', 'identity_storage_failed');
  }

  const db = createBackgroundClient();

  const { data: existingIdentity, error: identityReadError } = await db
    .from('github_identities')
    .select('user_id')
    .eq('github_user_id', profile.id)
    .maybeSingle();

  if (identityReadError) {
    console.error('[github-identity] Failed to read identity:', identityReadError.message);
    throw new IdentityLinkError('Could not read GitHub identity', 'identity_storage_failed');
  }

  if (existingIdentity?.user_id) {
    await db
      .from('github_identities')
      .update({
        login: profile.login,
        avatar_url: profile.avatarUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('github_user_id', profile.id);
    return existingIdentity.user_id as string;
  }

  // Existing Supabase OAuth user: same GitHub numeric id, same BugWiser UUID.
  let userId: string | null = null;
  const { data: mappedUserId, error: rpcError } = await db.rpc('find_auth_user_by_github_id', {
    p_github_id: String(profile.id),
  });

  if (rpcError) {
    console.warn('[github-identity] Identity lookup RPC unavailable:', rpcError.message);
  } else if (typeof mappedUserId === 'string' && mappedUserId.length > 0) {
    userId = mappedUserId;
  }

  if (!userId) {
    userId = await provisionUser(profile).catch((error) => {
      if (error instanceof IdentityLinkError) throw error;
      throw new IdentityLinkError('Could not provision BugWiser user', 'user_provision_failed');
    });
  }

  const { error: insertError } = await db.from('github_identities').insert({
    github_user_id: profile.id,
    user_id: userId,
    login: profile.login,
    avatar_url: profile.avatarUrl,
  });

  if (insertError) {
    // A concurrent login may have inserted the same identity first.
    const { data: raced } = await db
      .from('github_identities')
      .select('user_id')
      .eq('github_user_id', profile.id)
      .maybeSingle();
    if (raced?.user_id && raced.user_id === userId) return userId as string;

    if (raced?.user_id) {
      // Same GitHub account linked to a different BugWiser user by a racing
      // request is fine only when the UUID also matches the resolved user.
      return raced.user_id as string;
    }

    if (insertError.code === '23505') {
      throw new IdentityLinkError(
        'This BugWiser account is already linked to a different GitHub identity.',
        'identity_conflict'
      );
    }

    console.error('[github-identity] Failed to store identity:', insertError.message);
    throw new IdentityLinkError('Could not store GitHub identity', 'identity_storage_failed');
  }

  return userId;
}

async function provisionUser(profile: GitHubIdentityProfile): Promise<string> {
  const db = createBackgroundClient();
  const { data, error } = await db.auth.admin.createUser({
    email: syntheticEmail(profile.id),
    email_confirm: true,
    user_metadata: {
      sub: String(profile.id),
      provider_id: String(profile.id),
      provider: 'github',
      user_name: profile.login,
      preferred_username: profile.login,
      full_name: profile.name,
      avatar_url: profile.avatarUrl,
      bugwiser_identity: 'github_app',
    },
  });

  if (error || !data.user?.id) {
    console.error('[github-identity] User provisioning failed:', error?.message || 'no user returned');
    throw new IdentityLinkError('Could not provision BugWiser user', 'user_provision_failed');
  }

  return data.user.id;
}

/**
 * Store the GitHub App user-to-server token encrypted at rest. It is used only
 * to verify installation ownership and to enumerate installations; it never
 * leaves the server.
 */
export async function storeUserAccessToken(
  githubUserId: number,
  accessToken: string,
  expiresAt: Date
): Promise<void> {
  const db = createBackgroundClient();
  const { error } = await db
    .from('github_identities')
    .update({
      user_token_enc: encryptSecret(accessToken),
      user_token_expires_at: expiresAt.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('github_user_id', githubUserId);

  if (error) {
    // Token storage is best-effort: installation setup falls back to a fresh
    // OAuth roundtrip when no token is available.
    console.warn('[github-identity] Could not persist user token:', error.message);
  }
}

export async function getStoredUserAccessToken(githubUserId: number): Promise<string | null> {
  const db = createBackgroundClient();
  const { data, error } = await db
    .from('github_identities')
    .select('user_token_enc, user_token_expires_at')
    .eq('github_user_id', githubUserId)
    .maybeSingle();

  if (error || !data?.user_token_enc) return null;

  const expiresAt = data.user_token_expires_at ? Date.parse(data.user_token_expires_at as string) : 0;
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() + 30_000) return null;

  try {
    return decryptSecret(data.user_token_enc as string);
  } catch {
    console.warn('[github-identity] Stored GitHub token could not be decrypted');
    return null;
  }
}
