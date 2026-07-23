/**
 * Airtable-style table over library rows (docs/12: notes as rows). Pure
 * presentation: rows, columns, selection, and the editing cell live in props +
 * callbacks — what a commit *does* (frontmatter write, rescan) is the app's
 * business. Row-virtualized like VirtualList; the header sticks while both
 * axes scroll in one container.
 */
import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { PropertyValue } from '@waffle/core';
import type { GroupSection, LibraryItem } from './types';
import { PropertyCell } from './PropertyCell';
import { DashIcon, FileIcon, LinkIcon, NoteIcon, PlusIcon } from './icons';

export interface TableColumn {
  key: string;
  kind: PropertyValue['kind'];
  /** money columns: ISO 4217 for new values. */
  currency?: string;
  /** select columns: distinct existing values (suggestions). */
  options?: string[];
}

export interface TableRowData {
  item: LibraryItem;
  props: Record<string, PropertyValue>;
  /** Only vault-backed notes take cell edits (frontmatter is their storage). */
  editable: boolean;
}

export interface PropertyTableProps {
  rows: TableRowData[];
  columns: TableColumn[];
  /** Host-computed sections — a contiguous partition of `rows` in order (LayoutProps.groups). */
  groups?: GroupSection[] | null;
  sort: { key: string; dir: 'asc' | 'desc' } | null;
  onSort: (key: string) => void;
  selected: ReadonlySet<string>;
  onToggleSelect: (id: string) => void;
  onToggleAll: () => void;
  onEditCell: (itemId: string, key: string, value: PropertyValue | null) => void;
  /** false ⇒ no ghost row (folder has no vault directory to create files in). */
  canCreate: boolean;
  onCreateRow: (title: string) => void;
  onAddColumn: () => void;
  onOpen?: (item: LibraryItem) => void;
}

/** Sort key for the built-in title column. `$`-prefixed keys are reserved: the add-column flow rejects them. */
export const TITLE_SORT_KEY = '$title';

const ROW_H = 36;
const W_CHECK = 36;
const W_TITLE = 280;
const W_PROP = 160;
const W_ADD = 44;

const TYPE_ICON = { note: NoteIcon, link: LinkIcon, file: FileIcon, dash: DashIcon } as const;

/** One virtualized line: a group header or a data row. */
type Entry = { header: string; count: number } | { row: TableRowData };

