'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { GitHubUser } from '@/types';

interface HeroProps {
  user?: GitHubUser | null;
}

export function Hero({ user }: HeroProps) {
  const scrollToHowItWorks = () => {
    document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <section className="flex flex-col items-center justify-center px-4 py-20 md:py-32 text-center relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-[radial-gradient(circle,rgba(254,215,184,0.1)_0%,transparent_60%)]" />
      </div>

      <div className="relative z-10 max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 mb-8 rounded-full bg-surface-container-low/80 border border-bw-burgundy/60 backdrop-blur-sm">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-xs font-mono font-bold uppercase tracking-wider text-bw-peach">
            ENGINE V2.0 ACTIVE
          </span>
        </div>

        <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold text-bw-peach-light leading-[1.1] tracking-tight mb-6">
          Understand any
          <br />
          <span className="bg-gradient-to-r from-bw-peach-light via-bw-peach to-bw-dusty-rose bg-clip-text text-transparent">
            GitHub issue
          </span>{' '}
          faster.
        </h1>

        <p className="max-w-xl text-lg text-bw-peach mb-10 leading-relaxed">
          Connect a repository, select an issue, and let BugWiser trace the relevant code,
          identify the root cause, and generate an actionable patch.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          {user ? (
            <Link href="/dashboard">
              <Button
                size="lg"
                className="btn-bw-primary px-8 h-12 font-semibold text-sm tracking-wide cursor-pointer"
              >
                Go to Dashboard
              </Button>
            </Link>
          ) : (
            <Link href="/auth/github">
              <Button
                size="lg"
                className="btn-bw-primary px-8 h-12 font-semibold text-sm tracking-wide cursor-pointer"
              >
                Continue with GitHub
              </Button>
            </Link>
          )}
          <Button
            variant="outline"
            size="lg"
            className="border-bw-burgundy/60 text-bw-peach-light hover:bg-bw-burgundy/30 hover:text-bw-peach-light h-12 cursor-pointer backdrop-blur-sm"
            onClick={scrollToHowItWorks}
          >
            See how it works
          </Button>
        </div>
      </div>
    </section>
  );
}
