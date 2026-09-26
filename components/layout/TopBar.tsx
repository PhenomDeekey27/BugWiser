'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useGitHubAuthValidity } from '@/lib/supabase/auth-session';
import { GitHubUser } from '@/types';
import { toast } from 'sonner';
import { ThemeToggle } from '@/components/theme/ThemeToggle';

interface TopBarProps {
  className?: string;
  user?: GitHubUser | null;
}

export function TopBar({ className, user }: TopBarProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const authValid = useGitHubAuthValidity();

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
    <header
      className={`flex items-center justify-between h-12 px-4 bg-surface border-b border-border ${className}`}
    >
      <div className="flex-1" />

      <div className="flex items-center gap-3">
        <ThemeToggle />

        {authValid ? (
          <>
            {user && (
              <span className="text-xs font-mono text-bw-peach hidden sm:block">
                @{user.login}
              </span>
            )}

            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="flex items-center justify-center w-8 h-8 rounded-full bg-surface-dim overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary/20 transition-all"
              >
                {user?.avatarUrl ? (
                  <img
                    src={user.avatarUrl}
                    alt={user.login}
                    className="w-8 h-8 rounded-full"
                    width={32}
                    height={32}
                  />
                ) : (
                  <span className="text-sm font-medium text-bw-peach-light">
                    {user?.login?.charAt(0).toUpperCase() || 'U'}
                  </span>
                )}
              </button>

              {dropdownOpen && (
                <div className="absolute right-0 top-full mt-2 w-56 bg-surface border border-border rounded-lg shadow-lg z-50 overflow-hidden">
                  {user && (
                    <div className="px-4 py-3 border-b border-border">
                      <p className="text-sm font-medium text-bw-peach-light">{user.name || user.login}</p>
                      <p className="text-xs font-mono text-bw-peach">@{user.login}</p>
                    </div>
                  )}
                  <div className="py-1">
                    <button
                      onClick={() => { setDropdownOpen(false); router.push('/dashboard'); }}
                      className="w-full text-left px-4 py-2 text-sm text-bw-peach-light hover:bg-surface-dim transition-colors cursor-pointer"
                    >
                      Dashboard
                    </button>
                    <button
                      onClick={() => { setDropdownOpen(false); router.push('/analysis/new'); }}
                      className="w-full text-left px-4 py-2 text-sm text-bw-peach-light hover:bg-surface-dim transition-colors cursor-pointer"
                    >
                      New Analysis
                    </button>
                    <button
                      onClick={() => { setDropdownOpen(false); router.push('/models'); }}
                      className="w-full text-left px-4 py-2 text-sm text-bw-peach-light hover:bg-surface-dim transition-colors cursor-pointer"
                    >
                      AI Models
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
          </>
        ) : (
          <Link href="/auth/github">
            <button className="px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-all btn-bw-primary">
              Continue with GitHub
            </button>
          </Link>
        )}
      </div>
    </header>
  );
}
