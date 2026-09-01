export function FeatureSteps() {
  const steps = [
    {
      icon: '◈',
      title: 'Connect Repository',
      description: 'Select a GitHub repository to analyze',
    },
    {
      icon: '◎',
      title: 'Select Issue',
      description: 'Choose an issue to investigate',
    },
    {
      icon: '⊕',
      title: 'Trace Code',
      description: 'BugWiser identifies relevant files',
    },
    {
      icon: '⊙',
      title: 'Find Root Cause',
      description: 'AI-powered root cause analysis',
    },
    {
      icon: '→',
      title: 'Generate Patch',
      description: 'Get an actionable code fix',
    },
    {
      icon: '⊞',
      title: 'Create Branch & PR',
      description: 'Auto-create fix branch and pull request',
    },
  ];

  return (
    <section id="how-it-works" className="px-4 py-16 md:py-20 max-w-5xl mx-auto">
      <div className="surface-primary rounded-2xl p-8 md:p-10">
        <h2 className="text-2xl font-semibold text-bw-peach-light text-center mb-10">
          How it works
        </h2>

        <div className="flex flex-col md:flex-row items-center justify-between gap-6 md:gap-4">
          {steps.map((step, index) => (
            <div key={step.title} className="flex items-center gap-4 md:gap-6">
              <div className="flex flex-col items-center text-center">
                <div className="flex items-center justify-center w-14 h-14 rounded-xl bg-bw-burgundy/40 border border-bw-wine/60 mb-3 hover:border-bw-terracotta/80 transition-colors">
                  <span className="text-lg text-bw-peach">{step.icon}</span>
                </div>
                <h3 className="text-sm font-medium text-bw-peach-light mb-1">{step.title}</h3>
                <p className="text-xs text-bw-peach/80 max-w-35">
                  {step.description}
                </p>
              </div>
              {index < steps.length - 1 && (
                <div className="hidden md:block text-bw-dusty-rose">
                  →
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
