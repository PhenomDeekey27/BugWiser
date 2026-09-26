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
        await supabase.auth.signOut();
        localStorage.removeItem('analysis-selection');
        router.refresh();
        toast.error('Your GitHub session has expired. Please sign in again.', {
          duration: 8000,
          action: {
            label: 'Sign in',
            onClick: () => {
              router.replace('/auth/github');
            },
          },
        });
      }
      setChecked(true);
    }

    check();
  }, [checked, router]);

  return null;
}
