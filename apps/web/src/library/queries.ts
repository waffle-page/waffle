/**
 * Library data access — named queries, plain SQL (docs/08: SQL is the query
 * language, no ORM). Every function returns presentation-ready shapes.
 */
import { fromEavColumns, type FilterNode, type PropertyValue } from '@waffle/core';
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

// ── Views (ADR-006/-014: folders hold many named views; one is the default) ──

/** Sort key: '$updated' | '$title' | a frontmatter property key ($-prefix reserved for built-ins). */
export interface ViewSort {
  key: string;
  dir: 'asc' | 'desc';
}

export interface ViewCfg {
  sort: ViewSort;
  /** Flat AND of cmp nodes in v1 UI; stored as the core FilterNode for forward-compat. */
  filters: FilterNode | null;
  groupBy: string | null;
  /** Table layout: column order; data keys not listed append at render time. */
  columns?: string[];
}

export interface FolderView {
  id: string;
  name: string;
  layout: string;
  isDefault: boolean;
  position: number;
  cfg: ViewCfg;
}

const DEFAULT_CFG: ViewCfg = { sort: { key: '$updated', dir: 'desc' }, filters: null, groupBy: null };

/** Configs written before the view manager stored sort as 'updated'|'title' + a separate colSort. */
function parseCfg(json: string): ViewCfg {
  const raw = JSON.parse(json) as { sort?: ViewSort | 'updated' | 'title'; colSort?: ViewSort | null; filters?: FilterNode | null; groupBy?: string | null; columns?: string[] };
  let sort: ViewSort =
    raw.sort === 'title' ? { key: '$title', dir: 'asc' }
    : raw.sort && typeof raw.sort === 'object' ? raw.sort
    : { key: '$updated', dir: 'desc' };
  if (raw.colSort) sort = raw.colSort;
  const cfg: ViewCfg = { sort, filters: raw.filters ?? null, groupBy: raw.groupBy ?? null };
  if (raw.columns) cfg.columns = raw.columns;
  return cfg;
}

/** All views of a folder, creating the Default on first touch (id keeps the pre-manager scheme). */
export async function listViews(folderId: string | null): Promise<FolderView[]> {
  const rows = await platform.db.exec<{ id: string; name: string; layout: string; config: string; is_default: number; position: number }>(
    `SELECT id, name, layout, config, is_default, position FROM views WHERE folder_id IS ? ORDER BY position, name`,
    [folderId],
  );
  if (rows.length === 0) {
    const view: FolderView = { id: `v_${folderId ?? 'root'}`, name: 'Default', layout: 'masonry', isDefault: true, position: 1, cfg: DEFAULT_CFG };
    await platform.db.exec(
      `INSERT OR IGNORE INTO views (id, folder_id, name, layout, config, kind, is_default, position) VALUES (?,?,?,?,?,'shared',1,1)`,
      [view.id, folderId, view.name, view.layout, JSON.stringify(view.cfg)],
    );
    return [view];
  }
  const views = rows.map((r) => ({ id: r.id, name: r.name, layout: r.layout, isDefault: r.is_default === 1, position: r.position, cfg: parseCfg(r.config) }));
  if (!views.some((v) => v.isDefault)) views[0]!.isDefault = true;
  return views;
}

export async function createView(folderId: string | null, name: string): Promise<FolderView> {
  const rows = await platform.db.exec<{ maxpos: number | null }>(`SELECT MAX(position) AS maxpos FROM views WHERE folder_id IS ?`, [folderId]);
  const view: FolderView = { id: `v_${crypto.randomUUID()}`, name, layout: 'masonry', isDefault: false, position: (rows[0]?.maxpos ?? 0) + 1, cfg: DEFAULT_CFG };
  await platform.db.exec(
    `INSERT INTO views (id, folder_id, name, layout, config, kind, is_default, position) VALUES (?,?,?,?,?,'shared',0,?)`,
    [view.id, folderId, view.name, view.layout, JSON.stringify(view.cfg), view.position],
  );
  return view;
}

export async function renameView(id: string, name: string): Promise<void> {
  await platform.db.exec(`UPDATE views SET name = ? WHERE id = ?`, [name, id]);
}

export async function deleteView(id: string): Promise<void> {
  await platform.db.exec(`DELETE FROM view_order WHERE view_id = ?`, [id]);
  await platform.db.exec(`DELETE FROM views WHERE id = ?`, [id]);
}

export async function setDefaultView(folderId: string | null, id: string): Promise<void> {
  await platform.db.exec(`UPDATE views SET is_default = 0 WHERE folder_id IS ?`, [folderId]);
  await platform.db.exec(`UPDATE views SET is_default = 1 WHERE id = ?`, [id]);
}

export async function saveViewState(id: string, layout: string, cfg: ViewCfg): Promise<void> {
  await platform.db.exec(`UPDATE views SET layout = ?, config = ? WHERE id = ?`, [layout, JSON.stringify(cfg), id]);
}

