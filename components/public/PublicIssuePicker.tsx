'use client';

import { useCallback, useEffect, useState } from 'react';
import { IssueSelector } from '@/components/analysis/IssueSelector';
import { Input } from '@/components/ui/input';
import type { Issue } from '@/types';

interface PublicIssueSummary {
  number: number;
  title: string;
  state: string;
  labels: string[];
  author: string;
  commentsCount: number;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
}

export interface PublicIssueSelection {
  issueNumber: number | null;
  issueUrl: string;
}

interface PublicIssuePickerProps {
  repositoryFullName: string;
  onChange: (selection: PublicIssueSelection) => void;
}

function toIssue(summary: PublicIssueSummary, repositoryFullName: string): Issue {
  return {
    id: String(summary.number),
    number: summary.number,
    title: summary.title,
    body: '',
    state: summary.state === 'closed' ? 'closed' : 'open',
    labels: summary.labels,
    assignees: [],
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    closedAt: null,
    comments: summary.commentsCount,
    htmlUrl: summary.htmlUrl,
    userLogin: summary.author,
    repositoryId: repositoryFullName,
  };
}

/**
 * Lists open issues for the resolved public repository and lets the user pick
 * one (or paste a URL instead). The parent owns the submitted selection.
 */
export function PublicIssuePicker({ repositoryFullName, onChange }: PublicIssuePickerProps) {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNumber, setSelectedNumber] = useState<number | null>(null);
  const [issueUrl, setIssueUrl] = useState('');

  const [owner, repo] = repositoryFullName.split('/');

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `/api/public/repositories/issues?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}&state=open`,
          { cache: 'no-store' }
        );
        const data = await response.json().catch(() => null);
        if (cancelled) return;
        if (!response.ok) {
          setIssues([]);
          setError(data?.error || `Could not load issues (${response.status}).`);
          return;
        }
        const summaries = Array.isArray(data?.issues) ? (data.issues as PublicIssueSummary[]) : [];
        setIssues(summaries.map((summary) => toIssue(summary, repositoryFullName)));
      } catch {
        if (!cancelled) {
          setIssues([]);
          setError('Could not load issues. Check your connection and try again.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [owner, repo, repositoryFullName]);

  const handleSelect = useCallback(
    (issue: Issue) => {
      setSelectedNumber(issue.number);
      setIssueUrl('');
      onChange({ issueNumber: issue.number, issueUrl: '' });
    },
    [onChange]
  );

  const handleUrlChange = (value: string) => {
    setIssueUrl(value);
    if (value.trim()) setSelectedNumber(null);
    onChange({
      issueNumber: value.trim() ? null : selectedNumber,
      issueUrl: value,
    });
  };

  const selectedIssue = issues.find((issue) => issue.number === selectedNumber) || null;

  return (
    <div className="space-y-3">
      <IssueSelector
        title={loading ? 'Loading issues…' : `Open issues (${issues.length})`}
        selectedIssue={selectedIssue}
        onSelect={handleSelect}
        issues={issues}
        loading={loading}
        error={error}
      />

      <div className="pt-2 border-t border-border">
        <label
          htmlFor="public-issue-url"
          className="block text-[10px] font-mono font-bold uppercase tracking-wider text-bw-peach mb-1"
        >
          Or paste an issue URL
        </label>
        <Input
          id="public-issue-url"
          value={issueUrl}
          onChange={(event) => handleUrlChange(event.target.value)}
          placeholder="https://github.com/owner/repo/issues/123"
          spellCheck={false}
          autoComplete="off"
          className="font-mono text-xs"
        />
        <p className="mt-2 text-[11px] text-bw-peach">
          The issue must belong to {repositoryFullName}. Pull requests are rejected.
        </p>
      </div>
    </div>
  );
}
