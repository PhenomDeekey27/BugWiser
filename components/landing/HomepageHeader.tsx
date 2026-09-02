'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { GitHubUser } from '@/types';
import { BugWiserLogo } from '@/components/layout/BugWiserLogo';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { toast } from 'sonner';

interface HomepageHeaderProps {
  user?: GitHubUser | null;
}

export function HomepageHeader({ user }: HomepageHeaderProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    localStorage.removeItem('analysis-selection');
    setDropdownOpen(false);
    toast.success('Signed out successfully');
    setTimeout(() => {
      router.push('/');
    }, 800);
  };

  return (
    <header className="flex items-center justify-between px-5 md:px-8 py-3.5 bg-bw-surface/60 backdrop-blur-lg border-b border-border relative z-20">
      <Link href="/" className="flex items-center gap-2.5 cursor-pointer">
        <BugWiserLogo className="h-8 w-auto" />
      </Link>

      <div className="flex items-center gap-3">
        <ThemeToggle />
        {user ? (
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-bw-dusty-rose hidden sm:block">
              @{user.login}
            </span>
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="flex items-center justify-center w-8 h-8 rounded-full overflow-hidden cursor-pointer transition-all hover:ring-2 hover:ring-primary/15"
                style={{ background: '#F0EBE6' }}
              >
                {user.avatarUrl ? (
                  <img
                    src={user.avatarUrl}
                    alt={user.login}
                    className="w-8 h-8 rounded-full"
                    width={32}
                    height={32}
                  />
                ) : (
                  <span className="text-sm font-medium text-bw-peach">
                    {user.login?.charAt(0).toUpperCase()}
                  </span>
                )}
              </button>

              {dropdownOpen && (
                <div
                  className="absolute right-0 top-full mt-2 w-56 rounded-xl shadow-lg z-50 overflow-hidden bg-bw-surface/90 backdrop-blur-xl border border-border"
                >
                  <div className="px-4 py-3 border-b border-border">
                    <p className="text-sm font-medium text-bw-peach-light">{user.name || user.login}</p>
                    <p className="text-xs font-mono text-bw-dusty-rose">@{user.login}</p>
                  </div>
                  <div className="py-1">
                    <button
                      onClick={() => { setDropdownOpen(false); router.push('/dashboard'); }}
                      className="w-full text-left px-4 py-2 text-sm text-bw-peach hover:bg-surface-dim transition-colors cursor-pointer"
                    >
                      Dashboard
                    </button>
                    <button
                      onClick={() => { setDropdownOpen(false); router.push('/analysis/new'); }}
                      className="w-full text-left px-4 py-2 text-sm text-bw-peach hover:bg-surface-dim transition-colors cursor-pointer"
                    >
                      New Analysis
                    </button>
                    <div className="border-t border-border my-1" />
                    <button
                      onClick={handleSignOut}
                      className="w-full text-left px-4 py-2 text-sm text-error-default hover:bg-error-container/10 transition-colors cursor-pointer"
                    >
                      Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <Link href="/auth/github">
            <button
              className="px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-all btn-bw-primary"
            >
              Continue with GitHub
            </button>
          </Link>
        )}
      </div>
    </header>
  );
}
