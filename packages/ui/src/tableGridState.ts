/**
 * QUARANTINE: table interaction state (selection × editing × virtualization).
 *
 * This is deliberately pure and DOM-free. Its invariants:
 * - cells are addressed by item id + column key, never by mounted DOM nodes;
 *   virtualization may unmount selected cells, while PropertyTable pins the
 *   one editing row so its native input draft is not destroyed.
 * - a selection is one anchor/focus pair; every range is the rectangle those
 *   endpoints describe in the current row/column projection.
 * - editing belongs to exactly one selected cell. Commit/cancel always leaves
 *   a valid selection, and keyboard movement is clamped to the current grid.
 * - projection reconciliation drops state whose row or column disappeared;
 *   stale ids never drift onto another user's cell after a sort or refresh.
 *
 * Application concerns (vault writes, parsing, row creation) do not enter this
 * module. PropertyTable translates these plain transitions into callbacks.
 */

export interface TableGridCell {
  rowId: string;
  columnKey: string;
}

export interface TableGridProjection {
  rowIds: readonly string[];
  columnKeys: readonly string[];
}

export interface TableGridSelection {
  anchor: TableGridCell;
  focus: TableGridCell;
}

export interface TableGridEdit {
  cell: TableGridCell;
  /** A printable key starts replacement editing; absent means edit the current value. */
  seed?: string;
}

export interface TableGridState {
  selection: TableGridSelection | null;
  editing: TableGridEdit | null;
}

export type TableGridDirection = 'up' | 'down' | 'left' | 'right' | 'home' | 'end';

export type TableGridAction =
  | { type: 'select'; cell: TableGridCell; extend: boolean }
  | { type: 'move'; direction: TableGridDirection; extend: boolean; projection: TableGridProjection }
  | { type: 'start-edit'; cell: TableGridCell; seed?: string }
  | { type: 'finish-edit'; direction?: TableGridDirection; projection: TableGridProjection }
  | { type: 'cancel-edit' }
  | { type: 'clear-selection' }
  | { type: 'reconcile'; projection: TableGridProjection };

export const EMPTY_TABLE_GRID_STATE: TableGridState = { selection: null, editing: null };

export function sameTableGridCell(a: TableGridCell, b: TableGridCell): boolean {
  return a.rowId === b.rowId && a.columnKey === b.columnKey;
}

function containsCell(projection: TableGridProjection, cell: TableGridCell): boolean {
  return projection.rowIds.includes(cell.rowId) && projection.columnKeys.includes(cell.columnKey);
}

function moveCell(cell: TableGridCell, direction: TableGridDirection, projection: TableGridProjection): TableGridCell {
  if (projection.rowIds.length === 0 || projection.columnKeys.length === 0) return cell;
  const row = Math.max(0, projection.rowIds.indexOf(cell.rowId));
  const column = Math.max(0, projection.columnKeys.indexOf(cell.columnKey));
  const lastRow = Math.max(0, projection.rowIds.length - 1);
  const lastColumn = Math.max(0, projection.columnKeys.length - 1);
  const nextRow =
    direction === 'up' ? Math.max(0, row - 1)
    : direction === 'down' ? Math.min(lastRow, row + 1)
    : row;
  const nextColumn =
    direction === 'left' ? Math.max(0, column - 1)
    : direction === 'right' ? Math.min(lastColumn, column + 1)
    : direction === 'home' ? 0
    : direction === 'end' ? lastColumn
    : column;
  return {
    rowId: projection.rowIds[nextRow]!,
    columnKey: projection.columnKeys[nextColumn]!,
  };
}

function firstCell(projection: TableGridProjection): TableGridCell | null {
  const rowId = projection.rowIds[0];
  const columnKey = projection.columnKeys[0];
  return rowId && columnKey ? { rowId, columnKey } : null;
}

export function tableGridReducer(state: TableGridState, action: TableGridAction): TableGridState {
  switch (action.type) {
    case 'select': {
      const selection =
        action.extend && state.selection
          ? { anchor: state.selection.anchor, focus: action.cell }
          : { anchor: action.cell, focus: action.cell };
      return { selection, editing: null };
    }
    case 'move': {
      const current = state.selection?.focus ?? firstCell(action.projection);
      if (!current) return EMPTY_TABLE_GRID_STATE;
      const focus = moveCell(current, action.direction, action.projection);
      const anchor = action.extend && state.selection ? state.selection.anchor : focus;
      return { selection: { anchor, focus }, editing: null };
    }
    case 'start-edit':
      return {
        selection: { anchor: action.cell, focus: action.cell },
        editing: action.seed === undefined ? { cell: action.cell } : { cell: action.cell, seed: action.seed },
      };
    case 'finish-edit': {
      if (!state.editing) return state;
      const focus = action.direction
        ? moveCell(state.editing.cell, action.direction, action.projection)
        : state.editing.cell;
      return { selection: { anchor: focus, focus }, editing: null };
    }
    case 'cancel-edit':
      return state.editing
        ? { selection: { anchor: state.editing.cell, focus: state.editing.cell }, editing: null }
        : state;
    case 'clear-selection':
      return EMPTY_TABLE_GRID_STATE;
    case 'reconcile': {
      if (!state.selection) return state;
      if (
        containsCell(action.projection, state.selection.anchor) &&
        containsCell(action.projection, state.selection.focus) &&
        (!state.editing || containsCell(action.projection, state.editing.cell))
      ) {
        return state;
      }
      return EMPTY_TABLE_GRID_STATE;
    }
  }
}

export interface TableGridRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export function tableGridSelectionRect(
  selection: TableGridSelection | null,
  projection: TableGridProjection,
): TableGridRect | null {
  if (!selection) return null;
  const anchorRow = projection.rowIds.indexOf(selection.anchor.rowId);
  const focusRow = projection.rowIds.indexOf(selection.focus.rowId);
  const anchorColumn = projection.columnKeys.indexOf(selection.anchor.columnKey);
  const focusColumn = projection.columnKeys.indexOf(selection.focus.columnKey);
  if (anchorRow < 0 || focusRow < 0 || anchorColumn < 0 || focusColumn < 0) return null;
  return {
    top: Math.min(anchorRow, focusRow),
    bottom: Math.max(anchorRow, focusRow),
    left: Math.min(anchorColumn, focusColumn),
    right: Math.max(anchorColumn, focusColumn),
  };
}

export function tableGridCells(
  selection: TableGridSelection | null,
  projection: TableGridProjection,
): TableGridCell[][] {
  const rect = tableGridSelectionRect(selection, projection);
  if (!rect) return [];
  const rows: TableGridCell[][] = [];
  for (let row = rect.top; row <= rect.bottom; row++) {
    const cells: TableGridCell[] = [];
    for (let column = rect.left; column <= rect.right; column++) {
      cells.push({ rowId: projection.rowIds[row]!, columnKey: projection.columnKeys[column]! });
    }
    rows.push(cells);
  }
  return rows;
}
