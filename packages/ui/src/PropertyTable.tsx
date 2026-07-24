/**
 * Airtable-style table over library rows (docs/12: notes as rows). Pure
 * presentation: rows and columns arrive as props; mutation callbacks keep
 * vault writes in the app. Row-virtualized like VirtualList, with interaction
 * state delegated to tableGridState.ts, clipboard spelling to
 * tableClipboard.ts, and column pointer sessions to
 * useTableColumnInteractions.ts.
 * Executable contract: docs/recipes/verify-table-interactions.md.
 */
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual';
import type { PropertyValue } from '@waffle/core';
import {
  TABLE_COLUMN_MAX_WIDTH,
  TABLE_COLUMN_MIN_WIDTH,
  type GroupSection,
  type LibraryItem,
  type TableColumnConfig,
} from './types';
import { EDITABLE_KINDS, PropertyCell } from './PropertyCell';
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
import { InteractionBadges } from './InteractionBadges';
import { DashIcon, FileIcon, LinkIcon, NoteIcon, PlusIcon } from './icons';
import { parseClipboardTsv, propertyToTsv } from './tableClipboard';
import { useTableColumnInteractions } from './useTableColumnInteractions';

export interface TableColumn extends TableColumnConfig {
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
  /** Copy each selected column's top cell through the lower selected note rows. */
  onFillDown?: (cells: TableGridCell[][]) => void;
  /** Spreadsheet paste with no active cell appends rows and may infer columns. */
  onPasteRows?: (rows: string[][]) => void;
  /** Persist the rendered property-column order and widths as one view-config patch. */
  onColumnsChange?: (columns: TableColumnConfig[]) => void;
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
const W_ADD = 44;

const TYPE_ICON = { note: NoteIcon, link: LinkIcon, file: FileIcon, dash: DashIcon } as const;

/** One virtualized line: a group header or a data row. */
type Entry = { header: string; count: number } | { row: TableRowData };

function domCellPart(value: string): string {
  return `${value.length}-${encodeURIComponent(value)}`;
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
  onFillDown,
  onPasteRows,
  onColumnsChange,
  canCreate,
  onCreateRow,
  onAddColumn,
  onOpen,
}: PropertyTableProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const gridDomId = useId();
  const [grid, dispatchGrid] = useReducer(tableGridReducer, EMPTY_TABLE_GRID_STATE);
  const [draft, setDraft] = useState('');
  const {
    columnWidths,
    draggedKey,
    dropTarget,
    resizeDraft,
    persistColumnWidth,
    startColumnDrag,
    startColumnResize,
    suppressesHeaderClick,
  } = useTableColumnInteractions(columns, onColumnsChange);

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
  const cellDomId = (cell: TableGridCell): string =>
    `${gridDomId}-r${domCellPart(cell.rowId)}-c${domCellPart(cell.columnKey)}`;
  const virtualItems = virtualizer.getVirtualItems();
  const activeEntryIndex = activeCell ? entryIndexByRowId.get(activeCell.rowId) : undefined;
  const activeCellMounted =
    activeEntryIndex !== undefined &&
    virtualItems.some((virtualRow) => virtualRow.index === activeEntryIndex);
  useEffect(() => {
    if (!activeCell) return;
    const entryIndex = entryIndexByRowId.get(activeCell.rowId);
    if (entryIndex !== undefined) virtualizer.scrollToIndex(entryIndex, { align: 'auto' });

    const columnIndex = columnKeys.indexOf(activeCell.columnKey);
    const parent = parentRef.current;
    if (!parent || columnIndex < 0) return;
    if (columnIndex === 0) return; // Title is sticky and therefore always visible.
    const left = W_CHECK + W_TITLE + columnWidths.slice(0, columnIndex - 1).reduce((sum, width) => sum + width, 0);
    const width = columnWidths[columnIndex - 1]!;
    const stickyRight = parent.scrollLeft + W_CHECK + W_TITLE;
    if (left < stickyRight) parent.scrollLeft = Math.max(0, left - W_CHECK - W_TITLE);
    else if (left + width > parent.scrollLeft + parent.clientWidth) {
      parent.scrollLeft = left + width - parent.clientWidth;
    }
  }, [activeCell, columnKeys, columnWidths, entryIndexByRowId, virtualizer]);

  const selectedCells = useMemo(() => tableGridCells(grid.selection, projection), [grid.selection, projection]);
  const selectionRect = useMemo(() => tableGridSelectionRect(grid.selection, projection), [grid.selection, projection]);

