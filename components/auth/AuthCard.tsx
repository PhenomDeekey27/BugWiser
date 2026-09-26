'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import { BugWiserLogo } from '@/components/layout/BugWiserLogo';

const permissions = [
  'Read repositories',
  'Read issues',
  'Read repository files',
  'Create fix branches and commits',
];

export function AuthCard() {
  const [loading, setLoading] = useState(false);
  const searchParams = useSearchParams();
  const error = searchParams.get('error');

  const handleGitHubLogin = async () => {
    setLoading(true);
    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        scopes: 'repo read:user user:email',
      },
    });
    if (authError) {
      setLoading(false);
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
            <div className="mb-6 p-3 rounded-lg border border-error-default/30 bg-error-container/10">
              <p className="text-sm text-error-default text-center">{error}</p>
            </div>
          )}

          <p className="text-sm text-bw-peach text-center mb-6 leading-relaxed">
            BugWiser needs GitHub access to inspect repositories and issues. We only request read permissions.
          </p>

          <div className="mb-6 p-4 rounded-xl bg-surface/50 border border-[rgba(70,50,40,0.08)]">
            <p className="text-xs font-mono font-bold uppercase tracking-wider text-bw-peach mb-3">
              Requested Permissions
            </p>
            <ul className="space-y-2">
              {permissions.map((permission) => (
                <li key={permission} className="flex items-center gap-2 text-sm text-bw-peach-light">
                  <span className="w-4 h-4 rounded-full bg-green-500/15 flex items-center justify-center flex-shrink-0">
                    <span className="text-green-600 text-[10px]">✓</span>
                  </span>
                  <span>{permission}</span>
                </li>
              ))}
            </ul>
          </div>

          <Button
            className="w-full btn-bw-primary h-11 font-medium cursor-pointer rounded-lg"
            onClick={handleGitHubLogin}
            disabled={loading}
          >
            {loading ? 'Connecting to GitHub...' : 'Continue with GitHub'}
          </Button>

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
