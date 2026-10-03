import { RepositoryFileRecord, RelevantFile } from '@/types';
import { extractJsonObject } from './json';

interface RelevantFileResult {
  path: string;
  confidence: number;
  reason: string;
}

export interface ValidationResult {
  validFiles: RelevantFile[];
  rejectedPaths: string[];
}

function isValidPath(path: string): boolean {
  if (!path || typeof path !== 'string') return false;
  if (path.startsWith('/') || path.startsWith('..') || path.includes('\\')) return false;
  if (path.includes('..')) return false;
  if (path.length > 500) return false;
  const normalized = path.replace(/\/+/g, '/');
  if (normalized !== path) return false;
  return true;
}

function getLanguageFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript',
    py: 'Python', go: 'Go', rs: 'Rust', java: 'Java', rb: 'Ruby',
    css: 'CSS', scss: 'SCSS', html: 'HTML', json: 'JSON', md: 'Markdown',
  };
  return map[ext] || ext.toUpperCase() || 'Unknown';
}

export function validateRelevantFiles(
  results: RelevantFileResult[],
  repositoryFiles: RepositoryFileRecord[]
): ValidationResult {
  const validPaths = new Set(repositoryFiles.map((f) => f.path));
  const validFiles: RelevantFile[] = [];
  const rejectedPaths: string[] = [];

  for (const result of results) {
    if (!isValidPath(result.path)) {
      rejectedPaths.push(result.path);
      continue;
    }

    if (!validPaths.has(result.path)) {
      rejectedPaths.push(result.path);
      continue;
    }

    const fileRecord = repositoryFiles.find((f) => f.path === result.path);

    validFiles.push({
      path: result.path,
      language: fileRecord?.language || getLanguageFromPath(result.path),
      relevanceScore: Math.max(0, Math.min(1, result.confidence)),
      description: result.reason,
    });
  }

  return { validFiles, rejectedPaths };
}

export function parseAIResponse(content: string): RelevantFileResult[] {
  try {
    const parsed = extractJsonObject(content);
    if (!parsed || typeof parsed !== 'object') return [];

    const obj = parsed as Record<string, unknown>;
    const files = obj.relevantFiles || obj.files || obj;

    if (!Array.isArray(files)) return [];

    return files
      .filter(
        (f: unknown): f is RelevantFileResult =>
          typeof f === 'object' &&
          f !== null &&
          'path' in f &&
          typeof (f as Record<string, unknown>).path === 'string'
      )
      .map((f: RelevantFileResult) => ({
        path: f.path,
        confidence: typeof f.confidence === 'number' ? f.confidence : 0.5,
        reason: typeof f.reason === 'string' ? f.reason : 'Identified by AI analysis',
      }));
  } catch {
    return [];
  }
}
