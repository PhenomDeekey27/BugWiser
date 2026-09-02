'use client';

import { useState } from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { Button } from '@/components/ui/button';
import { GitHubUser } from '@/types';
import { Toaster } from 'sonner';
import { useTheme } from '@/components/theme/ThemeProvider';

interface AppShellProps {
  children: React.ReactNode;
  user?: GitHubUser | null;
  gradient?: 'dashboard' | 'workspace' | 'new-analysis';
}

export function AppShell({ children, user, gradient = 'dashboard' }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  return (
    <div
      className={`flex h-screen bg-page-${gradient} overflow-hidden`}
      data-page={gradient}
    >
      <Toaster
        position="top-right"
        toastOptions={{
          style: isDark ? {
            background: 'rgba(21, 25, 28, 0.95)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(41, 46, 51, 0.5)',
            color: '#F5F5F4',
          } : {
            background: '#FFFFFF',
            backdropFilter: 'blur(12px)',
            border: '1px solid #E8E0DA',
            color: '#1A1614',
          },
        }}
      />

      <Button
        variant="ghost"
        size="icon"
        className="fixed top-3 left-3 z-50 md:hidden w-8 h-8 bg-bw-surface border border-border text-bw-peach-light cursor-pointer"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        aria-label="Toggle sidebar"
      >
        <span className="text-sm">{sidebarOpen ? '✕' : '☰'}</span>
      </Button>

      <div
        className={`
          fixed inset-y-0 left-0 z-40 w-60 transform transition-transform duration-200 ease-in-out
          md:relative md:translate-x-0 md:flex-shrink-0
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        <Sidebar user={user} />
      </div>

      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/20 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <TopBar user={user} />
        <main className="flex-1 overflow-auto scrollbar-thin">
          {children}
        </main>
      </div>
    </div>
  );
}
