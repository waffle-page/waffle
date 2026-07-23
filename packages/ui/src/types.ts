import type { ToppingType } from '@waffle/core';

/** What a layout renderer receives per item — presentation-ready, no DB access. */
export interface LibraryItem {
  id: string;
  type: ToppingType;
  title: string;
  subtitle?: string;
  tags?: string[];
  /** note/file/dash: vault-relative path · link: the carrier `.url` file's path (URL lives in the `url` property). Null for non-vault rows. */
  contentRef?: string | null;
  /** Thumbnail pipeline outputs (ADR-012): all null until generated. */
  thumbRef?: string | null;
  thumbColor?: string | null;
  aspect?: number | null;
}

/** Resolves a topping's thumbnail to a displayable URL (platform-owned). */
export type ThumbLoader = (item: LibraryItem) => Promise<string | null>;

/** One contiguous section of a grouped item list: `count` items starting where the previous section ended. */
export interface GroupSection {
  label: string;
  count: number;
}

export const TABLE_COLUMN_DEFAULT_WIDTH = 160;
export const TABLE_COLUMN_MIN_WIDTH = 80;
export const TABLE_COLUMN_MAX_WIDTH = 640;

export function normalizeTableColumnWidth(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return TABLE_COLUMN_DEFAULT_WIDTH;
  return Math.round(Math.min(TABLE_COLUMN_MAX_WIDTH, Math.max(TABLE_COLUMN_MIN_WIDTH, value)));
}

/** Persisted property-column presentation; Title is built-in and fixed-width. */
export interface TableColumnConfig {
  key: string;
  width: number;
}

/** Table-layout slice of a view's persisted config (docs/12). */
export interface TableViewConfig {
  /** Property-column order + width; data keys not listed append at the default width. */
  columns?: TableColumnConfig[];
  /** The VIEW's sort ($updated/$title/property key) — the table renders carets and patches it on header click. */
  sort?: { key: string; dir: 'asc' | 'desc' } | null;
  /** Property key whose values become section headers. */
  groupBy?: string | null;
}
