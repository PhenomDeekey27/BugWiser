'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PublicImportForm } from '@/components/public/PublicImportForm';
import { fetchAuthSession, viewerFromSession } from '@/lib/auth/client-session';
import type { GitHubUser } from '@/types';

export default function PublicImportPage() {
  const [user, setUser] = useState<GitHubUser | null>(null);

  useEffect(() => {
    let alive = true;
    // Not `force`: a guest session created by "Inspect repository" is cached.
    void fetchAuthSession().then((session) => {
      if (!alive) return;
      const viewer = viewerFromSession(session);
      if (viewer) {
        setUser({ login: viewer.login, name: viewer.name, avatarUrl: viewer.avatarUrl });
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <AppShell user={user} gradient="new-analysis">
      <div className="p-6 max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-bw-peach-light">
            Public Repository Import
          </h1>
          <p className="mt-1 text-sm text-bw-peach leading-relaxed">
            Investigate an issue in any public GitHub repository. Branch and issue
            resolution is pinned to a commit so the evidence and patch come from
            the same snapshot.
          </p>
        </div>

        <PublicImportForm />
      </div>
    </AppShell>
  );
}
