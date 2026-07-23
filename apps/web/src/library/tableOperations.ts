/**
 * Pure planning boundary for table gestures.
 *
 * React and vault I/O stop here. Every planner converts a gesture into
 * row-batched note patches plus optional note creations. A patch carries both
 * before and after values: the UI uses `after` optimistically today, and Slice
 * C can record the same plan as an inverse patch without reconstructing state
 * after files have changed.
 *
 * Invariants:
 *  - at most one patch per note;
 *  - invalid non-empty input is omitted, never converted to clear;
 *  - read-only rows and structured values are consumed but never authored;
 *  - note creation receives complete frontmatter in one planned operation.
 */
import { type PropertyTypes, type PropertyValue } from '@waffle/core';
import {
  EDITABLE_KINDS,
  TABLE_COLUMN_DEFAULT_WIDTH,
  TITLE_SORT_KEY,
  parseCellInput,
  type EditablePropertyKind,
  type TableColumn,
  type TableColumnConfig,
  type TableGridCell,
  type TableRowData,
} from '@waffle/ui';

export type PropertyPatch = Record<string, PropertyValue | null>;

export interface PlannedNotePatch {
  itemId: string;
  path: string;
  before: PropertyPatch;
  after: PropertyPatch;
}

export interface PlannedNoteCreate {
  title: string;
  values: PropertyPatch;
}

export interface TableOperationPlan {
  patches: PlannedNotePatch[];
  creates: PlannedNoteCreate[];
  invalid: string[];
}

export interface PasteAppendPlan extends TableOperationPlan {
  addedTypes: PropertyTypes;
  columns: TableColumnConfig[] | null;
}

const PASTE_TRUE = new Set(['true', 'yes', '1']);
const PASTE_BOOL = new Set([...PASTE_TRUE, 'false', 'no', '0']);
const PASTE_DATE = /^\d{4}-\d{2}-\d{2}$/;

const emptyPlan = (): TableOperationPlan => ({ patches: [], creates: [], invalid: [] });

export function canAuthorProperty(row: TableRowData, key: string): boolean {
  return row.editable && row.props[key]?.kind !== 'unsupported';
}

/** Column kind from pasted values: unanimity or text. */
export function inferPasteKind(values: string[]): EditablePropertyKind {
  const present = values.map((value) => value.trim()).filter((value) => value !== '');
  if (present.length === 0) return 'text';
  if (present.every((value) => parseCellInput('list', value, 'EUR').ok)) return 'list';
  if (present.every((value) => !Number.isNaN(Number(value)))) return 'number';
  if (present.every((value) => PASTE_DATE.test(value))) return 'date';
  if (present.every((value) => PASTE_BOOL.has(value.toLowerCase()))) return 'checkbox';
  return 'text';
}

function pasteCellValue(kind: PropertyValue['kind'], raw: string, currency: string) {
  const value = raw.trim();
  if (value === '') return { ok: true as const, value: null };
  if (kind === 'checkbox') {
    return PASTE_BOOL.has(value.toLowerCase())
      ? { ok: true as const, value: { kind: 'checkbox' as const, value: PASTE_TRUE.has(value.toLowerCase()) } }
      : { ok: false as const, message: 'Use true, false, yes, no, 1, or 0.' };
  }
  return parseCellInput(kind, value, currency);
}

function samePropertyValue(left: PropertyValue | null | undefined, right: PropertyValue | null): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right);
}

function plannedPatch(row: TableRowData, after: PropertyPatch): PlannedNotePatch | null {
  const path = row.item.contentRef;
  if (!path || Object.keys(after).length === 0) return null;
  const before = Object.fromEntries(
    Object.keys(after).map((key) => [key, row.props[key] ?? null]),
  );
  return { itemId: row.item.id, path, before, after };
}

function finalizePatches(rowsById: ReadonlyMap<string, TableRowData>, afterById: ReadonlyMap<string, PropertyPatch>): PlannedNotePatch[] {
  const patches: PlannedNotePatch[] = [];
  for (const [itemId, after] of afterById) {
    const row = rowsById.get(itemId);
    const patch = row ? plannedPatch(row, after) : null;
    if (patch) patches.push(patch);
  }
  return patches;
}

