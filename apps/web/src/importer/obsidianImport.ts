/**
 * Obsidian config sync: `.obsidian/types.json` and `*.base` files are vault
 * files like any other, so their derived state (property declarations, saved
 * views) keeps itself in sync at scan time — no import button, no staleness.
 *
 * Ownership (ADR-018's field-ownership rule, applied to views): a view derived
 * from a base carries `cfg.origin = {base, view, spec}` — the exact spec last
 * imported. While the view still matches `spec` it is sync-owned: it auto-
 * updates when the base changes and auto-removes when its base view vanishes.
 * The moment it's edited in Waffle it diverges and sync must NEVER touch it
 * again (reported, not clobbered). Types merge add-only; existing Waffle
 * declarations always win. The Bases filter language imports as a SUBSET —
 * everything unsupported is named in the report, never silently dropped.
 */
import { parse as parseYaml } from 'yaml';
import { loadPropertyTypes, savePropertyTypes, type PropertyTypeDecl, type PropertyTypes, type SqlDriver, type VaultFs, type FilterNode } from '@waffle/core';
import { createView, deleteView, listViews, saveViewState, type FolderView, type ViewCfg } from '../library/queries';

const OBSIDIAN_KIND: Record<string, PropertyTypeDecl['kind'] | undefined> = {
  text: 'text',
  number: 'number',
  checkbox: 'checkbox',
  date: 'date',
  datetime: 'date',
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CMP: Record<string, 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte'> = { '==': 'eq', '!=': 'ne', '<': 'lt', '<=': 'lte', '>': 'gt', '>=': 'gte' };

export interface SyncResult {
  found: { typesFile: boolean; baseFiles: number };
  typesAdded: string[];
  typesSkipped: Array<{ key: string; reason: string }>;
  viewsCreated: Array<{ folder: string; name: string }>;
  viewsUpdated: Array<{ folder: string; name: string }>;
  /** Base changed but the Waffle view was edited here — user-owned, left alone. */
  viewsDiverged: Array<{ folder: string; name: string }>;
  viewsRemoved: Array<{ folder: string; name: string }>;
  /** Parse compromises, prefixed with their source file. */
  notes: string[];
}

/** Run after every vault scan (Library.syncVault). Idempotent; a no-op vault returns an empty result. */
export async function syncObsidian(fs: VaultFs, db: SqlDriver): Promise<SyncResult> {
  const result: SyncResult = {
    found: { typesFile: false, baseFiles: 0 },
    typesAdded: [], typesSkipped: [], viewsCreated: [], viewsUpdated: [], viewsDiverged: [], viewsRemoved: [], notes: [],
  };
  const existing = await loadPropertyTypes(fs);

  // ── types.json: add-only merge, existing declarations win ──
  try {
    const raw = JSON.parse(new TextDecoder().decode(await fs.read('.obsidian/types.json'))) as { types?: Record<string, string> };
    result.found.typesFile = true;
    const added: PropertyTypes = {};
    for (const [key, obsidianType] of Object.entries(raw.types ?? {})) {
      if (key === 'tags' || key === 'aliases' || key === 'cssclasses' || existing[key]) continue;
      const kind = OBSIDIAN_KIND[obsidianType];
      if (kind) added[key] = { kind };
      else result.typesSkipped.push({ key, reason: `Obsidian type "${obsidianType}" has no Waffle kind yet` });
    }
    if (Object.keys(added).length > 0) {
      await savePropertyTypes(fs, { ...added, ...existing });
      result.typesAdded = Object.keys(added);
    }
  } catch {
    // no types.json — fine
  }
  // ── *.base files (already indexed as file toppings by the scanner) ──
  const baseRows = await db.exec<{ content_ref: string; folder_id: string; folder_name: string }>(
    `SELECT t.content_ref, t.folder_id, f.name AS folder_name FROM toppings t JOIN folders f ON f.id = t.folder_id
     WHERE t.source = 'vault' AND t.deleted_at IS NULL AND t.content_ref LIKE '%.base' ORDER BY t.content_ref`,
  );
  result.found.baseFiles = baseRows.length;
  const mergedKinds = await loadPropertyTypes(fs); // includes the just-added keys

  interface Desired { folderId: string; folderName: string; base: string; view: string; name: string; layout: string; cfg: ViewCfg; spec: string }
  const desired = new Map<string, Desired>();

  for (const row of baseRows) {
    let doc: BaseFile;
    try {
      doc = (parseYaml(new TextDecoder().decode(await fs.read(row.content_ref))) ?? {}) as BaseFile;
    } catch (e) {
      result.notes.push(`${row.content_ref}: unparseable YAML (${e instanceof Error ? e.message : 'error'})`);
      continue;
    }
    const fileNotes: string[] = [];
    if (doc.formulas) fileNotes.push('formulas are not imported');

    const baseFilter = parseFilterBlock(doc.filters, mergedKinds, fileNotes);
    let folderId = row.folder_id;
    let folderName = row.folder_name === '/' ? 'Vault' : row.folder_name;
    const folderOverride = extractInFolder(doc.filters);
    if (folderOverride) {
      const target = await db.exec<{ id: string; name: string }>(`SELECT id, name FROM folders WHERE name = ? LIMIT 1`, [folderOverride]);
      if (target[0]) {
        folderId = target[0].id;
        folderName = target[0].name;
      } else fileNotes.push(`file.inFolder("${folderOverride}"): no such folder — using the .base file's own folder`);
    }

    for (const v of doc.views ?? []) {
      const planned = planViewImport(v, baseFilter, mergedKinds);
      const spec = specOf(planned.layout, planned.cfg);
      const viewName = planned.name;
      desired.set(`${row.content_ref}#${viewName}`, { folderId, folderName, base: row.content_ref, view: viewName, name: viewName, layout: planned.layout, cfg: planned.cfg, spec });
      for (const n of planned.notes) fileNotes.push(`${viewName}: ${n}`);
    }
    for (const n of fileNotes) result.notes.push(`${row.content_ref}: ${n}`);
  }

  // ── Reconcile derived views per folder ──
  const folderIds = new Set<string | null>([...desired.values()].map((d) => d.folderId));
  // Also folders that HOLD derived views whose base vanished: sweep every folder with views.
  const allViewFolders = await db.exec<{ folder_id: string | null }>(`SELECT DISTINCT folder_id FROM views`);
  for (const f of allViewFolders) folderIds.add(f.folder_id);

  // One exclusive transaction: concurrent syncs (StrictMode double-mount, a
  // future watcher) serialize here, so the second pass SEES the first's writes
  // and skips instead of duplicating.
  await db.transaction(async () => {
  for (const folderId of folderIds) {
    const views = await listViews(folderId);
    const here = [...desired.values()].filter((d) => d.folderId === folderId);

    for (const d of here) {
      const matches = views.filter((v) => v.cfg.origin?.base === d.base && v.cfg.origin.view === d.view);
      // Self-heal duplicates (e.g. from a pre-transaction race): keep the first,
      // remove untouched extras.
      for (const extra of matches.slice(1)) {
        if (specOf(extra.layout, extra.cfg) === extra.cfg.origin!.spec) {
          await deleteView(extra.id);
          result.viewsRemoved.push({ folder: d.base, name: `${extra.name} (duplicate)` });
        }
      }
      const match = matches[0];
      if (!match) {
        if (views.some((v) => !v.cfg.origin && v.name === d.name)) {
          result.notes.push(`${d.base}: view "${d.name}" skipped — a Waffle view with that name already exists in ${d.folderName}`);
          continue;
        }
        const created = await createView(folderId, d.name);
        await saveViewState(created.id, d.layout, { ...d.cfg, origin: { base: d.base, view: d.view, spec: d.spec } });
        result.viewsCreated.push({ folder: d.folderName, name: d.name });
        continue;
      }
      const untouched = specOf(match.layout, match.cfg) === match.cfg.origin!.spec;
      if (!untouched) {
        if (match.cfg.origin!.spec !== d.spec) result.viewsDiverged.push({ folder: d.folderName, name: match.name });
        continue;
      }
      if (match.cfg.origin!.spec !== d.spec) {
        // Waffle-side fields (groupBy) survive base-driven updates.
        await saveViewState(match.id, d.layout, { ...d.cfg, groupBy: match.cfg.groupBy, origin: { base: d.base, view: d.view, spec: d.spec } });
        result.viewsUpdated.push({ folder: d.folderName, name: match.name });
      }
    }

    // Orphans: derived here, base/view gone, still untouched → remove.
    for (const v of views) {
      if (!v.cfg.origin) continue;
      if (desired.has(`${v.cfg.origin.base}#${v.cfg.origin.view}`)) continue;
      if (specOf(v.layout, v.cfg) === v.cfg.origin.spec) {
        await deleteView(v.id);
        result.viewsRemoved.push({ folder: v.cfg.origin.base, name: v.name });
      }
    }
  }
  });

  return result;
}

/**
 * Canonical spec of a view's SYNCED state — origin excluded, key order fixed by
 * construction. groupBy is deliberately absent: Bases can't express it, so it
 * is a Waffle-side field that neither marks divergence nor writes back
 * (ADR-018 field ownership, per field).
 */
export function specOf(layout: string, cfg: ViewCfg): string {
  return JSON.stringify({ layout, sort: cfg.sort, filters: cfg.filters, columns: cfg.columns ?? null });
}

/**
 * Re-derive one view from a base file exactly as the sync would import it —
 * the write-back path uses this to canonicalize after patching the file, so
 * origin.spec always equals what the next sync computes (anti-flap).
 */
export async function reimportView(
  fs: VaultFs,
  basePath: string,
  viewName: string,
): Promise<{ layout: string; cfg: ViewCfg; baseChildren: FilterNode[] } | null> {
  const kinds = await loadPropertyTypes(fs);
  let doc: BaseFile;
  try {
    doc = (parseYaml(new TextDecoder().decode(await fs.read(basePath))) ?? {}) as BaseFile;
  } catch {
    return null;
  }
  const skips: string[] = [];
  const baseFilter = parseFilterBlock(doc.filters, kinds, skips);
  const baseChildren = baseFilter ? (baseFilter.op === 'and' ? baseFilter.children : [baseFilter]) : [];
  const v = (doc.views ?? []).find((view) => (view.name?.trim() || 'Imported view') === viewName);
  if (!v) return null;
  const planned = planViewImport(v, baseFilter, kinds);
  return { layout: planned.layout, cfg: planned.cfg, baseChildren };
}

// ── Bases parsing (the documented subset) ────────────────────────────────────

interface BaseView {
  type?: string;
  name?: string;
  filters?: unknown;
  order?: string[];
  sort?: Array<{ property?: string; direction?: string }>;
  limit?: number;
  columnSize?: Record<string, number>;
}
interface BaseFile {
  filters?: unknown;
  formulas?: Record<string, string>;
  properties?: Record<string, unknown>;
  views?: BaseView[];
}

function planViewImport(v: BaseView, baseFilter: FilterNode | null, kinds: PropertyTypes): { name: string; layout: string; cfg: ViewCfg; notes: string[] } {
  const notes: string[] = [];
  const layout = v.type === 'table' ? 'table' : v.type === 'cards' ? 'grid' : 'masonry';
  if (v.type && v.type !== 'table' && v.type !== 'cards') notes.push(`view type "${v.type}" → masonry`);
  if (v.limit) notes.push(`limit ${v.limit} ignored (views are unbounded here)`);
  if (v.columnSize) notes.push('columnSize ignored (column widths arrive with table slice B)');

  const own = parseFilterBlock(v.filters, kinds, notes);
  const children = [...(baseFilter?.op === 'and' ? baseFilter.children : baseFilter ? [baseFilter] : []), ...(own?.op === 'and' ? own.children : own ? [own] : [])];
  const filters: FilterNode | null = children.length ? { op: 'and', children } : null;

  const columns = (v.order ?? []).filter((key) => {
    if (key === 'file.name') return false; // the built-in title column
    if (key.startsWith('file.')) {
      notes.push(`column ${key} skipped (no such built-in yet)`);
      return false;
    }
    return true;
  }).map(stripNote);

  let sort: ViewCfg['sort'] = { key: '$updated', dir: 'desc' };
  const first = v.sort?.[0];
  if (first?.property) {
    const key = first.property === 'file.name' ? '$title' : first.property.startsWith('file.') ? null : stripNote(first.property);
    if (key) sort = { key, dir: first.direction?.toUpperCase() === 'DESC' ? 'desc' : 'asc' };
    else notes.push(`sort by ${first.property} unsupported — recency used`);
  }
  if ((v.sort?.length ?? 0) > 1) notes.push('only the first sort level imports');

  const cfg: ViewCfg = { sort, filters, groupBy: null };
  if (columns.length) cfg.columns = columns;
  return { name: v.name?.trim() || 'Imported view', layout, cfg, notes };
}

/** Obsidian `and:`/`or:` blocks of expression strings → FilterNode (skips reported). */
function parseFilterBlock(block: unknown, kinds: PropertyTypes, skips: string[]): FilterNode | null {
  if (!block) return null;
  if (typeof block === 'string') return parseExpr(block, kinds, skips);
  if (typeof block !== 'object') return null;
  const rec = block as Record<string, unknown>;
  for (const op of ['and', 'or'] as const) {
    if (Array.isArray(rec[op])) {
      const children = (rec[op] as unknown[]).map((c) => parseFilterBlock(c, kinds, skips)).filter((c): c is FilterNode => c !== null);
      return children.length ? { op, children } : null;
    }
  }
  if (rec.not) {
    skips.push('`not:` blocks are not supported yet');
    return null;
  }
  return null;
}

function parseExpr(src: string, kinds: PropertyTypes, skips: string[]): FilterNode | null {
  const s = src.trim();
  if (s.startsWith('!')) {
    skips.push(`negated filter skipped: ${s}`);
    return null;
  }
  if (/^file\.inFolder\(/.test(s) || /^file\.ext\s*==/.test(s)) return null; // handled/implicit elsewhere
  let m = /^file\.hasTag\(\s*"([^"]+)"\s*\)$/.exec(s);
  if (m) return { op: 'cmp', key: '$tag', cmp: 'tagged', value: m[1]! };
  m = /^([\w.]+)\.contains\(\s*"([^"]+)"\s*\)$/.exec(s);
  if (m) return { op: 'cmp', key: propKey(m[1]!), cmp: 'contains', value: m[2]! };
  m = /^([\w.]+)\s*(==|!=|>=|<=|>|<)\s*(.+)$/.exec(s);
  if (m) {
    const rawKey = m[1]!;
    if (rawKey.startsWith('file.') && rawKey !== 'file.name') {
      skips.push(`filter on ${rawKey} skipped (no such built-in yet)`);
      return null;
    }
    const key = rawKey === 'file.name' ? '$title' : propKey(rawKey);
    return { op: 'cmp', key, cmp: CMP[m[2]!]!, value: literal(m[3]!, kinds[key]?.kind) };
  }
  skips.push(`unsupported filter skipped: ${s}`);
  return null;
}

const stripNote = (key: string): string => (key.startsWith('note.') ? key.slice(5) : key);
const propKey = stripNote;

/** Quoted → string · true/false → boolean · numeric → number · ISO date on a date key → ms (matches value_num). */
function literal(raw: string, kind: PropertyTypeDecl['kind'] | undefined): string | number | boolean {
  const s = raw.trim();
  const quoted = /^"(.*)"$/.exec(s) ?? /^'(.*)'$/.exec(s);
  if (quoted) {
    const text = quoted[1]!;
    if (kind === 'date' && ISO_DATE.test(text)) return Date.parse(text);
    return text;
  }
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (!Number.isNaN(Number(s))) return Number(s);
  if (kind === 'date' && ISO_DATE.test(s)) return Date.parse(s);
  return s;
}

function extractInFolder(block: unknown): string | null {
  if (typeof block === 'string') return /^file\.inFolder\(\s*"([^"]+)"\s*\)$/.exec(block.trim())?.[1] ?? null;
  if (block && typeof block === 'object') {
    for (const value of Object.values(block as Record<string, unknown>)) {
      if (Array.isArray(value)) for (const c of value) {
        const hit = extractInFolder(c);
        if (hit) return hit;
      }
    }
  }
  return null;
}
