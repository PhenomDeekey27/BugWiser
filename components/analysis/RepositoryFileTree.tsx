'use client';

import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { RepositoryFileRecord, RelevantFile } from '@/types';

interface RepositoryFileTreeProps {
  files: RepositoryFileRecord[];
  relevantFiles?: RelevantFile[];
  className?: string;
}

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
  file?: RepositoryFileRecord;
  isRelevant?: boolean;
  relevantFile?: RelevantFile;
}

function buildTree(
  files: RepositoryFileRecord[],
  relevantFiles: RelevantFile[]
): TreeNode[] {
  const relevantMap = new Map(relevantFiles.map((f) => [f.path, f]));
  const root: TreeNode[] = [];
  const dirMap = new Map<string, TreeNode>();

  const sortedFiles = [...files].sort((a, b) => {
    const aDir = a.path.split('/').length;
    const bDir = b.path.split('/').length;
    if (aDir !== bDir) return aDir - bDir;
    return a.path.localeCompare(b.path);
  });

  for (const file of sortedFiles) {
    const parts = file.path.split('/');
    let currentLevel = root;

    for (let i = 0; i < parts.length - 1; i++) {
      const dirName = parts[i];
      const dirPath = parts.slice(0, i + 1).join('/');

      let dirNode = dirMap.get(dirPath);
      if (!dirNode) {
        dirNode = {
          name: dirName,
          path: dirPath,
          isDir: true,
          children: [],
        };
        dirMap.set(dirPath, dirNode);
        currentLevel.push(dirNode);
      }
      currentLevel = dirNode.children;
    }

    const fileName = parts[parts.length - 1];
    const relevantFile = relevantMap.get(file.path);

    currentLevel.push({
      name: fileName,
      path: file.path,
      isDir: false,
      children: [],
      file,
      isRelevant: !!relevantFile,
      relevantFile,
    });
  }

  const sortNodes = (nodes: TreeNode[]): TreeNode[] => {
    return nodes.sort((a, b) => {
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return a.name.localeCompare(b.name);
    }).map((node) => ({
      ...node,
      children: sortNodes(node.children),
    }));
  };

  return sortNodes(root);
}

function TreeNodeItem({
  node,
  depth,
  searchQuery,
  expandedDirs,
  toggleDir,
}: {
  node: TreeNode;
  depth: number;
  searchQuery: string;
  expandedDirs: Set<string>;
  toggleDir: (path: string) => void;
}) {
  const isExpanded = expandedDirs.has(node.path);
  const indent = depth * 16;

  if (node.isDir) {
    const hasRelevantChildren = node.children.some(
      (c) => c.isRelevant || (c.isDir && hasRelevantFiles(c))
    );

    return (
      <>
        <button
          onClick={() => toggleDir(node.path)}
          className="w-full flex items-center gap-2 py-1 px-2 hover:bg-surface-dim rounded transition-colors text-left cursor-pointer"
          style={{ paddingLeft: `${indent + 8}px` }}
        >
          <span className="text-xs text-bw-peach w-3">
            {isExpanded ? '▾' : '▸'}
          </span>
          <span className="text-xs font-mono text-primary-container">📁</span>
          <span className="text-xs font-mono text-bw-peach-light">{node.name}/</span>
          {hasRelevantChildren && (
            <span className="ml-auto text-[10px] text-yellow-400">★</span>
          )}
        </button>
        {isExpanded &&
          node.children.map((child) => (
            <TreeNodeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              searchQuery={searchQuery}
              expandedDirs={expandedDirs}
              toggleDir={toggleDir}
            />
          ))}
      </>
    );
  }

  const ext = node.name.split('.').pop()?.toLowerCase() || '';
  const langIcon = getFileIcon(ext);

  return (
    <div
      className={cn(
        'flex items-center gap-2 py-1 px-2 rounded transition-colors',
        node.isRelevant
          ? 'bg-yellow-400/5 border-l-2 border-yellow-400'
          : 'hover:bg-surface-dim'
      )}
      style={{ paddingLeft: `${indent + 28}px` }}
    >
      <span className="text-xs">{langIcon}</span>
      <span
        className={cn(
          'text-xs font-mono truncate',
          node.isRelevant ? 'text-yellow-400' : 'text-bw-peach-light'
        )}
      >
        {node.name}
      </span>
      {node.isRelevant && node.relevantFile && (
        <span className="ml-auto text-[10px] font-mono text-yellow-400">
          {Math.round((node.relevantFile.relevanceScore || 0) * 100)}%
        </span>
      )}
      {node.file && (
        <span className="ml-auto text-[10px] font-mono text-bw-peach/60">
          {formatSize(node.file.size)}
        </span>
      )}
    </div>
  );
}

