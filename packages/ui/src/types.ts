import type { ToppingType } from '@waffle/core';

/** What a layout renderer receives per item — presentation-ready, no DB access. */
export interface LibraryItem {
  id: string;
  type: ToppingType;
  title: string;
  subtitle?: string;
  tags?: string[];
  /** note/file/dash: vault-relative path · link: URL (see ADR-003). */
  contentRef?: string | null;
  /** Thumbnail pipeline outputs (ADR-012): all null until generated. */
  thumbRef?: string | null;
  thumbColor?: string | null;
  aspect?: number | null;
}

/** Resolves a topping's thumbnail to a displayable URL (platform-owned). */
export type ThumbLoader = (item: LibraryItem) => Promise<string | null>;

/** Table-layout slice of a folder's persisted view config (docs/12). */
export interface TableViewConfig {
  /** Column order; data keys not listed append at render time. */
  columns?: string[];
  /** Property-column sort ($title = the title column); null/absent = the folder's base sort. */
  colSort?: { key: string; dir: 'asc' | 'desc' } | null;
}
