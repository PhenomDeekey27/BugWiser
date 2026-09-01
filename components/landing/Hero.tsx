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
        <div className="inline-flex items-center gap-2 px-4 py-1.5 mb-8 rounded-full bg-surface-container-low/80 border border-[#6F302F] backdrop-blur-sm">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-xs font-mono font-bold uppercase tracking-wider" style={{ color: '#E8C1AA' }}>
            ENGINE V2.0 ACTIVE
          </span>
        </div>

        <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold leading-[1.1] tracking-tight mb-6">
          <span style={{ color: '#FFE1C7' }}>Understand any</span>
          <br />
          <span className="bg-clip-text text-transparent" style={{ backgroundImage: 'linear-gradient(90deg, #F3C7B0, #DFAFA0)' }}>
            GitHub issue
          </span>{' '}
          <span style={{ color: '#FFE1C7' }}>faster.</span>
        </h1>

        <p className="max-w-xl text-lg mb-10 leading-relaxed" style={{ color: '#E8C5B5' }}>
          Connect a repository, select an issue, and let BugWiser trace the relevant code,
          identify the root cause, and generate an actionable patch.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          {user ? (
            <Link href="/dashboard">
              <Button
                size="lg"
                className="px-8 h-12 font-semibold text-sm tracking-wide cursor-pointer"
                style={{
                  background: '#6F1F24',
                  color: '#FFE1C7',
                  border: '1px solid #8C4547',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,225,199,0.08)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#81282D';
                  e.currentTarget.style.color = '#FFE8D5';
                  e.currentTarget.style.borderColor = '#A65A59';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = '#6F1F24';
                  e.currentTarget.style.color = '#FFE1C7';
                  e.currentTarget.style.borderColor = '#8C4547';
                }}
              >
                Go to Dashboard
              </Button>
            </Link>
          ) : (
            <Link href="/auth/github">
              <Button
                size="lg"
                className="px-8 h-12 font-semibold text-sm tracking-wide cursor-pointer"
                style={{
                  background: '#6F1F24',
                  color: '#FFE1C7',
                  border: '1px solid #8C4547',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,225,199,0.08)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#81282D';
                  e.currentTarget.style.color = '#FFE8D5';
                  e.currentTarget.style.borderColor = '#A65A59';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = '#6F1F24';
                  e.currentTarget.style.color = '#FFE1C7';
                  e.currentTarget.style.borderColor = '#8C4547';
                }}
              >
                Continue with GitHub
              </Button>
            </Link>
          )}
          <Button
            variant="outline"
            size="lg"
            className="h-12 cursor-pointer backdrop-blur-sm"
            style={{
              background: 'transparent',
              color: '#E8C5B5',
              border: '1px solid #8C514E',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,225,199,0.08)';
              e.currentTarget.style.color = '#FFE1C7';
              e.currentTarget.style.borderColor = '#A96A65';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = '#E8C5B5';
              e.currentTarget.style.borderColor = '#8C514E';
            }}
            onClick={scrollToHowItWorks}
          >
            See how it works
          </Button>
        </div>
      </div>
    </section>
  );
}