export function planCellEdit(row: TableRowData | undefined, key: string, value: PropertyValue | null): TableOperationPlan {
  if (!row || !canAuthorProperty(row, key)) return emptyPlan();
  const patch = plannedPatch(row, { [key]: value });
  return { ...emptyPlan(), patches: patch ? [patch] : [] };
}

export function planBulkEdit(
  rows: TableRowData[],
  selected: ReadonlySet<string>,
  key: string,
  value: PropertyValue | null,
): TableOperationPlan & { skipped: number } {
  const selectedNotes = rows.filter((row) => selected.has(row.item.id) && row.editable && row.item.contentRef);
  const targets = value === null ? selectedNotes : selectedNotes.filter((row) => canAuthorProperty(row, key));
  return {
    ...emptyPlan(),
    patches: targets.flatMap((row) => {
      const patch = plannedPatch(row, { [key]: value });
      return patch ? [patch] : [];
    }),
    skipped: selectedNotes.length - targets.length,
  };
}

export function planClearCells(
  rowsById: ReadonlyMap<string, TableRowData>,
  cells: TableGridCell[],
): TableOperationPlan {
  const afterById = new Map<string, PropertyPatch>();
  for (const cell of cells) {
    const row = rowsById.get(cell.rowId);
    if (!row?.editable || !row.item.contentRef || row.props[cell.columnKey] === undefined) continue;
    const after = afterById.get(cell.rowId) ?? {};
    after[cell.columnKey] = null;
    afterById.set(cell.rowId, after);
  }
  return { ...emptyPlan(), patches: finalizePatches(rowsById, afterById) };
}

export function planFillDown(
  rowsById: ReadonlyMap<string, TableRowData>,
  columns: TableColumn[],
  cellRows: TableGridCell[][],
): TableOperationPlan {
  if (cellRows.length < 2) return emptyPlan();
  const sourceRow = rowsById.get(cellRows[0]?.[0]?.rowId ?? '');
  if (!sourceRow) return emptyPlan();

  const columnsByKey = new Map(columns.map((column) => [column.key, column]));
  const sourceValues = new Map<string, PropertyValue | null>();
  for (const cell of cellRows[0] ?? []) {
    const column = columnsByKey.get(cell.columnKey);
    if (!column || !canAuthorProperty(sourceRow, cell.columnKey) || !EDITABLE_KINDS.includes(column.kind)) continue;
    sourceValues.set(cell.columnKey, sourceRow.props[cell.columnKey] ?? null);
  }
  if (sourceValues.size === 0) return emptyPlan();

  const afterById = new Map<string, PropertyPatch>();
  for (const cells of cellRows.slice(1)) {
    const target = rowsById.get(cells[0]?.rowId ?? '');
    if (!target?.editable || !target.item.contentRef) continue;
    const after: PropertyPatch = {};
    for (const cell of cells) {
      if (!sourceValues.has(cell.columnKey) || !canAuthorProperty(target, cell.columnKey)) continue;
      const value = sourceValues.get(cell.columnKey) ?? null;
      if (!samePropertyValue(target.props[cell.columnKey], value)) after[cell.columnKey] = value;
    }
    if (Object.keys(after).length > 0) afterById.set(target.item.id, after);
  }
  return { ...emptyPlan(), patches: finalizePatches(rowsById, afterById) };
}

