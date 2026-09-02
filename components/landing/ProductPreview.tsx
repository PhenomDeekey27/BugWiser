export function ProductPreview() {
  return (
    <section className="px-4 py-16 md:py-24 max-w-6xl mx-auto">
      <div className="glass-workspace overflow-hidden shadow-[0_20px_60px_rgba(70,50,40,0.12)]">
        {/* Window header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[rgba(100,80,70,0.12)] bg-bw-surface/40">
          <div className="flex items-center gap-3">
            <div className="flex gap-2">
              <div className="w-3 h-3 rounded-full bg-[#FF5F57] shadow-inner" />
              <div className="w-3 h-3 rounded-full bg-[#FEBC2E] shadow-inner" />
              <div className="w-3 h-3 rounded-full bg-[#28C840] shadow-inner" />
            </div>
            <span className="text-sm font-mono font-medium text-bw-peach-light tracking-wide">
              BugWiser — Investigation Workspace
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-xs font-mono px-2.5 py-1 rounded-md bg-bw-surface/50 border border-[rgba(100,80,70,0.1)] text-bw-dusty-rose">
              AI Analysis
            </div>
            <div className="w-2 h-2 rounded-full bg-primary-container animate-pulse" />
          </div>
        </div>

        <div className="flex flex-col lg:flex-row">
          {/* Sidebar - Analysis Progress */}
          <div className="w-full lg:w-56 border-b lg:border-b-0 lg:border-r border-[rgba(100,80,70,0.1)] bg-bw-surface/40 p-5">
            <div className="mb-5">
              <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-bw-peach-light mb-4">
                Investigation Progress
              </h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm text-bw-peach-light">
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full bg-green-500/20 border border-green-500/30 flex items-center justify-center">
                      <span className="text-green-600 text-[10px]">✓</span>
                    </div>
                    <span className="font-medium">Repository</span>
                  </div>
                  <span className="text-xs font-mono text-bw-dusty-rose">✓</span>
                </div>
                <div className="flex items-center justify-between text-sm text-bw-peach-light">
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full bg-green-500/20 border border-green-500/30 flex items-center justify-center">
                      <span className="text-green-600 text-[10px]">✓</span>
                    </div>
                    <span className="font-medium">Issue</span>
                  </div>
                  <span className="text-xs font-mono text-bw-dusty-rose">✓</span>
                </div>
                <div className="flex items-center justify-between text-sm text-bw-peach-light">
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full bg-green-500/20 border border-green-500/30 flex items-center justify-center">
                      <span className="text-green-600 text-[10px]">✓</span>
                    </div>
                    <span className="font-medium">Files</span>
                  </div>
                  <span className="text-xs font-mono text-bw-dusty-rose">8 files</span>
                </div>
                <div className="flex items-center justify-between text-sm text-primary-default font-medium">
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full bg-primary-container/30 border border-primary-container/50 flex items-center justify-center">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary-container animate-pulse" />
                    </div>
                    <span>Root Cause</span>
                  </div>
                  <span className="text-xs font-mono text-primary-container">Analyzing</span>
                </div>
                <div className="flex items-center justify-between text-sm text-bw-dusty-rose">
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full bg-bw-surface/30 border border-[rgba(100,80,70,0.2)]" />
                    <span>Solution</span>
                  </div>
                  <span className="text-xs font-mono text-bw-dusty-rose">Pending</span>
                </div>
                <div className="flex items-center justify-between text-sm text-bw-dusty-rose">
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full bg-bw-surface/30 border border-[rgba(100,80,70,0.2)]" />
                    <span>Patch</span>
                  </div>
                  <span className="text-xs font-mono text-bw-dusty-rose">Pending</span>
                </div>
              </div>
            </div>
            
            <div className="pt-4 border-t border-[rgba(100,80,70,0.08)]">
              <div className="text-xs text-bw-dusty-rose mb-2">Analysis Confidence</div>
              <div className="h-2 rounded-full bg-bw-surface/50 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-primary-default to-primary-container w-3/4 rounded-full" />
              </div>
              <div className="text-xs font-mono text-bw-peach-light mt-1 text-right">94%</div>
            </div>
          </div>

          {/* Main Content */}
          <div className="flex-1 p-6">
            {/* Issue Header */}
            <div className="mb-6">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-sm font-mono text-primary-default font-medium bg-bw-surface/50 px-3 py-1.5 rounded-lg border border-[rgba(143,36,40,0.1)]">
                  acme/core-engine
                </span>
                <span className="text-bw-dusty-rose">/</span>
                <span className="text-sm font-mono text-bw-peach-light font-medium bg-bw-surface/50 px-3 py-1.5 rounded-lg border border-[rgba(100,80,70,0.1)]">
                  #402
                </span>
              </div>
              <h3 className="text-lg font-semibold text-bw-peach-light mb-2">
                Memory leak in thread pool executor
              </h3>
              <p className="text-bw-peach">
                The thread pool executor fails to release resources when tasks are cancelled, causing memory accumulation.
              </p>
            </div>

            {/* Root Cause Panel */}
            <div className="mb-6 p-5 rounded-xl bg-bw-surface/60 border border-[rgba(100,80,70,0.1)] shadow-[0_4px_12px_rgba(70,50,40,0.06)]">
              <div className="flex flex-wrap items-center gap-3 mb-3">
                <span className="text-sm font-mono font-bold uppercase tracking-wider text-bw-peach-light">
                  Root Cause Identified
                </span>
                <span className="px-3 py-1 text-xs font-mono rounded-full bg-gradient-to-r from-primary-default/10 to-primary-container/10 text-primary-container font-medium border border-primary-container/20">
                  94% confidence
                </span>
              </div>
              <p className="text-bw-peach-light leading-relaxed">
                The cleanupNode function attempts to access node.children without verifying whether node is undefined, 
                causing a silent failure that prevents resource cleanup.
              </p>
            </div>

            {/* Code Diff Preview */}
            <div className="rounded-xl border border-[rgba(100,80,70,0.12)] bg-gradient-to-br from-white/40 to-white/20 overflow-hidden shadow-[0_8px_24px_rgba(70,50,40,0.08)]">
              <div className="flex items-center justify-between px-4 py-3.5 border-b border-[rgba(100,80,70,0.08)] bg-bw-surface/20">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono font-medium text-bw-peach-light">
                    src/core/thread-pool.ts
                  </span>
                  <span className="text-xs font-mono px-2 py-0.5 rounded-md bg-primary-container/10 text-primary-container">
                    Patch Preview
                  </span>
                </div>
                <span className="text-xs font-mono text-bw-dusty-rose">Lines 140-148</span>
              </div>
              <div className="p-4 font-mono text-sm leading-relaxed bg-gradient-to-b from-transparent to-white/5">
                <div className="flex">
                  <span className="w-10 text-right pr-4 text-bw-dusty-rose/40 select-none font-medium">140</span>
                  <span className="text-bw-dusty-rose">private async cleanupNode(node: Node | undefined) {'{'}</span>
                </div>
                <div className="flex">
                  <span className="w-10 text-right pr-4 text-bw-dusty-rose/40 select-none font-medium">141</span>
                  <span className="text-bw-dusty-rose/50">  {'// Previous code - missing null check'}</span>
                </div>
                <div className="flex bg-red-500/5 border-l-2 border-red-400/30 my-1">
                  <span className="w-10 text-right pr-4 text-bw-dusty-rose/40 select-none font-medium">142</span>
                  <span className="text-red-400/90">- const children = node.children;</span>
                </div>
                <div className="flex bg-green-500/5 border-l-2 border-green-500/30 my-1">
                  <span className="w-10 text-right pr-4 text-bw-dusty-rose/40 select-none font-medium">143</span>
                  <span className="text-green-600/90">+ if (!node) {'{'}</span>
                </div>
                <div className="flex bg-green-500/5 border-l-2 border-green-500/30 my-1">
                  <span className="w-10 text-right pr-4 text-bw-dusty-rose/40 select-none font-medium">144</span>
                  <span className="text-green-600/90">+   return;</span>
                </div>
                <div className="flex bg-green-500/5 border-l-2 border-green-500/30 my-1">
                  <span className="w-10 text-right pr-4 text-bw-dusty-rose/40 select-none font-medium">145</span>
                  <span className="text-green-600/90">+ {'}'}</span>
                </div>
                <div className="flex bg-green-500/5 border-l-2 border-green-500/30 my-1">
                  <span className="w-10 text-right pr-4 text-bw-dusty-rose/40 select-none font-medium">146</span>
                  <span className="text-green-600/90">+ const children = node.children;</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