export function PropertyTable({
  rows, columns, groups, sort, onSort, selected, onToggleSelect, onToggleAll, onEditCell, canCreate, onCreateRow, onAddColumn, onOpen,
}: PropertyTableProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<{ id: string; key: string } | null>(null);
  const [draft, setDraft] = useState('');

  const entries = useMemo<Entry[]>(() => {
    if (!groups?.length) return rows.map((row) => ({ row }));
    const out: Entry[] = [];
    let i = 0;
    for (const g of groups) {
      out.push({ header: g.label, count: g.count });
      for (let k = 0; k < g.count && i < rows.length; k++) out.push({ row: rows[i++]! });
    }
    return out;
  }, [rows, groups]);

  const count = entries.length + (canCreate ? 1 : 0);
  const virtualizer = useVirtualizer({ count, getScrollElement: () => parentRef.current, estimateSize: () => ROW_H, overscan: 12 });

  const totalWidth = W_CHECK + W_TITLE + columns.length * W_PROP + W_ADD;
  const gridTemplate = `${W_CHECK}px ${W_TITLE}px ${columns.map(() => `${W_PROP}px`).join(' ')} ${W_ADD}px`.trim();
  const editableRows = rows.filter((r) => r.editable);
  const allSelected = editableRows.length > 0 && editableRows.every((r) => selected.has(r.item.id));

  const rowStyle: CSSProperties = { display: 'grid', gridTemplateColumns: gridTemplate, alignItems: 'center', height: ROW_H, borderBottom: '1px solid var(--border)', fontSize: '0.84rem' };
  const cellPad: CSSProperties = { padding: '0 0.6rem', minWidth: 0, display: 'flex', alignItems: 'center', height: '100%' };

  const headerCell = (key: string, label: ReactNode, sortable: boolean): ReactNode => (
    <div
      key={key}
      onClick={sortable ? () => onSort(key) : undefined}
      style={{ ...cellPad, gap: 4, cursor: sortable ? 'pointer' : 'default', fontWeight: 600, fontSize: '0.76rem', color: 'var(--text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', userSelect: 'none' }}
    >
      {label}
      {sort?.key === key && <span aria-hidden>{sort.dir === 'asc' ? '▲' : '▼'}</span>}
    </div>
  );

  return (
    <div ref={parentRef} style={{ height: '100%', overflow: 'auto' }}>
      <div style={{ minWidth: totalWidth, width: 'max-content' }}>
        <div style={{ ...rowStyle, position: 'sticky', top: 0, zIndex: 2, background: 'var(--surface)' }}>
          <div style={{ ...cellPad, justifyContent: 'center' }}>
            <input type="checkbox" checked={allSelected} onChange={onToggleAll} disabled={editableRows.length === 0} style={{ accentColor: 'var(--accent)' }} />
          </div>
          {headerCell(TITLE_SORT_KEY, 'Title', true)}
          {columns.map((c) => headerCell(c.key, c.key, true))}
          <button
            onClick={onAddColumn}
            title="Add property column"
            style={{ margin: '0 auto', display: 'inline-flex', padding: '0.25rem', background: 'none', border: '1px dashed var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-dim)', cursor: 'pointer' }}
          >
            <PlusIcon />
          </button>
        </div>

        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((v) => {
            const abs: CSSProperties = { position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${v.start}px)` };

            if (v.index >= entries.length) {
              return (
                <div key="ghost" style={{ ...rowStyle, ...abs, borderBottom: 'none' }}>
                  <div />
                  <div style={{ ...cellPad, gridColumn: `2 / ${3 + columns.length}` }}>
                    <input
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && draft.trim()) {
                          onCreateRow(draft.trim());
                          setDraft('');
                        }
                      }}
                      placeholder="＋ New note — type a title, press Enter"
                      style={{ width: '100%', font: 'inherit', color: 'var(--text)', background: 'transparent', border: 'none', outline: 'none' }}
                    />
                  </div>
                </div>
              );
            }

            const entry = entries[v.index]!;
            if ('header' in entry) {
              return (
                <div key={`g:${entry.header}:${v.index}`} style={{ ...rowStyle, ...abs, gridTemplateColumns: '1fr', background: 'var(--surface-2)', fontWeight: 600, fontSize: '0.78rem' }}>
                  <div style={{ ...cellPad, gap: 8 }}>
                    {entry.header}
                    <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>{entry.count}</span>
                  </div>
                </div>
              );
            }
            const row = entry.row;
            const Icon = TYPE_ICON[row.item.type];
            return (
              <div key={row.item.id} style={{ ...rowStyle, ...abs, background: selected.has(row.item.id) ? 'var(--surface-2)' : undefined }}>
                <div style={{ ...cellPad, justifyContent: 'center' }}>
                  {row.editable && (
                    <input type="checkbox" checked={selected.has(row.item.id)} onChange={() => onToggleSelect(row.item.id)} style={{ accentColor: 'var(--accent)' }} />
                  )}
                </div>
                <div
                  onClick={onOpen ? () => onOpen(row.item) : undefined}
                  style={{ ...cellPad, gap: 8, cursor: onOpen ? 'pointer' : 'default', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                >
                  <Icon style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.item.title}</span>
                </div>
                {columns.map((c) => (
                  <div key={c.key} style={cellPad}>
                    <PropertyCell
                      value={row.props[c.key]}
                      kind={c.kind}
                      currency={c.currency ?? 'EUR'}
                      options={c.options}
                      editable={row.editable}
                      editing={editing?.id === row.item.id && editing.key === c.key}
                      onStartEdit={() => setEditing({ id: row.item.id, key: c.key })}
                      onCommit={(value) => {
                        setEditing(null);
                        onEditCell(row.item.id, c.key, value);
                      }}
                      onCancel={() => setEditing(null)}
                    />
                  </div>
                ))}
                <div />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
