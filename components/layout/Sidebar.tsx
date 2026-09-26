'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { createClient } from '@/lib/supabase/client';
import { useGitHubAuthValidity } from '@/lib/supabase/auth-session';
import { GitHubUser } from '@/types';
import { toast } from 'sonner';
import { BugWiserLogo } from './BugWiserLogo';

interface SidebarProps {
  className?: string;
  user?: GitHubUser | null;
}

const navigation = [
  { label: 'Dashboard', href: '/dashboard', icon: '◈' },
  { label: 'New Analysis', href: '/analysis/new', icon: '⊕' },
  { label: 'AI Models', href: '/models', icon: '◪' },
];

export function Sidebar({ className, user }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const authValid = useGitHubAuthValidity();

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    localStorage.removeItem('analysis-selection');
    toast.success('Signed out successfully');
    setTimeout(() => {
      router.push('/');
    }, 800);
  };

  return (
    <aside
      className={cn(
        'flex flex-col w-60 h-full bg-surface border-r border-border',
        className
      )}
    >
      <Link href="/" className="flex items-center gap-2 px-4 py-4 pt-14 md:pt-4 cursor-pointer">
        <BugWiserLogo className="h-10 w-auto" />
      </Link>

      <div className="px-3 py-2">
        <Link href="/analysis/new" className="w-full cursor-pointer">
          <Button
            className="w-full justify-start gap-2 btn-bw-primary font-medium cursor-pointer"
          >
            <span className="text-lg leading-none">+</span>
            <span>New Analysis</span>
          </Button>
        </Link>
      </div>

      <Separator className="my-2 bg-border" />

      <nav className="flex-1 px-3 py-2 space-y-1">
        {navigation.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all cursor-pointer',
                isActive
                  ? 'bg-primary/8 text-primary-default border-l-2 border-primary'
                  : 'text-bw-peach hover:bg-surface-dim hover:text-bw-peach-light'
              )}
            >
              <span className="text-base">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <Separator className="my-2 bg-border" />

      <div className="px-3 py-2 space-y-1">
        {authValid ? (
          <>
            <div className="flex items-center gap-3 px-3 py-2 rounded text-sm text-bw-peach cursor-default">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              <span className="text-xs font-mono uppercase tracking-wider">GitHub Connected</span>
            </div>

            {user && (
              <div className="flex items-center gap-3 px-3 py-2 rounded text-sm text-bw-peach-light">
                {user.avatarUrl ? (
                  <img
                    src={user.avatarUrl}
                    alt={user.login}
                    className="w-5 h-5 rounded-full"
                    width={20}
                    height={20}
                  />
                ) : (
                  <span className="text-base">●</span>
                )}
                <span className="font-mono text-xs text-bw-peach truncate">@{user.login}</span>
              </div>
            )}

            <button
              onClick={handleSignOut}
              className="flex items-center gap-3 px-3 py-2 rounded text-sm text-bw-peach hover:bg-surface-dim hover:text-error-default cursor-pointer transition-colors w-full"
            >
              <span className="text-base">↗</span>
              <span>Sign Out</span>
            </button>
          </>
        ) : (
          <Link href="/auth/github" className="block px-3 py-2">
            <Button className="w-full justify-center btn-bw-primary font-medium cursor-pointer">
              Continue with GitHub
            </Button>
          </Link>
        )}
      </div>
    </aside>
  );
}
