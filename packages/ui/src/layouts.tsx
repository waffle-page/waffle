/**
 * Layout renderer registry (ADR-006): every layout is one entry with the same
 * component signature. Adding a visualization = one file + one register() call
 * (recipe: docs/08-code-conventions.md → recipes). Masonry is the default;
 * table, board, map join in later phases.
 */
import type { ComponentType } from 'react';
import type { LibraryItem, TableViewConfig, ThumbLoader } from './types';
import { ToppingCard } from './ToppingCard';
import { VirtualGrid } from './VirtualGrid';
import { VirtualList } from './VirtualList';
import { VirtualMasonry } from './VirtualMasonry';
import { DashIcon, FileIcon, GridIcon, LinkIcon, ListIcon, MasonryIcon, NoteIcon, type IconProps } from './icons';

export interface LayoutProps {
  items: LibraryItem[];
  loadThumb?: ThumbLoader;
  onOpen?: (item: LibraryItem) => void;
  // Editing-capable layouts (table) additionally get folder context. Pure
  // renderers ignore these; the shape stays one for every registry entry.
  folderId?: string | null;
  /** Call after any layout-initiated write so the host refreshes its rows. */
  onMutated?: () => void | Promise<void>;
  tableConfig?: TableViewConfig;
  onTableConfig?: (patch: Partial<TableViewConfig>) => void;
}

export interface LayoutEntry {
  key: string;
  label: string;
  icon: ComponentType<IconProps>;
  component: ComponentType<LayoutProps>;
}

const TYPE_ICON = { note: NoteIcon, link: LinkIcon, file: FileIcon, dash: DashIcon } as const;

function MasonryLayout({ items, loadThumb, onOpen }: LayoutProps) {
  return (
    <VirtualMasonry
      items={items}
      renderItem={(i) => <ToppingCard item={items[i]!} loadThumb={loadThumb} onOpen={onOpen} />}
    />
  );
}

function GridLayout({ items, loadThumb, onOpen }: LayoutProps) {
  return <VirtualGrid count={items.length} renderItem={(i) => <ToppingCard item={items[i]!} loadThumb={loadThumb} onOpen={onOpen} />} />;
}

function ListLayout({ items, onOpen }: LayoutProps) {
  return (
    <VirtualList
      count={items.length}
      renderRow={(i) => {
        const item = items[i]!;
        const Icon = TYPE_ICON[item.type];
        return (
          <div
            onClick={onOpen ? () => onOpen(item) : undefined}
            style={{ display: 'flex', alignItems: 'center', gap: 12, height: '100%', borderBottom: '1px solid var(--border)', cursor: onOpen ? 'pointer' : 'default' }}
          >
            <Icon style={{ color: 'var(--text-dim)', fontSize: '1.1rem', flexShrink: 0 }} />
            <span style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</span>
            <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginLeft: 'auto', whiteSpace: 'nowrap' }}>
              {item.subtitle ?? item.type}
            </span>
          </div>
        );
      }}
    />
  );
}

const registry = new Map<string, LayoutEntry>();

export function registerLayout(entry: LayoutEntry): void {
  registry.set(entry.key, entry);
}

export function getLayout(key: string): LayoutEntry {
  return registry.get(key) ?? registry.get('masonry')!;
}

export function listLayouts(): LayoutEntry[] {
  return [...registry.values()];
}

registerLayout({ key: 'masonry', label: 'Masonry', icon: MasonryIcon, component: MasonryLayout });
registerLayout({ key: 'grid', label: 'Grid', icon: GridIcon, component: GridLayout });
registerLayout({ key: 'list', label: 'List', icon: ListIcon, component: ListLayout });
