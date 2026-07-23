/**
 * Layout renderer registry (ADR-006): every layout is one entry with the same
 * component signature. Adding a visualization = one file + one register() call
 * (recipe: docs/08-code-conventions.md → recipes). Masonry is the default;
 * table, board, map join in later phases.
 */
import { useMemo, type ComponentType } from 'react';
import type { GroupSection, LibraryItem, TableViewConfig, ThumbLoader } from './types';
import { ToppingCard } from './ToppingCard';
import { VirtualGrid } from './VirtualGrid';
import { VirtualList } from './VirtualList';
import { VirtualMasonry } from './VirtualMasonry';
import { DashIcon, FileIcon, GridIcon, LinkIcon, ListIcon, MasonryIcon, NoteIcon, type IconProps } from './icons';

export interface LayoutProps {
  items: LibraryItem[];
  /**
   * Host-computed group sections (view groupBy): a contiguous partition of
   * `items` in order. Groupable layouts render section headers from it;
   * others ignore it. null/absent = ungrouped.
   */
  groups?: GroupSection[] | null;
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
  /** Renders LayoutProps.groups sections. The host only offers/computes grouping when true. */
  groupable?: boolean;
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

function GridLayout({ items, groups, loadThumb, onOpen }: LayoutProps) {
  return <VirtualGrid count={items.length} groups={groups} renderItem={(i) => <ToppingCard item={items[i]!} loadThumb={loadThumb} onOpen={onOpen} />} />;
}

/** Flat list, or header/item entries when the host supplies group sections. */
type ListEntry = { header: string; count: number } | { index: number };

function ListLayout({ items, groups, onOpen }: LayoutProps) {
  const entries = useMemo<ListEntry[] | null>(() => {
    if (!groups?.length) return null;
    const out: ListEntry[] = [];
    let i = 0;
    for (const g of groups) {
      out.push({ header: g.label, count: g.count });
      for (let k = 0; k < g.count && i < items.length; k++) out.push({ index: i++ });
    }
    return out;
  }, [groups, items]);

  return (
    <VirtualList
      count={entries ? entries.length : items.length}
      renderRow={(i) => {
        const entry = entries ? entries[i]! : { index: i };
        if ('header' in entry) {
          return (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: '100%', paddingBottom: 6, borderBottom: '1px solid var(--border)', fontWeight: 600, fontSize: '0.8rem' }}>
              {entry.header}
              <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>{entry.count}</span>
            </div>
          );
        }
        const item = items[entry.index]!;
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

// Masonry stays ungroupable BY DESIGN: lane packing has no vertical section
// boundary to break at — the host hides the group control for it.
registerLayout({ key: 'masonry', label: 'Masonry', icon: MasonryIcon, component: MasonryLayout });
registerLayout({ key: 'grid', label: 'Grid', icon: GridIcon, component: GridLayout, groupable: true });
registerLayout({ key: 'list', label: 'List', icon: ListIcon, component: ListLayout, groupable: true });
