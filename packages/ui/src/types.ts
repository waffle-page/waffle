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

/** Table-layout slice of a view's persisted config (docs/12). */
export interface TableViewConfig {
  /** Column order; data keys not listed append at render time. */
  columns?: string[];
  /** The VIEW's sort ($updated/$title/property key) — the table renders carets and patches it on header click. */
  sort?: { key: string; dir: 'asc' | 'desc' } | null;
  /** Property key whose values become section headers. */
  groupBy?: string | null;
}
