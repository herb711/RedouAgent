import { ChevronDown, ChevronRight, FileText, Folder } from 'lucide-react';
import { useState } from 'react';
import type { FileTreeNode } from '../../types';

interface FileExplorerPanelProps {
  tree: FileTreeNode[];
}

export function FileExplorerPanel({ tree }: FileExplorerPanelProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(collectDefaultExpanded(tree)));

  function toggleNode(node: FileTreeNode) {
    if (node.type !== 'folder') return;

    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(node.id)) {
        next.delete(node.id);
      } else {
        next.add(node.id);
      }
      return next;
    });
  }

  return (
    <section className="redou-inspector-card redou-file-explorer-card">
      <div className="redou-card-title-row">
        <h3>项目文件</h3>
        <span>mock tree</span>
      </div>
      <div className="redou-file-tree">{tree.map((node) => renderNode(node, expanded, toggleNode, 0))}</div>
      <div className="redou-selected-file">
        <span>当前选中文件</span>
        <strong>apps/desktop/renderer</strong>
      </div>
    </section>
  );
}

function collectDefaultExpanded(nodes: FileTreeNode[]): string[] {
  return nodes.flatMap((node) => {
    const current = node.defaultExpanded ? [node.id] : [];
    return node.children ? [...current, ...collectDefaultExpanded(node.children)] : current;
  });
}

function renderNode(
  node: FileTreeNode,
  expanded: Set<string>,
  toggleNode: (node: FileTreeNode) => void,
  depth: number,
) {
  const isFolder = node.type === 'folder';
  const isExpanded = expanded.has(node.id);
  const Icon = isFolder ? Folder : FileText;
  const Chevron = isFolder && isExpanded ? ChevronDown : ChevronRight;

  return (
    <div className="redou-file-node" key={node.id}>
      <button
        className="redou-file-row"
        data-selected={node.selected ? 'true' : 'false'}
        type="button"
        style={{ paddingLeft: `${depth * 14 + 6}px` }}
        onClick={() => toggleNode(node)}
      >
        {isFolder ? <Chevron size={13} /> : <span className="redou-file-spacer" />}
        <Icon size={14} />
        <span>{node.name}</span>
      </button>
      {isFolder && isExpanded && node.children ? (
        <div>{node.children.map((child) => renderNode(child, expanded, toggleNode, depth + 1))}</div>
      ) : null}
    </div>
  );
}
