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
    <section className="flex flex-col items-center justify-center px-4 pt-24 pb-20 md:pt-36 md:pb-28 text-center relative overflow-hidden">
      <div className="relative z-10 max-w-4xl mx-auto">
        <h1
          className="font-sans font-bold leading-[0.95] tracking-[-0.04em] mb-8"
          style={{ fontSize: 'clamp(3rem, 7vw, 5rem)' }}
        >
          <span className="text-bw-peach-light">Understand any</span>
          <br />
          <span className="text-primary-default bg-clip-text bg-linear-to-r from-primary-default to-bw-terracotta">GitHub issue</span>
          <br />
          <span className="text-bw-peach-light">faster.</span>
        </h1>

        <p
          className="mb-12 leading-relaxed max-w-2xl mx-auto text-lg"
          style={{ fontSize: 'clamp(1.125rem, 2vw, 1.375rem)', color: '#625D58' }}
        >
          Connect a repository, select an issue, and let BugWiser trace the relevant code,
          identify the root cause, and generate an actionable patch.
        </p>

        <div className="flex flex-col sm:flex-row gap-3.5 justify-center">
          {user ? (
            <Link href="/dashboard">
              <Button
                size="lg"
                className="px-8 h-12 font-semibold text-sm tracking-wide cursor-pointer btn-bw-primary rounded-lg"
              >
                Go to Dashboard
              </Button>
            </Link>
          ) : (
            <Link href="/auth/github">
              <Button
                size="lg"
                className="px-8 h-12 font-semibold text-sm tracking-wide cursor-pointer btn-bw-primary rounded-lg"
              >
                Continue with GitHub
              </Button>
            </Link>
          )}
          <Button
            variant="outline"
            size="lg"
            className="h-12 cursor-pointer rounded-lg border-[rgba(70,50,40,0.14)] text-bw-peach hover:bg-bw-surface/60 hover:text-bw-peach-light transition-all"
            onClick={scrollToHowItWorks}
          >
            See how it works
          </Button>
        </div>
      </div>
    </section>
  );
}
