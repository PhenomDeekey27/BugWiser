'use client';

import { useState } from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { Button } from '@/components/ui/button';
import { GitHubUser } from '@/types';
import { Toaster } from 'sonner';

interface AppShellProps {
  children: React.ReactNode;
  user?: GitHubUser | null;
  gradient?: 'dashboard' | 'workspace' | 'new-analysis';
}

const gradientClasses = {
  dashboard: 'bg-page-dashboard',
  workspace: 'bg-page-workspace',
  'new-analysis': 'bg-page-new-analysis',
};

export function AppShell({ children, user, gradient = 'dashboard' }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className={`flex h-screen ${gradientClasses[gradient]} overflow-hidden`}>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: 'rgba(36, 20, 22, 0.95)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(89, 23, 27, 0.5)',
            color: '#FED7B8',
          },
        }}
      />

      <Button
        variant="ghost"
        size="icon"
        className="fixed top-3 left-3 z-50 md:hidden w-8 h-8 bg-surface-container/90 border border-bw-burgundy/50 text-bw-peach-light"
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
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
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
