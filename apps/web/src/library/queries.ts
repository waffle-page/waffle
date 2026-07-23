/**
 * Library data access — named queries, plain SQL (docs/08: SQL is the query
 * language, no ORM). Every function returns presentation-ready shapes.
 */
import { fromEavColumns, type PropertyValue } from '@waffle/core';
import type { LibraryItem } from '@waffle/ui';
import { platform } from '../platform/instance';

export interface FolderNode {
  id: string;
  parentId: string | null;
  name: string;
  count: number;
  /** Vault-relative dir for scanner-owned folders ('' = root); null for non-vault (seed) folders. */
  vaultPath: string | null;
  children: FolderNode[];
}

export async function loadFolderTree(): Promise<FolderNode[]> {
  const rows = await platform.db.exec<{ id: string; parent_id: string | null; name: string; path: string | null; count: number }>(`
    SELECT f.id, f.parent_id, f.name, f.path,
      (SELECT COUNT(*) FROM toppings t WHERE t.folder_id = f.id AND t.deleted_at IS NULL) AS count
    FROM folders f`);
  const nodes = new Map<string, FolderNode>(
    rows.map((r) => [
      r.id,
      {
        id: r.id,
        parentId: r.parent_id,
        name: r.name,
        count: r.count,
        // Scanner folder ids are 'f_root' / 'f_<hash>'; their path column is '/<dir>'.
        vaultPath: r.id === 'f_root' ? '' : r.id.startsWith('f_') && r.path ? r.path.slice(1) : null,
        children: [],
      },
    ]),
  );
  const roots: FolderNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sortRec = (list: FolderNode[]): void => {
    list.sort((a, b) => a.name.localeCompare(b.name));
    list.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

export type SortKey = 'updated' | 'title';

const SORT_SQL: Record<SortKey, string> = {
  updated: 't.updated_at DESC',
  title: 't.title COLLATE NOCASE ASC',
};

/**
 * folderId null ⇒ everything (the whole library, the 20k virtualization case).
 * Deliberately no per-row tag subquery — a correlated GROUP_CONCAT over 20k
 * rows costs seconds; tags join the card via windowed fetch in P0 step 5.
 */
export async function loadItems(folderId: string | null, sort: SortKey): Promise<LibraryItem[]> {
  const where = folderId ? 'AND t.folder_id = ?' : '';
  const rows = await platform.db.exec<{
    id: string;
    type: LibraryItem['type'];
    title: string;
    content_ref: string | null;
    source: string | null;
    folder: string;
    thumb_ref: string | null;
    thumb_color: string | null;
    thumb_aspect: number | null;
  }>(
    `SELECT t.id, t.type, t.title, t.content_ref, t.source, f.name AS folder, t.thumb_ref, t.thumb_color, t.thumb_aspect
     FROM toppings t JOIN folders f ON f.id = t.folder_id
     WHERE t.deleted_at IS NULL ${where}
     ORDER BY ${SORT_SQL[sort]}`,
    folderId ? [folderId] : [],
  );
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    subtitle: r.folder,
    // Only vault-backed content is openable as a file; seed rows carry fake refs.
    contentRef: r.source === 'vault' ? r.content_ref : null,
    thumbRef: r.thumb_ref,
    thumbColor: r.thumb_color,
    aspect: r.thumb_aspect,
  }));
}

export interface FolderViewState {
  layout: string;
  sort: SortKey;
  /** Table layout only (docs/12): column order + property-column sort. */
  columns?: string[];
  colSort?: { key: string; dir: 'asc' | 'desc' } | null;
}

const DEFAULT_VIEW: FolderViewState = { layout: 'masonry', sort: 'updated' };

/** Per-folder persisted view (ADR: folders remember their arrangement). */
export async function loadView(folderId: string | null): Promise<FolderViewState> {
  const rows = await platform.db.exec<{ layout: string; config: string }>(
    `SELECT layout, config FROM views WHERE id = ?`,
    [viewId(folderId)],
  );
  if (rows.length === 0) return DEFAULT_VIEW;
  const config = JSON.parse(rows[0]!.config) as { sort?: SortKey; columns?: string[]; colSort?: FolderViewState['colSort'] };
  return { layout: rows[0]!.layout, sort: config.sort ?? 'updated', columns: config.columns, colSort: config.colSort ?? null };
}

export async function saveView(folderId: string | null, state: FolderViewState): Promise<void> {
  await platform.db.exec(
    `INSERT INTO views (id, folder_id, name, layout, config, kind, is_default, position)
     VALUES (?, ?, 'Default', ?, ?, 'shared', 1, 1)
     ON CONFLICT(id) DO UPDATE SET layout = excluded.layout, config = excluded.config`,
    [viewId(folderId), folderId, state.layout, JSON.stringify({ sort: state.sort, columns: state.columns, colSort: state.colSort ?? undefined })],
  );
}

/**
 * All typed properties for a folder's live toppings (whole library when null).
 * One join, no IN-list: parameter limits don't apply and 20k-row folders stay
 * a single ~ms query. Values rebuild through fromEavColumns.
 */
export async function loadPropertyMap(folderId: string | null): Promise<Map<string, Record<string, PropertyValue>>> {
  const where = folderId ? 'AND t.folder_id = ?' : '';
  const rows = await platform.db.exec<{ topping_id: string; key: string; kind: string; value_text: string | null; value_num: number | null; value_aux: string | null }>(
    `SELECT p.topping_id, p.key, p.kind, p.value_text, p.value_num, p.value_aux
     FROM properties p JOIN toppings t ON t.id = p.topping_id
     WHERE t.deleted_at IS NULL ${where}`,
    folderId ? [folderId] : [],
  );
  const map = new Map<string, Record<string, PropertyValue>>();
  for (const r of rows) {
    const value = fromEavColumns(r.kind, r.value_text, r.value_num, r.value_aux);
    if (!value) continue;
    let props = map.get(r.topping_id);
    if (!props) map.set(r.topping_id, (props = {}));
    props[r.key] = value;
  }
  return map;
}

/** Vault-relative dir for a folder id ('' = root, null = not vault-backed → no file creation). */
export async function vaultDirFor(folderId: string | null): Promise<string | null> {
  if (folderId === null || folderId === 'f_root') return '';
  if (!folderId.startsWith('f_')) return null;
  const rows = await platform.db.exec<{ path: string | null }>(`SELECT path FROM folders WHERE id = ?`, [folderId]);
  return rows[0]?.path ? rows[0].path.slice(1) : null;
}

const viewId = (folderId: string | null): string => `v_${folderId ?? 'root'}`;
