'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';

type Theme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  resolvedTheme: Theme;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const THEME_STORAGE_KEY = 'bugwiser-theme';

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch { /* ignore */ }
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
  root.style.colorScheme = theme;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => getInitialTheme());
  const [resolvedTheme, setResolvedTheme] = useState<Theme>(() => getInitialTheme());

  // Apply on mount to avoid flash.
  useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    setResolvedTheme(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch { /* ignore */ }
    applyTheme(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  }, [resolvedTheme, setTheme]);

  // Keep state in sync with system when no stored preference flips.
  useEffect(() => {
    const stored = (() => {
      try {
        return window.localStorage.getItem(THEME_STORAGE_KEY);
      } catch { return null; }
    })();
    if (stored !== 'light' && stored !== 'dark') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = (e: MediaQueryListEvent) => {
        const next = e.matches ? 'dark' : 'light';
        setThemeState(next);
        setResolvedTheme(next);
        applyTheme(next);
      };
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
    return undefined;
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, resolvedTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}