  const totalWidth = W_CHECK + W_TITLE + columnWidths.reduce((sum, width) => sum + width, 0) + W_ADD;
  const gridTemplate = `${W_CHECK}px ${W_TITLE}px ${columnWidths.map((width) => `${width}px`).join(' ')} ${W_ADD}px`.trim();
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

  const headerCell = (key: string, label: ReactNode, columnIndex: number, column?: TableColumn): ReactNode => {
    const draggable = !!column && !!onColumnsChange;
    const isDropTarget = dropTarget?.key === key && draggedKey !== key;
    return (
      <div
        key={key}
        role="columnheader"
        aria-colindex={columnIndex + 1}
        aria-sort={sort?.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
        data-table-column-key={column?.key}
        onClick={() => {
          if (suppressesHeaderClick()) return;
          onSort(key);
        }}
        onPointerDown={column ? (event) => startColumnDrag(event, column) : undefined}
        style={{
          ...cellPad,
          position: key === TITLE_SORT_KEY ? 'sticky' : 'relative',
          left: key === TITLE_SORT_KEY ? W_CHECK : undefined,
          zIndex: key === TITLE_SORT_KEY ? 3 : undefined,
          background: key === TITLE_SORT_KEY ? 'var(--surface)' : undefined,
          borderRight: key === TITLE_SORT_KEY ? '1px solid var(--border)' : undefined,
          gap: 4,
          cursor: draggable ? 'grab' : 'pointer',
          fontWeight: 600,
          fontSize: '0.76rem',
          color: 'var(--text-dim)',
          whiteSpace: 'nowrap',
          userSelect: 'none',
          opacity: draggedKey === key ? 0.55 : 1,
          boxShadow: isDropTarget
            ? dropTarget.edge === 'before'
              ? 'inset 2px 0 0 var(--accent)'
              : 'inset -2px 0 0 var(--accent)'
            : undefined,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
        {sort?.key === key && <span aria-hidden>{sort.dir === 'asc' ? '▲' : '▼'}</span>}
        {column && (
          <span
            role="separator"
            aria-label={`Resize ${column.key} column`}
            aria-orientation="vertical"
            aria-valuemin={TABLE_COLUMN_MIN_WIDTH}
            aria-valuemax={TABLE_COLUMN_MAX_WIDTH}
            aria-valuenow={resizeDraft?.key === column.key ? resizeDraft.width : column.width}
            tabIndex={onColumnsChange ? 0 : -1}
            draggable={false}
            onClick={(event) => event.stopPropagation()}
            onDragStart={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onPointerDown={(event) => startColumnResize(event, column)}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
              event.preventDefault();
              event.stopPropagation();
              persistColumnWidth(column.key, column.width + (event.key === 'ArrowRight' ? 16 : -16));
            }}
            style={{
              position: 'absolute',
              top: 0,
              right: -4,
              width: 8,
              height: '100%',
              cursor: 'col-resize',
              touchAction: 'none',
              zIndex: 1,
              borderRight: resizeDraft?.key === column.key ? '2px solid var(--accent)' : undefined,
            }}
          />
        )}
      </div>
    );
  };

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
    return !!row?.editable && row.props[cell.columnKey]?.kind !== 'unsupported' && !!column && EDITABLE_KINDS.includes(column.kind);
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

    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      if (selectedCells.length > 1) onFillDown?.(selectedCells);
      return;
    }
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

  const cellIsSelected = (rowIndex: number, columnIndex: number): boolean =>
    !!selectionRect &&
    rowIndex >= selectionRect.top &&
    rowIndex <= selectionRect.bottom &&
    columnIndex >= selectionRect.left &&
    columnIndex <= selectionRect.right;

  const cellSelectionStyle = (rowIndex: number, columnIndex: number, cell: TableGridCell): CSSProperties => {
    const inRange = cellIsSelected(rowIndex, columnIndex);
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
      aria-label="Library table"
      aria-rowcount={rows.length + 1}
      aria-colcount={columnKeys.length}
      aria-multiselectable="true"
      aria-activedescendant={activeCell && activeCellMounted ? cellDomId(activeCell) : undefined}
      tabIndex={0}
      onKeyDown={onGridKeyDown}
      onCopy={onCopy}
      onPaste={onPaste}
      style={{ height: '100%', overflow: 'auto', outline: 'none' }}
    >
      <div style={{ minWidth: totalWidth, width: 'max-content' }}>
        <div role="row" aria-rowindex={1} style={{ ...rowStyle, position: 'sticky', top: 0, zIndex: 2, background: 'var(--surface)' }}>
          <div
            role="presentation"
            style={{ ...cellPad, position: 'sticky', left: 0, zIndex: 4, justifyContent: 'center', background: 'var(--surface)' }}
          >
            <input aria-label="Select all rows" type="checkbox" checked={allSelected} onChange={onToggleAll} disabled={selectableRows.length === 0} style={{ accentColor: 'var(--accent)' }} />
          </div>
          {headerCell(TITLE_SORT_KEY, 'Title', 0)}
          {columns.map((column, index) => headerCell(column.key, column.key, index + 1, column))}
          <button
            onClick={onAddColumn}
            aria-label="Add property column"
            title="Add property column"
            style={{ margin: '0 auto', display: 'inline-flex', padding: '0.25rem', background: 'none', border: '1px dashed var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-dim)', cursor: 'pointer' }}
          >
            <PlusIcon />
          </button>
        </div>

        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualItems.map((virtualRow) => {
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
                  <div style={{ position: 'sticky', left: 0, height: '100%', zIndex: 1, background: 'var(--bg)' }} />
                  <div style={{ ...cellPad, position: 'sticky', left: W_CHECK, zIndex: 1, background: 'var(--bg)', borderRight: '1px solid var(--border)' }}>
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
            const stickyBackground = selected.has(row.item.id) ? 'var(--surface-2)' : 'var(--bg)';
            return (
              <div key={row.item.id} role="row" aria-rowindex={rowIndex + 2} data-row-id={row.item.id} style={{ ...rowStyle, ...abs, background: selected.has(row.item.id) ? 'var(--surface-2)' : undefined }}>
                <div
                  role="presentation"
                  style={{ ...cellPad, position: 'sticky', left: 0, zIndex: 2, justifyContent: 'center', background: stickyBackground }}
                >
                  {(row.editable || row.deletable) && (
                    <input aria-label={`Select row ${row.item.title}`} type="checkbox" checked={selected.has(row.item.id)} onChange={() => onToggleSelect(row.item.id)} style={{ accentColor: 'var(--accent)' }} />
                  )}
                </div>
                <div
                  id={cellDomId(titleCell)}
                  role="gridcell"
                  aria-colindex={1}
                  aria-label={`Title: ${row.item.title}`}
                  aria-readonly="true"
                  data-column-key={TITLE_SORT_KEY}
                  aria-selected={cellIsSelected(rowIndex, 0)}
                  onClick={(event) => selectCell(titleCell, event)}
                  onDoubleClick={() => open?.(row.item)}
                  title={open ? 'Double-click to open' : undefined}
                  style={{
                    ...cellPad,
                    position: 'sticky',
                    left: W_CHECK,
                    zIndex: 1,
                    background: stickyBackground,
                    borderRight: '1px solid var(--border)',
                    ...cellSelectionStyle(rowIndex, 0, titleCell),
                    gap: 8,
                    fontWeight: 500,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  <Icon style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.item.title}</span>
                  <InteractionBadges marks={row.item.interactionMarks} />
                </div>
                {columns.map((column, propertyIndex) => {
                  const cell: TableGridCell = { rowId: row.item.id, columnKey: column.key };
                  const editing = !!grid.editing && sameTableGridCell(grid.editing.cell, cell);
                  return (
                    <div
                      key={column.key}
                      id={cellDomId(cell)}
                      role="gridcell"
                      aria-colindex={propertyIndex + 2}
                      aria-label={`${row.item.title}, ${column.key}: ${row.props[column.key] ? propertyToTsv(row.props[column.key]!) : 'blank'}${editing ? ', editing' : ''}`}
                      aria-readonly={!row.editable || row.props[column.key]?.kind === 'unsupported' || !EDITABLE_KINDS.includes(column.kind)}
                      data-column-key={column.key}
                      aria-selected={cellIsSelected(rowIndex, propertyIndex + 1)}
                      onClick={(event) => selectCell(cell, event)}
                      onDoubleClick={() => startEdit(cell)}
                      style={{
                        ...cellPad,
                        ...cellSelectionStyle(rowIndex, propertyIndex + 1, cell),
                      }}
                    >
                      <PropertyCell
                        label={`${column.key} for ${row.item.title}`}
                        value={row.props[column.key]}
                        kind={column.kind}
                        currency={column.currency ?? 'EUR'}
                        options={column.options}
                        editable={row.editable && row.props[column.key]?.kind !== 'unsupported'}
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
