'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { GitHubUser } from '@/types';
import { toast } from 'sonner';

interface TopBarProps {
  className?: string;
  user?: GitHubUser | null;
}

export function TopBar({ className, user }: TopBarProps) {
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
    <header
      className={`flex items-center justify-between h-12 px-4 bg-surface-glass border-b border-bw-burgundy/50 ${className}`}
    >
      <div className="flex-1" />

      <div className="flex items-center gap-3">
        {user && (
          <span className="text-xs font-mono text-bw-peach hidden sm:block">
            @{user.login}
          </span>
        )}

        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex items-center justify-center w-8 h-8 rounded-full bg-surface-container-high overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary-container/40 transition-all"
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
            <div className="absolute right-0 top-full mt-2 w-56 surface-elevated rounded-lg shadow-xl z-50 overflow-hidden">
              {user && (
                <div className="px-4 py-3 border-b border-bw-burgundy/30">
                  <p className="text-sm font-medium text-bw-peach-light">{user.name || user.login}</p>
                  <p className="text-xs font-mono text-bw-peach">@{user.login}</p>
                </div>
              )}
              <div className="py-1">
                <button
                  onClick={() => { setDropdownOpen(false); router.push('/dashboard'); }}
                  className="w-full text-left px-4 py-2 text-sm text-bw-peach-light hover:bg-bw-burgundy/20 transition-colors cursor-pointer"
                >
                  Dashboard
                </button>
                <button
                  onClick={() => { setDropdownOpen(false); router.push('/analysis/new'); }}
                  className="w-full text-left px-4 py-2 text-sm text-bw-peach-light hover:bg-bw-burgundy/20 transition-colors cursor-pointer"
                >
                  New Analysis
                </button>
                <div className="border-t border-bw-burgundy/30 my-1" />
                <button
                  onClick={handleSignOut}
                  className="w-full text-left px-4 py-2 text-sm text-error-default hover:bg-error-container/20 transition-colors cursor-pointer"
                >
                  Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
