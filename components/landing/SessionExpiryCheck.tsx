'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';

export function SessionExpiryCheck() {
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (checked) return;

    async function check() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.provider_token) {
        // User is logged in but GitHub token is missing — session expired
        toast.error('Your GitHub session has expired. Please sign in again.', {
          duration: 6000,
          action: {
            label: 'Sign in',
            onClick: async () => {
              await supabase.auth.signOut();
              localStorage.removeItem('analysis-selection');
              router.push('/auth/github');
            },
          },
        });
        // Sign out so the header doesn't show user info
        await supabase.auth.signOut();
        localStorage.removeItem('analysis-selection');
        // Force refresh to clear user state
        router.refresh();
      }
      setChecked(true);
    }

    check();
  }, [checked, router]);

  return null;
}
