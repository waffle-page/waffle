/**
 * Airtable-style table over library rows (docs/12: notes as rows). Pure
 * presentation: rows and columns arrive as props; mutation callbacks keep
 * vault writes in the app. Row-virtualized like VirtualList, with interaction
 * state delegated to the quarantined tableGridState.ts state machine.
 * Executable contract: docs/recipes/verify-table-interactions.md.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type ClipboardEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual';
import type { PropertyValue } from '@waffle/core';
import type { GroupSection, LibraryItem } from './types';
import { EDITABLE_KINDS, formatProperty, PropertyCell } from './PropertyCell';
import {
  EMPTY_TABLE_GRID_STATE,
  sameTableGridCell,
  tableGridCells,
  tableGridReducer,
  tableGridSelectionRect,
  type TableGridCell,
  type TableGridDirection,
  type TableGridProjection,
} from './tableGridState';
import { isOpenable } from './ToppingCard';
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
  /** Any vault-backed row can be selected for deletion (its file moves to .trash/). */
  deletable: boolean;
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
  /** Clear property cells as one logical operation; Title cells are never sent. */
  onClearCells?: (cells: TableGridCell[]) => void;
  /** Paste a TSV rectangle at the active cell. */
  onPasteCells?: (anchor: TableGridCell, rows: string[][]) => void;
  /** Spreadsheet paste with no active cell appends rows and may infer columns. */
  onPasteRows?: (rows: string[][]) => void;
  /** false ⇒ no ghost row (folder has no vault directory to create files in). */
  canCreate: boolean;
  onCreateRow: (title: string) => void;
  onAddColumn: () => void;
  onOpen?: (item: LibraryItem) => void;
}

/** Built-in read-only Title column; `$`-prefixed keys are reserved from properties. */
export const TITLE_SORT_KEY = '$title';

const ROW_H = 36;
const W_CHECK = 36;
const W_TITLE = 280;
const W_PROP = 160;
const W_ADD = 44;

const TYPE_ICON = { note: NoteIcon, link: LinkIcon, file: FileIcon, dash: DashIcon } as const;

/** One virtualized line: a group header or a data row. */
type Entry = { header: string; count: number } | { row: TableRowData };

function parseClipboardTsv(text: string): string[][] {
  const lines = text.replace(/\r/g, '').split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines.length === 0 || lines.every((line) => line === '') ? [] : lines.map((line) => line.split('\t'));
}

/** Canonical, parseable clipboard text; display formatting is deliberately locale-specific. */
function propertyToTsv(value: PropertyValue): string {
  switch (value.kind) {
    case 'text': case 'url': return value.value;
    case 'select': return value.option;
    case 'number': return String(value.value);
    case 'checkbox': return value.value ? 'true' : 'false';
    case 'money': return String(value.amount);
    case 'date': return value.iso;
    default: return formatProperty(value);
  }
}

