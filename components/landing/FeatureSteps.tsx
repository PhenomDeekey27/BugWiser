'use client';

import { GitBranch, Search, FileSearch, Target, Wrench, GitPullRequest } from 'lucide-react';

const steps = [
  {
    icon: GitBranch,
    title: 'Connect Repository',
    description: 'Select a GitHub repository to analyze',
  },
  {
    icon: Search,
    title: 'Select Issue',
    description: 'Choose an issue to investigate',
  },
  {
    icon: FileSearch,
    title: 'Trace Code',
    description: 'BugWiser identifies relevant files',
  },
  {
    icon: Target,
    title: 'Find Root Cause',
    description: 'AI-powered root cause analysis',
  },
  {
    icon: Wrench,
    title: 'Generate Patch',
    description: 'Get an actionable code fix',
  },
  {
    icon: GitPullRequest,
    title: 'Create Branch & PR',
    description: 'Auto-create fix branch and pull request',
  },
];

export function FeatureSteps() {
  return (
    <section id="how-it-works" className="px-4 py-16 md:py-24 max-w-6xl mx-auto">
<div className="glass-card p-6 md:p-10">
         <div className="text-center mb-8 md:mb-14">
           <h2 className="font-sans text-xl md:text-[2.5rem] font-bold text-bw-peach-light mb-4 tracking-tight">
             How it works
           </h2>
           <p className="text-bw-peach text-sm md:text-lg max-w-2xl mx-auto">
             A streamlined workflow for AI-powered issue investigation
           </p>
         </div>

         <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 md:gap-6 relative">
          {/* Connecting lines for desktop */}
          <div className="hidden lg:block absolute top-16 left-12 right-12 h-px bg-gradient-to-r from-transparent via-primary-default/8 to-transparent" />
          <div className="hidden lg:block absolute top-16 left-32 right-32 h-px bg-gradient-to-r from-transparent via-primary-default/4 to-transparent" />
          
          {steps.map((step, index) => {
            const Icon = step.icon;
            return (
              <div key={step.title} className="flex flex-col items-center text-center group relative">
                {/* Step connector dots */}
                {index < steps.length - 1 && (
                  <div className="hidden lg:block absolute top-16 -right-4 w-8 h-8">
                    <div className="absolute top-1/2 left-0 w-4 h-px bg-gradient-to-r from-primary-default/10 to-transparent" />
                    <div className="absolute top-1/2 right-0 w-4 h-px bg-gradient-to-l from-primary-default/10 to-transparent" />
                    <div className="absolute top-1/2 left-1/2 w-1.5 h-1.5 rounded-full bg-primary-default/15 transform -translate-x-1/2 -translate-y-1/2" />
                  </div>
                )}
                
<div className="glass-step flex items-center justify-center w-12 h-12 md:w-16 md:h-16 mb-4 md:mb-5 group-hover:scale-105 transition-all duration-300">
                   <Icon className="w-5 h-5 md:w-6 md:h-6 text-primary-default" strokeWidth={1.8} />
                 </div>
                 <h3 className="text-sm md:text-base font-semibold text-bw-peach-light mb-2">{step.title}</h3>
                 <p className="text-xs md:text-sm text-bw-peach leading-relaxed">
                   {step.description}
                 </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
