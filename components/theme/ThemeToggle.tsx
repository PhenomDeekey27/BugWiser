'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from './ThemeProvider';

interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  const { toggleTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label="Toggle theme"
      title="Toggle theme"
      className={`flex items-center justify-center w-8 h-8 rounded-lg border border-border bg-surface-dim text-bw-peach hover:text-bw-peach-light hover:ring-2 hover:ring-primary/20 transition-all cursor-pointer ${className || ''}`}
    >
      <Sun className="hidden w-4 h-4 dark:block" />
      <Moon className="block w-4 h-4 dark:hidden" />
    </button>
  );
}