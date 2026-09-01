'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { GitHubUser } from '@/types';
import { BugWiserLogo } from '@/components/layout/BugWiserLogo';
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
    <header className="flex items-center justify-between px-4 md:px-6 py-4 bg-bw-burgundy/40 backdrop-blur-md border-b border-bw-burgundy/50 relative z-20">
      <Link href="/" className="flex items-center gap-2.5 cursor-pointer">
        <BugWiserLogo className="h-8 w-auto" />
      </Link>

      <div className="flex items-center gap-4">
        {user ? (
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono hidden sm:block" style={{ color: '#D6AEA1' }}>
              @{user.login}
            </span>
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="flex items-center justify-center w-8 h-8 rounded-full overflow-hidden cursor-pointer transition-all"
                style={{ background: '#6F1F24' }}
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
                  <span className="text-sm font-medium" style={{ color: '#FFE1C7' }}>
                    {user.login?.charAt(0).toUpperCase()}
                  </span>
                )}
              </button>

              {dropdownOpen && (
                <div
                  className="absolute right-0 top-full mt-2 w-56 rounded-lg shadow-xl z-50 overflow-hidden"
                  style={{ background: '#281416', border: '1px solid #542A2B' }}
                >
                  <div className="px-4 py-3" style={{ borderBottom: '1px solid #542A2B' }}>
                    <p className="text-sm font-medium" style={{ color: '#F2D1BC' }}>{user.name || user.login}</p>
                    <p className="text-xs font-mono" style={{ color: '#C99F94' }}>@{user.login}</p>
                  </div>
                  <div className="py-1">
                    <button
                      onClick={() => { setDropdownOpen(false); router.push('/dashboard'); }}
                      className="w-full text-left px-4 py-2 text-sm transition-colors cursor-pointer"
                      style={{ color: '#E2B9AA' }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = '#3A1A1D'; e.currentTarget.style.color = '#FFE1C7'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#E2B9AA'; }}
                    >
                      Dashboard
                    </button>
                    <button
                      onClick={() => { setDropdownOpen(false); router.push('/analysis/new'); }}
                      className="w-full text-left px-4 py-2 text-sm transition-colors cursor-pointer"
                      style={{ color: '#E2B9AA' }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = '#3A1A1D'; e.currentTarget.style.color = '#FFE1C7'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#E2B9AA'; }}
                    >
                      New Analysis
                    </button>
                    <div style={{ borderTop: '1px solid #542A2B', margin: '4px 0' }} />
                    <button
                      onClick={handleSignOut}
                      className="w-full text-left px-4 py-2 text-sm transition-colors cursor-pointer"
                      style={{ color: '#F0B8AE' }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = '#3A1A1D'; e.currentTarget.style.color = '#FFD0C7'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#F0B8AE'; }}
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
              className="px-4 py-2 rounded text-sm font-medium cursor-pointer transition-colors"
              style={{ background: '#6F1F24', color: '#FFE1C7', border: '1px solid #8C4547' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#81282D';
                e.currentTarget.style.color = '#FFE8D5';
                e.currentTarget.style.borderColor = '#A65A59';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#6F1F24';
                e.currentTarget.style.color = '#FFE1C7';
                e.currentTarget.style.borderColor = '#8C4547';
              }}
            >
              Continue with GitHub
            </button>
          </Link>
        )}
      </div>
    </header>
  );
}
