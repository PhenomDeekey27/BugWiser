'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import { BugWiserLogo } from '@/components/layout/BugWiserLogo';

const permissions = [
  'Read repository contents and metadata',
  'Read issues',
  'Read and write pull requests and branches (only when you apply a fix)',
];

function safeReturnTo(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return '/dashboard';
  }
  return value;
}

export function AuthCard() {
  const [redirecting, setRedirecting] = useState(false);
  const [legacyLoading, setLegacyLoading] = useState(false);
  const searchParams = useSearchParams();
  const error = searchParams.get('error');
  const returnTo = safeReturnTo(searchParams.get('returnTo'));

  const startUrl = `/api/auth/github/start?returnTo=${encodeURIComponent(returnTo)}`;

  const handleGitHubLogin = () => {
    setRedirecting(true);
    window.location.assign(startUrl);
  };

  const handleLegacyLogin = async () => {
    setLegacyLoading(true);
    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        scopes: 'repo read:user user:email',
      },
    });
    if (authError) {
      setLegacyLoading(false);
    }
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
            </div>
          )}

          <p className="text-sm text-bw-peach text-center mb-6 leading-relaxed">
            BugWiser signs you in with GitHub, then asks you to install the BugWiser
            GitHub App on the repositories you choose. Only those repositories are
            accessible.
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
            disabled={redirecting || legacyLoading}
          >
            {redirecting ? 'Redirecting to GitHub…' : 'Continue with GitHub'}
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
              Existing account with a GitHub sign-in? Use the legacy session while
              the new GitHub App sign-in rolls out.
            </p>
            <Button
              variant="ghost"
              className="w-full text-xs font-medium cursor-pointer"
              onClick={handleLegacyLogin}
              disabled={redirecting || legacyLoading}
            >
              {legacyLoading ? 'Connecting…' : 'Use legacy GitHub sign-in'}
            </Button>
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
