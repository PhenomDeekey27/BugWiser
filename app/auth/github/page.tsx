import { Suspense } from 'react';
import { AuthCard } from '@/components/auth/AuthCard';
import { DotPattern } from '@/components/ui/dot-pattern';

export default function GitHubAuthPage() {
  return (
    <div className="min-h-screen bg-page-auth flex items-center justify-center px-4 relative overflow-hidden">
      <div className="dot-pattern-container" style={{ color: 'rgba(138, 125, 118, 0.18)' }}>
        <DotPattern
          width={20}
          height={20}
          cr={0.7}
        />
      </div>
      <Suspense>
        <AuthCard />
      </Suspense>
    </div>
  );
}
