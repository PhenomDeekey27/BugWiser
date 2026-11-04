'use client';

import { useState } from 'react';
import { BugWiserLogo } from '@/components/layout/BugWiserLogo';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';

const permissions = [
  'Read your GitHub profile',
  'Read public, private, and organization repositories you can already access',
  'Read issues and repository contents',
  'Write pull requests and branches only when you apply a fix',
];

function safeReturnTo(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\\\')) {
    return '/dashboard';
  }
  return value;
}

export function AuthCard() {
  const [redirecting, setRedirecting] = useState(false);
  const searchParams = useSearchParams();
  const error = searchParams.get('error');
  // Correlation id from the server logs. Never contains a secret: it is only
  // useful for quoting when reporting a sign-in failure.
  const errorRef = searchParams.get('ref');
  const returnTo = safeReturnTo(searchParams.get('returnTo'));

  const startUrl = `/api/auth/github/start?returnTo=${encodeURIComponent(returnTo)}`;

  const handleGitHubLogin = () => {
    setRedirecting(true);
    // A full page load is required: /api/auth/github/start answers with a 302 to
    // github.com. Client-side navigation would try to render it as a page.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(startUrl);
  };

  return (
    <div className="w-full max-w-md mx-auto relative z-10">
      <div className="glass-card p-8 relative overflow-hidden">
        <div className="relative z-10">
          <div className="flex flex-col items-center mb-8">
            <BugWiserLogo variant="icon" className="h-16 w-16" />
            <h1 className="text-xl font-semibold text-bw-peach-light mt-4 mb-2">BugWiser</h1>
            <p className="text-sm text-bw-peach text-center">
              Connect your GitHub account
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-6 p-3 rounded-lg border border-error-default/30 bg-error-container/10"
            >
              <p className="text-sm text-error-default text-center">{error}</p>
              {errorRef && (
                <p className="mt-2 text-center font-mono text-[11px] text-bw-dusty-rose">
                  Reference: {errorRef}
                </p>
              )}
            </div>
          )}

          <p className="text-sm text-bw-peach text-center mb-6 leading-relaxed">
            BugWiser signs you in with GitHub OAuth. It can read the repositories your
            GitHub account already has access to — public, private, and organization
            repositories you belong to.
          </p>

          <div className="mb-6 p-4 rounded-xl bg-surface/50 border border-[rgba(70,50,40,0.08)]">
            <p className="text-xs font-mono font-bold uppercase tracking-wider text-bw-peach mb-3">
              Requested Permissions
            </p>
            <ul className="space-y-2">
              {permissions.map((permission) => (
                <li key={permission} className="flex items-start gap-2 text-sm text-bw-peach-light">
                  <span className="w-4 h-4 mt-0.5 rounded-full bg-green-500/15 flex items-center justify-center flex-shrink-0">
                    <span className="text-green-600 text-[10px]">✓</span>
                  </span>
                  <span>{permission}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-bw-dusty-rose mt-3">
              Nothing is written to your repository until you explicitly apply a
              suggested patch.
            </p>
          </div>

          <Button
            className="w-full btn-bw-primary h-11 font-medium cursor-pointer rounded-lg"
            onClick={handleGitHubLogin}
          >
            Continue with GitHub
          </Button>

          {redirecting && (
            <button
              type="button"
              onClick={() => setRedirecting(false)}
              className="w-full text-xs text-bw-dusty-rose hover:text-bw-peach-light underline mt-3 cursor-pointer"
            >
              Taking too long? Cancel and try again
            </button>
          )}

          <div className="mt-6 pt-4 border-t border-[rgba(70,50,40,0.08)]">
            <p className="text-xs text-bw-dusty-rose mb-2">
              Sign in with GitHub to connect your account.
            </p>
          </div>

          <p className="text-xs text-bw-dusty-rose text-center mt-4">
            By continuing, you agree to our{' '}
            <a href="#" className="text-primary-default hover:underline cursor-pointer">
              Terms of Service
            </a>{' '}
            and{' '}
            <a href="#" className="text-primary-default hover:underline cursor-pointer">
              Privacy Policy
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}