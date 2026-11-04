// Keeping a public-import investigation alive across GitHub sign-in.
//
// A visitor who imports a public repository without signing in still owns the
// analysis: `analyses.user_id` points at a guest user row, and every API route
// proves ownership against that id. GitHub sign-in resolves a DIFFERENT user id
// for the same person, so without a handoff the analysis would become invisible
// the moment they authenticate — exactly when they need it to push the fix.
//
// The handoff is deliberately narrow:
//   * only a guest session may transfer (a GitHub session never adopts rows);
//   * only when the GitHub identity was persisted, so the destination row exists;
//   * only rows owned by that guest, never another user's.
//
// It is best effort: a transfer failure must never fail sign-in. The analysis is
// still resumable later because the guest id is unchanged on failure.

import { createBackgroundClient } from '@/lib/supabase/background';

export interface GuestTransferDecision {
  guestUserId: string | null | undefined;
  githubUserId: string | null | undefined;
  previousSource: string | null | undefined;
  identityStatus: 'ok' | 'pending' | 'invalid';
}

export function shouldTransferGuestAnalyses(input: GuestTransferDecision): boolean {
  if (input.previousSource !== 'guest') return false;
  if (input.identityStatus !== 'ok') return false;
  if (!input.guestUserId || !input.githubUserId) return false;
  return input.guestUserId !== input.githubUserId;
}

export interface GuestTransferResult {
  moved: number;
  error: string | null;
}

/**
 * Reassigns the guest's analyses to the GitHub user. Never throws: the caller is
 * the OAuth callback, where a storage problem is not a sign-in failure.
 */
export async function transferGuestAnalyses(
  guestUserId: string,
  githubUserId: string
): Promise<GuestTransferResult> {
  if (guestUserId === githubUserId) return { moved: 0, error: null };

  try {
    const db = createBackgroundClient();
    const { data, error } = await db
      .from('analyses')
      .update({ user_id: githubUserId })
      .eq('user_id', guestUserId)
      .select('id');

    if (error) {
      console.error('[auth/guest-transfer] Could not transfer guest analyses:', error.message);
      return { moved: 0, error: error.message };
    }

    const moved = Array.isArray(data) ? data.length : 0;
    if (moved > 0) {
      console.log(`[auth/guest-transfer] Transferred ${moved} analysis row(s) to the GitHub user.`);
    }
    return { moved, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error('[auth/guest-transfer] Guest transfer failed:', message);
    return { moved: 0, error: message };
  }
}
