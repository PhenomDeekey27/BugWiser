'use client';

import { useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';

const REASON_MESSAGES: Record<string, string> = {
  invalid_installation: 'GitHub did not send a valid installation reference. Install the App again.',
  missing_installation_context:
    'That installation link expired. Install the GitHub App again to reconnect.',
  identity_unavailable:
    "We couldn't confirm your GitHub identity. Sign in again to finish connecting.",
  not_owned: 'That installation belongs to a different GitHub account.',
  suspended: 'The GitHub App installation is suspended. Re-enable it on GitHub, then reconnect.',
  rate_limited: 'GitHub is rate-limiting requests right now. Try again in a minute.',
  not_configured: 'The GitHub App is not configured on this deployment.',
  slug_missing: 'The GitHub App slug is not set on this deployment (GITHUB_APP_SLUG).',
  slug_invalid:
    'GITHUB_APP_SLUG is invalid. Use the App slug only (for example "my-app"), not a GitHub URL.',
  installation_failed: "We couldn't finish connecting the installation. Please try again.",
};

/** Surfaces the outcome of an install / reconnect roundtrip exactly once. */
export function GitHubStatusToast() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const status = searchParams.get('github');
  const reason = searchParams.get('reason');

  useEffect(() => {
    if (!status) return;

    if (status === 'connected') {
      toast.success('GitHub App connected. Your repositories are now available.');
    } else if (status === 'updated') {
      toast.success('Repository access updated.');
    } else if (status === 'pending_approval') {
      toast.info('Waiting for an organisation owner to approve the GitHub App installation.');
    } else if (status === 'error') {
      toast.error(
        (reason && REASON_MESSAGES[reason]) ||
          "We couldn't connect your GitHub App installation. Please try again."
      );
    }

    // Remove the one-time params so a refresh does not repeat the toast.
    const params = new URLSearchParams(searchParams.toString());
    params.delete('github');
    params.delete('reason');
    const query = params.toString();
    router.replace(`/dashboard${query ? `?${query}` : ''}`);
  }, [status, reason, searchParams, router]);

  return null;
}