function hasRelevantFiles(node: TreeNode): boolean {
  return node.children.some(
    (c) => c.isRelevant || (c.isDir && hasRelevantFiles(c))
  );
}

function getFileIcon(ext: string): string {
  const icons: Record<string, string> = {
    ts: '🔷', tsx: '🔷', js: '🟨', jsx: '🟨',
    py: '🐍', go: '🔵', rs: '🦀', java: '☕',
    rb: '💎', php: '🐘', css: '🎨', scss: '🎨',
    html: '🌐', json: '📋', md: '📝', yaml: '📋',
    yml: '📋', toml: '📋', sql: '🗃️', sh: '⚙️',
  };
  return icons[ext] || '📄';
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function RepositoryFileTree({
  files,
  relevantFiles = [],
  className,
}: RepositoryFileTreeProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => {
    const dirs = new Set<string>();
    for (const file of files) {
      const parts = file.path.split('/');
      for (let i = 1; i < parts.length; i++) {
        dirs.add(parts.slice(0, i).join('/'));
      }
    }
    return dirs;
  });

  const tree = useMemo(() => buildTree(files, relevantFiles), [files, relevantFiles]);

  const filteredTree = useMemo(() => {
    if (!searchQuery) return tree;
    const query = searchQuery.toLowerCase();
    const filterNodes = (nodes: TreeNode[]): TreeNode[] => {
      return nodes
        .map((node) => {
          if (node.isDir) {
            const filteredChildren = filterNodes(node.children);
            if (
              filteredChildren.length > 0 ||
              node.name.toLowerCase().includes(query)
            ) {
              return { ...node, children: filteredChildren };
            }
            return null;
          }
          if (
            node.name.toLowerCase().includes(query) ||
            node.path.toLowerCase().includes(query)
          ) {
            return node;
          }
          return null;
        })
        .filter(Boolean) as TreeNode[];
    };
    return filterNodes(tree);
  }, [tree, searchQuery]);

  const toggleDir = (path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const totalFiles = files.filter((f) => !f.is_ignored).length;
  const relevantCount = relevantFiles.length;

  return (
    <div className={cn('rounded-lg bg-surface border border-border overflow-hidden card-depth', className)}>
      <div className="p-3 border-b border-border">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-mono font-bold uppercase tracking-wider text-bw-peach">
            Repository Files
          </span>
          <span className="text-[10px] font-mono text-bw-peach/60">
            {totalFiles} files
          </span>
          {relevantCount > 0 && (
            <span className="text-[10px] font-mono text-yellow-400">
              ★ {relevantCount} relevant
            </span>
          )}
        </div>
        <Input
          placeholder="Search files..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-7 text-xs bg-surface-dim border-border"
        />
      </div>

      <div className="max-h-125 overflow-y-auto scrollbar-thin p-1">
        {filteredTree.map((node) => (
          <TreeNodeItem
            key={node.path}
            node={node}
            depth={0}
            searchQuery={searchQuery}
            expandedDirs={expandedDirs}
            toggleDir={toggleDir}
          />
        ))}

        {filteredTree.length === 0 && (
          <div className="p-4 text-center text-xs text-bw-peach">
            No files match your search
          </div>
        )}
      </div>
    </div>
  );
}