// ── Items query (one path for every layout: filters + sort compile to SQL) ──

const CMP_SQL = { eq: '=', ne: '!=', lt: '<', lte: '<=', gt: '>', gte: '>=' } as const;

/**
 * FilterNode → WHERE fragment. Property cmps use EXISTS over the EAV rows —
 * numeric when the value is number/boolean (value_num carries the canonical
 * unit per kind, incl. Date.parse ms), text otherwise. A row lacking the key
 * matches no cmp, including `ne` — deliberate: filters select among rows that
 * HAVE the property.
 */
function filterSql(node: FilterNode, params: unknown[]): string {
  if (node.op !== 'cmp') {
    if (node.children.length === 0) return '1';
    return '(' + node.children.map((c) => filterSql(c, params)).join(` ${node.op.toUpperCase()} `) + ')';
  }
  if (node.key === '$title') {
    params.push(node.cmp === 'contains' ? `%${String(node.value)}%` : String(node.value));
    return node.cmp === 'contains' ? `t.title LIKE ?` : `t.title ${CMP_SQL[node.cmp as keyof typeof CMP_SQL] ?? '='} ?`;
  }
  if (node.key === '$type') {
    params.push(String(node.value));
    return `t.type = ?`;
  }
  if (node.cmp === 'tagged') {
    params.push(String(node.value).toLowerCase());
    return `EXISTS (SELECT 1 FROM topping_tags tt JOIN tags g ON g.id = tt.tag_id WHERE tt.topping_id = t.id AND g.name = ?)`;
  }
  const numeric = typeof node.value === 'number' || typeof node.value === 'boolean';
  if (numeric) {
    params.push(node.key, typeof node.value === 'boolean' ? (node.value ? 1 : 0) : node.value);
    return `EXISTS (SELECT 1 FROM properties p WHERE p.topping_id = t.id AND p.key = ? AND p.value_num ${CMP_SQL[node.cmp as keyof typeof CMP_SQL] ?? '='} ?)`;
  }
  if (node.cmp === 'contains') {
    params.push(node.key, `%${String(node.value)}%`);
    return `EXISTS (SELECT 1 FROM properties p WHERE p.topping_id = t.id AND p.key = ? AND p.value_text LIKE ?)`;
  }
  params.push(node.key, String(node.value));
  return `EXISTS (SELECT 1 FROM properties p WHERE p.topping_id = t.id AND p.key = ? AND p.value_text ${CMP_SQL[node.cmp as keyof typeof CMP_SQL] ?? '='} ?)`;
}

/**
 * folderId null ⇒ everything (the whole library, the 20k virtualization case).
 * Deliberately no per-row tag subquery — a correlated GROUP_CONCAT over 20k
 * rows costs seconds; tags join the card via windowed fetch in P0 step 5.
 */
export async function loadItems(folderId: string | null, cfg: ViewCfg): Promise<LibraryItem[]> {
  const dir = cfg.sort.dir === 'asc' ? 'ASC' : 'DESC';
  const params: unknown[] = [];
  let join = '';
  let order: string;
  if (cfg.sort.key === '$updated') order = `t.updated_at ${dir}`;
  else if (cfg.sort.key === '$title') order = `t.title COLLATE NOCASE ${dir}`;
  else {
    join = `LEFT JOIN properties s ON s.topping_id = t.id AND s.key = ?`;
    params.push(cfg.sort.key);
    // Rows without the property sink to the end regardless of direction.
    order = `(s.topping_id IS NULL) ASC, s.value_num ${dir}, s.value_text COLLATE NOCASE ${dir}`;
  }
  let where = '';
  if (folderId) {
    where += ' AND t.folder_id = ?';
    params.push(folderId);
  }
  if (cfg.filters) where += ` AND ${filterSql(cfg.filters, params)}`;

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
     FROM toppings t JOIN folders f ON f.id = t.folder_id ${join}
     WHERE t.deleted_at IS NULL ${where}
     ORDER BY ${order}`,
    params,
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

export interface PropertyField {
  key: string;
  kind: PropertyValue['kind'];
}

/** Distinct property keys in a folder with their modal kind — feeds filter/group/sort pickers. */
export async function loadPropertyKeys(folderId: string | null): Promise<PropertyField[]> {
  const where = folderId ? 'AND t.folder_id = ?' : '';
  const rows = await platform.db.exec<{ key: string; kind: PropertyValue['kind']; n: number }>(
    `SELECT p.key, p.kind, COUNT(*) AS n FROM properties p JOIN toppings t ON t.id = p.topping_id
     WHERE t.deleted_at IS NULL ${where} GROUP BY p.key, p.kind ORDER BY p.key, n DESC`,
    folderId ? [folderId] : [],
  );
  const fields: PropertyField[] = [];
  for (const r of rows) if (fields[fields.length - 1]?.key !== r.key) fields.push({ key: r.key, kind: r.kind });
  return fields;
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