export function PropertyTable({
  rows,
  columns,
  groups,
  sort,
  onSort,
  selected,
  onToggleSelect,
  onToggleAll,
  onEditCell,
  onClearCells,
  onPasteCells,
  onPasteRows,
  canCreate,
  onCreateRow,
  onAddColumn,
  onOpen,
}: PropertyTableProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [grid, dispatchGrid] = useReducer(tableGridReducer, EMPTY_TABLE_GRID_STATE);
  const [draft, setDraft] = useState('');

  const rowIds = useMemo(() => rows.map((row) => row.item.id), [rows]);
  const columnKeys = useMemo(() => [TITLE_SORT_KEY, ...columns.map((column) => column.key)], [columns]);
  const projection = useMemo<TableGridProjection>(() => ({ rowIds, columnKeys }), [rowIds, columnKeys]);
  const rowById = useMemo(() => new Map(rows.map((row) => [row.item.id, row])), [rows]);
  const rowIndexById = useMemo(() => new Map(rows.map((row, index) => [row.item.id, index])), [rows]);
  const columnByKey = useMemo(() => new Map(columns.map((column) => [column.key, column])), [columns]);

  useEffect(() => {
    dispatchGrid({ type: 'reconcile', projection });
  }, [projection]);

  const entries = useMemo<Entry[]>(() => {
    if (!groups?.length) return rows.map((row) => ({ row }));
    const out: Entry[] = [];
    let i = 0;
    for (const group of groups) {
      out.push({ header: group.label, count: group.count });
      for (let k = 0; k < group.count && i < rows.length; k++) out.push({ row: rows[i++]! });
    }
    return out;
  }, [rows, groups]);

  const entryIndexByRowId = useMemo(() => {
    const map = new Map<string, number>();
    entries.forEach((entry, index) => {
      if ('row' in entry) map.set(entry.row.item.id, index);
    });
    return map;
  }, [entries]);

  const editingEntryIndex = grid.editing ? entryIndexByRowId.get(grid.editing.cell.rowId) : undefined;
  const rangeExtractor = useCallback((range: Range): number[] => {
    const visible = defaultRangeExtractor(range);
    if (editingEntryIndex === undefined || visible.includes(editingEntryIndex)) return visible;
    return [...visible, editingEntryIndex].sort((a, b) => a - b);
  }, [editingEntryIndex]);

  const count = entries.length + (canCreate ? 1 : 0);
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
    // Keep the live editor mounted when the user scrolls it offscreen; its
    // native input owns the draft until commit/cancel.
    rangeExtractor,
  });

  const activeCell = grid.selection?.focus ?? null;
  useEffect(() => {
    if (!activeCell) return;
    const entryIndex = entryIndexByRowId.get(activeCell.rowId);
    if (entryIndex !== undefined) virtualizer.scrollToIndex(entryIndex, { align: 'auto' });

    const columnIndex = columnKeys.indexOf(activeCell.columnKey);
    const parent = parentRef.current;
    if (!parent || columnIndex < 0) return;
    const left = columnIndex === 0 ? W_CHECK : W_CHECK + W_TITLE + (columnIndex - 1) * W_PROP;
    const width = columnIndex === 0 ? W_TITLE : W_PROP;
    if (left < parent.scrollLeft) parent.scrollLeft = left;
    else if (left + width > parent.scrollLeft + parent.clientWidth) {
      parent.scrollLeft = left + width - parent.clientWidth;
    }
  }, [activeCell, columnKeys, entryIndexByRowId, virtualizer]);

  const selectedCells = useMemo(() => tableGridCells(grid.selection, projection), [grid.selection, projection]);
  const selectionRect = useMemo(() => tableGridSelectionRect(grid.selection, projection), [grid.selection, projection]);

  const totalWidth = W_CHECK + W_TITLE + columns.length * W_PROP + W_ADD;
  const gridTemplate = `${W_CHECK}px ${W_TITLE}px ${columns.map(() => `${W_PROP}px`).join(' ')} ${W_ADD}px`.trim();
  const selectableRows = rows.filter((row) => row.editable || row.deletable);
  const allSelected = selectableRows.length > 0 && selectableRows.every((row) => selected.has(row.item.id));

  const rowStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: gridTemplate,
    alignItems: 'center',
    height: ROW_H,
    borderBottom: '1px solid var(--border)',
    fontSize: '0.84rem',
  };
  const cellPad: CSSProperties = {
    padding: '0 0.6rem',
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    height: '100%',
  };

  const headerCell = (key: string, label: ReactNode, sortable: boolean): ReactNode => (
    <div
      key={key}
      role="columnheader"
      onClick={sortable ? () => onSort(key) : undefined}
      style={{
        ...cellPad,
        gap: 4,
        cursor: sortable ? 'pointer' : 'default',
        fontWeight: 600,
        fontSize: '0.76rem',
        color: 'var(--text-dim)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        userSelect: 'none',
      }}
    >
      {label}
      {sort?.key === key && <span aria-hidden>{sort.dir === 'asc' ? '▲' : '▼'}</span>}
    </div>
  );

  const focusTable = (): void => {
    parentRef.current?.focus({ preventScroll: true });
  };

  const selectCell = (cell: TableGridCell, event: MouseEvent): void => {
    dispatchGrid({ type: 'select', cell, extend: event.shiftKey });
    focusTable();
  };

  const cellCanEdit = (cell: TableGridCell): boolean => {
    const row = rowById.get(cell.rowId);
    const column = columnByKey.get(cell.columnKey);
    return !!row?.editable && !!column && EDITABLE_KINDS.includes(column.kind);
  };

  const toggleCheckbox = (cell: TableGridCell): boolean => {
    const row = rowById.get(cell.rowId);
    const column = columnByKey.get(cell.columnKey);
    if (!row?.editable || column?.kind !== 'checkbox') return false;
    const current = row.props[cell.columnKey];
    const checked = current?.kind === 'checkbox' && current.value;
    onEditCell(cell.rowId, cell.columnKey, { kind: 'checkbox', value: !checked });
    dispatchGrid({ type: 'select', cell, extend: false });
    return true;
  };

  const startEdit = (cell: TableGridCell, seed?: string): void => {
    if (!cellCanEdit(cell)) return;
    if (columnByKey.get(cell.columnKey)?.kind === 'checkbox') {
      toggleCheckbox(cell);
      return;
    }
    dispatchGrid(seed === undefined ? { type: 'start-edit', cell } : { type: 'start-edit', cell, seed });
  };

  const move = (direction: TableGridDirection, extend: boolean): void => {
    dispatchGrid({ type: 'move', direction, extend, projection });
  };

  const onGridKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return;
    const cell = grid.selection?.focus;

    const navigation: Partial<Record<string, TableGridDirection>> = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
      Home: 'home',
      End: 'end',
    };
    const direction = navigation[event.key];
    if (direction) {
      event.preventDefault();
      move(direction, event.shiftKey);
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      move(event.shiftKey ? 'left' : 'right', false);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      dispatchGrid({ type: 'clear-selection' });
      return;
    }
    if (!cell) return;

    if (event.key === 'Enter') {
      event.preventDefault();
      startEdit(cell);
      return;
    }
    if (event.key === ' ' && columnByKey.get(cell.columnKey)?.kind === 'checkbox') {
      event.preventDefault();
      toggleCheckbox(cell);
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      const propertyCells = selectedCells.flat().filter((selectedCell) => selectedCell.columnKey !== TITLE_SORT_KEY);
      if (propertyCells.length > 0) onClearCells?.(propertyCells);
      return;
    }
    if (
      event.key.length === 1 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      columnByKey.get(cell.columnKey)?.kind !== 'checkbox'
    ) {
      event.preventDefault();
      startEdit(cell, event.key);
    }
  };

  const onCopy = (event: ClipboardEvent<HTMLDivElement>): void => {
    if (grid.editing || selectedCells.length === 0) return;
    const text = selectedCells
      .map((cellRow) =>
        cellRow
          .map((cell) => {
            const row = rowById.get(cell.rowId);
            if (!row) return '';
            if (cell.columnKey === TITLE_SORT_KEY) return row.item.title;
            const value = row.props[cell.columnKey];
            return value ? propertyToTsv(value) : '';
          })
          .join('\t'),
      )
      .join('\n');
    event.preventDefault();
    event.clipboardData.setData('text/plain', text);
  };

  const onPaste = (event: ClipboardEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement;
    if (grid.editing || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;
    const parsed = parseClipboardTsv(event.clipboardData.getData('text/plain'));
    if (parsed.length === 0) return;
    const anchor = grid.selection?.focus;
    if (anchor && onPasteCells) {
      event.preventDefault();
      onPasteCells(anchor, parsed);
    } else if (onPasteRows) {
      event.preventDefault();
      onPasteRows(parsed);
    }
  };

  const cellSelectionStyle = (rowIndex: number, columnIndex: number, cell: TableGridCell): CSSProperties => {
    const inRange =
      !!selectionRect &&
      rowIndex >= selectionRect.top &&
      rowIndex <= selectionRect.bottom &&
      columnIndex >= selectionRect.left &&
      columnIndex <= selectionRect.right;
    const active = !!grid.selection && sameTableGridCell(grid.selection.focus, cell);
    return {
      background: inRange ? 'var(--surface-2)' : undefined,
      boxShadow: active ? 'inset 0 0 0 2px var(--accent)' : inRange ? 'inset 0 0 0 1px var(--border)' : undefined,
      cursor: 'cell',
    };
  };

  return (
    <div
      ref={parentRef}
      role="grid"
      aria-rowcount={rows.length}
      aria-colcount={columnKeys.length}
      tabIndex={0}
      onKeyDown={onGridKeyDown}
      onCopy={onCopy}
      onPaste={onPaste}
      style={{ height: '100%', overflow: 'auto', outline: 'none' }}
    >
      <div style={{ minWidth: totalWidth, width: 'max-content' }}>
        <div role="row" style={{ ...rowStyle, position: 'sticky', top: 0, zIndex: 2, background: 'var(--surface)' }}>
          <div role="columnheader" style={{ ...cellPad, justifyContent: 'center' }}>
            <input type="checkbox" checked={allSelected} onChange={onToggleAll} disabled={selectableRows.length === 0} style={{ accentColor: 'var(--accent)' }} />
          </div>
          {headerCell(TITLE_SORT_KEY, 'Title', true)}
          {columns.map((column) => headerCell(column.key, column.key, true))}
          <button
            onClick={onAddColumn}
            title="Add property column"
            style={{ margin: '0 auto', display: 'inline-flex', padding: '0.25rem', background: 'none', border: '1px dashed var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-dim)', cursor: 'pointer' }}
          >
            <PlusIcon />
          </button>
        </div>

        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const abs: CSSProperties = {
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              transform: `translateY(${virtualRow.start}px)`,
            };

            if (virtualRow.index >= entries.length) {
              return (
                <div key="ghost" style={{ ...rowStyle, ...abs, borderBottom: 'none' }}>
                  <div />
                  <div style={{ ...cellPad, gridColumn: `2 / ${3 + columns.length}` }}>
                    <input
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && draft.trim()) {
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

            const entry = entries[virtualRow.index]!;
            if ('header' in entry) {
              return (
                <div key={`g:${entry.header}:${virtualRow.index}`} style={{ ...rowStyle, ...abs, gridTemplateColumns: '1fr', background: 'var(--surface-2)', fontWeight: 600, fontSize: '0.78rem' }}>
                  <div style={{ ...cellPad, gap: 8 }}>
                    {entry.header}
                    <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>{entry.count}</span>
                  </div>
                </div>
              );
            }

            const row = entry.row;
            const rowIndex = rowIndexById.get(row.item.id) ?? -1;
            const Icon = TYPE_ICON[row.item.type];
            const open = onOpen && isOpenable(row.item) ? onOpen : undefined;
            const titleCell: TableGridCell = { rowId: row.item.id, columnKey: TITLE_SORT_KEY };
            return (
              <div key={row.item.id} role="row" data-row-id={row.item.id} style={{ ...rowStyle, ...abs, background: selected.has(row.item.id) ? 'var(--surface-2)' : undefined }}>
                <div style={{ ...cellPad, justifyContent: 'center' }}>
                  {(row.editable || row.deletable) && (
                    <input type="checkbox" checked={selected.has(row.item.id)} onChange={() => onToggleSelect(row.item.id)} style={{ accentColor: 'var(--accent)' }} />
                  )}
                </div>
                <div
                  role="gridcell"
                  data-column-key={TITLE_SORT_KEY}
                  aria-selected={!!grid.selection && sameTableGridCell(grid.selection.focus, titleCell)}
                  onClick={(event) => selectCell(titleCell, event)}
                  onDoubleClick={() => open?.(row.item)}
                  title={open ? 'Double-click to open' : undefined}
                  style={{
                    ...cellPad,
                    ...cellSelectionStyle(rowIndex, 0, titleCell),
                    gap: 8,
                    fontWeight: 500,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  <Icon style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.item.title}</span>
                </div>
                {columns.map((column, propertyIndex) => {
                  const cell: TableGridCell = { rowId: row.item.id, columnKey: column.key };
                  const editing = !!grid.editing && sameTableGridCell(grid.editing.cell, cell);
                  return (
                    <div
                      key={column.key}
                      role="gridcell"
                      data-column-key={column.key}
                      aria-selected={!!grid.selection && sameTableGridCell(grid.selection.focus, cell)}
                      onClick={(event) => selectCell(cell, event)}
                      onDoubleClick={() => startEdit(cell)}
                      style={{
                        ...cellPad,
                        ...cellSelectionStyle(rowIndex, propertyIndex + 1, cell),
                      }}
                    >
                      <PropertyCell
                        value={row.props[column.key]}
                        kind={column.kind}
                        currency={column.currency ?? 'EUR'}
                        options={column.options}
                        editable={row.editable}
                        editing={editing}
                        replacement={editing ? grid.editing?.seed : undefined}
                        onCommit={(value, direction) => {
                          onEditCell(row.item.id, column.key, value);
                          dispatchGrid({ type: 'finish-edit', direction, projection });
                          if (direction) requestAnimationFrame(focusTable);
                        }}
                        onCancel={() => {
                          dispatchGrid({ type: 'cancel-edit' });
                          requestAnimationFrame(focusTable);
                        }}
                      />
                    </div>
                  );
                })}
                <div />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
