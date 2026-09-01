import { Suspense } from 'react';
import { AuthCard } from '@/components/auth/AuthCard';

export default function GitHubAuthPage() {
  return (
    <div className="min-h-screen bg-page-auth flex items-center justify-center px-4 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-[20%] left-[30%] w-[500px] h-[500px] rounded-full bg-[radial-gradient(circle,rgba(254,215,184,0.1)_0%,transparent_70%)]" />
        <div className="absolute bottom-[20%] right-[25%] w-[300px] h-[300px] rounded-full bg-[radial-gradient(circle,rgba(89,23,27,0.25)_0%,transparent_70%)]" />
      </div>
      <Suspense>
        <AuthCard />
      </Suspense>
    </div>
  );
}
