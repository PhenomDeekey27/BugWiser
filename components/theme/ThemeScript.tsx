'use client';

// Inline script to set the theme class before hydration to avoid a flash of
// the wrong theme. Must run before the app renders.
export function ThemeScript() {
  const script = `
    (function () {
      try {
        var stored = window.localStorage.getItem('bugwiser-theme');
        var dark = stored === 'dark'
          || (stored !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
        var root = document.documentElement;
        if (dark) { root.classList.add('dark'); }
        else { root.classList.remove('dark'); }
        root.style.colorScheme = dark ? 'dark' : 'light';
      } catch (e) {}
    })();
  `;
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}