export function planPasteAtAnchor(args: {
  anchor: TableGridCell;
  grid: string[][];
  rows: TableRowData[];
  columns: TableColumn[];
  allowOverflow: boolean;
}): TableOperationPlan {
  const { anchor, grid, rows, columns, allowOverflow } = args;
  if (grid.length === 0) return emptyPlan();
  const rowStart = rows.findIndex((row) => row.item.id === anchor.rowId);
  const gridColumns = [TITLE_SORT_KEY, ...columns.map((column) => column.key)];
  const columnsByKey = new Map(columns.map((column) => [column.key, column]));
  const columnStart = gridColumns.indexOf(anchor.columnKey);
  if (rowStart < 0 || columnStart < 0) return emptyPlan();

  const afterById = new Map<string, PropertyPatch>();
  const creates: PlannedNoteCreate[] = [];
  const invalid: string[] = [];
  grid.forEach((sourceRow, rowOffset) => {
    const target = rows[rowStart + rowOffset];
    const values: PropertyPatch = {};
    let title = 'Untitled';
    sourceRow.forEach((raw, columnOffset) => {
      const key = gridColumns[columnStart + columnOffset];
      if (!key) return;
      if (key === TITLE_SORT_KEY) {
        title = raw.trim() || 'Untitled';
        return;
      }
      const column = columnsByKey.get(key);
      if (!column || !EDITABLE_KINDS.includes(column.kind)) return;
      if (target && !canAuthorProperty(target, key)) {
        invalid.push(`${key}: nested YAML values are read-only`);
        return;
      }
      const parsed = pasteCellValue(column.kind, raw, column.currency ?? 'EUR');
      if (!parsed.ok) {
        invalid.push(`${key}: ${parsed.message}`);
        return;
      }
      values[key] = parsed.value;
    });
    if (target) {
      if (target.editable && target.item.contentRef && Object.keys(values).length > 0) {
        afterById.set(target.item.id, values);
      }
    } else if (allowOverflow) {
      creates.push({ title, values });
    }
  });

  return {
    patches: finalizePatches(new Map(rows.map((row) => [row.item.id, row])), afterById),
    creates,
    invalid,
  };
}

/** Spreadsheet append planning, including header detection and new declarations. */
export function planPasteAppend(
  grid: string[][],
  columns: TableColumn[],
  types: PropertyTypes,
): PasteAppendPlan {
  const base: PasteAppendPlan = { ...emptyPlan(), addedTypes: {}, columns: null };
  if (grid.length === 0) return base;

  const byLower = new Map(columns.map((column) => [column.key.toLowerCase(), column] as const));
  const first = grid[0]!.map((cell) => cell.trim());
  const headerMode =
    first.slice(1).some((cell) => byLower.has(cell.toLowerCase())) ||
    (columns.length === 0 && grid.length > 1 && first.length > 1 && first.every((cell) => cell !== ''));
  const keys: Array<string | null> = headerMode
    ? first.map((header, index) => (index === 0 || !header || header.startsWith('$') ? null : byLower.get(header.toLowerCase())?.key ?? header))
    : first.map((_, index) => (index === 0 ? null : columns[index - 1]?.key ?? null));
  const dataRows = headerMode ? grid.slice(1) : grid;
  if (dataRows.length === 0) return base;

  const addedTypes: PropertyTypes = {};
  keys.forEach((key, index) => {
    if (!key || byLower.has(key.toLowerCase()) || types[key]) return;
    addedTypes[key] = { kind: inferPasteKind(dataRows.map((row) => row[index] ?? '')) };
  });
  const nextTypes = { ...types, ...addedTypes };
  const creates: PlannedNoteCreate[] = [];
  const invalid: string[] = [];
  for (const row of dataRows) {
    const values: PropertyPatch = {};
    keys.forEach((key, index) => {
      if (!key) return;
      const kind = byLower.get(key.toLowerCase())?.kind ?? nextTypes[key]?.kind ?? 'text';
      const currency = byLower.get(key.toLowerCase())?.currency ?? nextTypes[key]?.currency ?? 'EUR';
      const parsed = pasteCellValue(kind, row[index] ?? '', currency);
      if (!parsed.ok) {
        invalid.push(`${key}: ${parsed.message}`);
        return;
      }
      values[key] = parsed.value;
    });
    creates.push({ title: (row[0] ?? '').trim() || 'Untitled', values });
  }

  const addedKeys = Object.keys(addedTypes);
  return {
    patches: [],
    creates,
    invalid,
    addedTypes,
    columns: addedKeys.length > 0
      ? [
          ...columns.map(({ key, width }) => ({ key, width })),
          ...addedKeys.map((key) => ({ key, width: TABLE_COLUMN_DEFAULT_WIDTH })),
        ]
      : null,
  };
}

export function optimisticPatchMap(patches: PlannedNotePatch[]): Map<string, PropertyPatch> {
  return new Map(patches.map((patch) => [patch.itemId, patch.after]));
}

export function pasteNotice(invalid: string[]): string | null {
  return invalid.length > 0
    ? `Paste skipped ${invalid.length} invalid cell${invalid.length === 1 ? '' : 's'} — ${invalid[0]}`
    : null;
}
