'use client';

import { useState } from 'react';
import { CodeLine } from '@/types';
import { Button } from '@/components/ui/button';

interface CodeViewerProps {
  filePath: string;
  lines: CodeLine[];
  language?: string;
}

export function CodeViewer({ filePath, lines, language }: CodeViewerProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const code = lines.map((line) => line.content).join('\n');
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-lg border border-border bg-surface-code overflow-hidden card-depth">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-bw-surface">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-bw-peach">
            {filePath}
          </span>
          {language && (
            <span className="text-xs font-mono text-bw-peach/50">
              {language}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs font-mono text-bw-peach hover:text-bw-peach-light"
            onClick={handleCopy}
          >
            {copied ? '✓ Copied' : 'Copy'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs font-mono text-bw-peach hover:text-bw-peach-light"
          >
            Open on GitHub
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <pre className="p-3 font-mono text-xs">
          {lines.map((line) => (
            <div
              key={line.number}
              className={`flex ${
                line.type === 'added'
                  ? 'bg-green-500/10'
                  : line.type === 'removed'
                  ? 'bg-red-500/10'
                  : ''
              }`}
            >
              <span className="w-12 text-right pr-3 text-bw-dusty-rose/70 select-none">
                {line.number}
              </span>
              <span
                className={
                  line.type === 'added'
                    ? 'text-green-400'
                    : line.type === 'removed'
                    ? 'text-red-400'
                    : 'text-bw-peach-light'
                }
              >
                {line.content}
              </span>
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}
