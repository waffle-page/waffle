import { useState } from 'react';
import { ChevronIcon, FolderIcon } from '@waffle/ui';
import type { FolderNode } from './queries';

interface Props {
  roots: FolderNode[];
  selectedId: string | null;
  totalCount: number;
  onSelect: (id: string | null) => void;
}

export function FolderTree({ roots, selectedId, totalCount, onSelect }: Props) {
  return (
    <nav style={{ padding: '0.5rem 0.5rem 2rem', overflowY: 'auto', height: '100%' }}>
      <TreeRow
        depth={0}
        label="Everything"
        count={totalCount}
        selected={selectedId === null}
        hasChildren={false}
        expanded={false}
        onClick={() => onSelect(null)}
      />
      {roots.map((node) => (
        <TreeNode key={node.id} node={node} depth={0} selectedId={selectedId} onSelect={onSelect} />
      ))}
    </nav>
  );
}

function TreeNode({ node, depth, selectedId, onSelect }: { node: FolderNode; depth: number; selectedId: string | null; onSelect: (id: string) => void }) {
  const [expanded, setExpanded] = useState(depth === 0);
  const label = node.name === '/' ? 'Vault' : node.name;
  return (
    <>
      <TreeRow
        depth={depth}
        label={label}
        count={node.count}
        selected={selectedId === node.id}
        hasChildren={node.children.length > 0}
        expanded={expanded}
        onClick={() => onSelect(node.id)}
        onToggle={() => setExpanded((e) => !e)}
      />
      {expanded &&
        node.children.map((child) => (
          <TreeNode key={child.id} node={child} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} />
        ))}
    </>
  );
}

function TreeRow({ depth, label, count, selected, hasChildren, expanded, onClick, onToggle }: {
  depth: number;
  label: string;
  count: number;
  selected: boolean;
  hasChildren: boolean;
  expanded: boolean;
  onClick: () => void;
  onToggle?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '0.35rem 0.5rem',
        paddingLeft: 8 + depth * 16,
        borderRadius: 'var(--radius-sm)',
        cursor: 'pointer',
        background: selected ? 'var(--accent)' : 'transparent',
        color: selected ? 'var(--accent-ink)' : 'var(--text)',
        fontSize: '0.85rem',
        userSelect: 'none',
      }}
    >
      <span
        onClick={(e) => {
          if (!onToggle) return;
          e.stopPropagation();
          onToggle();
        }}
        style={{
          width: 14,
          display: 'inline-flex',
          fontSize: '0.7rem',
          transform: expanded ? 'rotate(90deg)' : 'none',
          visibility: hasChildren ? 'visible' : 'hidden',
        }}
      >
        <ChevronIcon />
      </span>
      <FolderIcon style={{ fontSize: '1rem', flexShrink: 0, opacity: selected ? 1 : 0.65 }} />
      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: selected ? 600 : 400 }}>{label}</span>
      {count > 0 && (
        <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: selected ? 'var(--accent-ink)' : 'var(--text-dim)' }}>
          {count.toLocaleString()}
        </span>
      )}
    </div>
  );
}
