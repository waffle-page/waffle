/**
 * Obsidian importer (P1): vault-wide property types (`.obsidian/types.json`)
 * merge into `.waffle/properties.json`, and Bases (`*.base` YAML) become saved
 * views on today's engine. Two rules keep it honest:
 *  - DRY-RUN FIRST: `scanImport` builds a full plan with per-item skip reasons;
 *    nothing writes until `applyImport`.
 *  - Existing Waffle declarations WIN over imported types (they were deliberate);
 *    re-imports are idempotent (views matched by name are skipped as existing).
 * The Bases filter language is imported as a SUBSET — plain comparisons,
 * hasTag/contains, and/or lists. Everything else is skipped with its reason in
 * the report, never silently dropped.
 */
import { parse as parseYaml } from 'yaml';
import { loadPropertyTypes, savePropertyTypes, type PropertyTypeDecl, type PropertyTypes, type SqlDriver, type VaultFs, type FilterNode } from '@waffle/core';
import { createView, listViews, saveViewState, type ViewCfg } from '../library/queries';

const OBSIDIAN_KIND: Record<string, PropertyTypeDecl['kind'] | undefined> = {
  text: 'text',
  number: 'number',
  checkbox: 'checkbox',
  date: 'date',
  datetime: 'date',
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CMP: Record<string, 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte'> = { '==': 'eq', '!=': 'ne', '<': 'lt', '<=': 'lte', '>': 'gt', '>=': 'gte' };

export interface PlannedView {
  name: string;
  layout: string;
  cfg: ViewCfg;
  notes: string[];
  exists: boolean;
}

export interface PlannedBase {
  path: string;
  folderId: string;
  folderName: string;
  views: PlannedView[];
  skipped: string[];
}

export interface ImportPlan {
  typesFileFound: boolean;
  typesNew: PropertyTypes;
  typesKept: string[];
  typesSkipped: Array<{ key: string; reason: string }>;
  bases: PlannedBase[];
}

export async function scanImport(fs: VaultFs, db: SqlDriver): Promise<ImportPlan> {
  const existing = await loadPropertyTypes(fs);
  const plan: ImportPlan = { typesFileFound: false, typesNew: {}, typesKept: [], typesSkipped: [], bases: [] };

  // ── .obsidian/types.json ──
  try {
    const raw = JSON.parse(new TextDecoder().decode(await fs.read('.obsidian/types.json'))) as { types?: Record<string, string> };
    plan.typesFileFound = true;
    for (const [key, obsidianType] of Object.entries(raw.types ?? {})) {
      if (key === 'tags' || key === 'aliases' || key === 'cssclasses') continue; // Obsidian-internal keys
      if (existing[key]) {
        plan.typesKept.push(key);
        continue;
      }
      const kind = OBSIDIAN_KIND[obsidianType];
      if (kind) plan.typesNew[key] = { kind };
      else plan.typesSkipped.push({ key, reason: `Obsidian type "${obsidianType}" has no Waffle kind yet` });
    }
  } catch {
    // no types.json — fine, bases may still exist
  }

  // ── *.base files (already indexed as file toppings by the scanner) ──
  const baseRows = await db.exec<{ content_ref: string; folder_id: string; folder_name: string }>(
    `SELECT t.content_ref, t.folder_id, f.name AS folder_name FROM toppings t JOIN folders f ON f.id = t.folder_id
     WHERE t.source = 'vault' AND t.deleted_at IS NULL AND t.content_ref LIKE '%.base' ORDER BY t.content_ref`,
  );
  const kinds = { ...existing, ...plan.typesNew };

  for (const row of baseRows) {
    const planned: PlannedBase = { path: row.content_ref, folderId: row.folder_id, folderName: row.folder_name === '/' ? 'Vault' : row.folder_name, views: [], skipped: [] };
    plan.bases.push(planned);
    let doc: BaseFile;
    try {
      doc = (parseYaml(new TextDecoder().decode(await fs.read(row.content_ref))) ?? {}) as BaseFile;
    } catch (e) {
      planned.skipped.push(`unparseable YAML (${e instanceof Error ? e.message : 'error'})`);
      continue;
    }
    if (doc.formulas) planned.skipped.push('formulas are not imported');

    const baseFilter = parseFilterBlock(doc.filters, kinds, planned.skipped);
    const folderOverride = extractInFolder(doc.filters);
    if (folderOverride) {
      const target = await db.exec<{ id: string; name: string }>(`SELECT id, name FROM folders WHERE name = ? LIMIT 1`, [folderOverride]);
      if (target[0]) {
        planned.folderId = target[0].id;
        planned.folderName = target[0].name;
      } else planned.skipped.push(`file.inFolder("${folderOverride}"): no such folder — using the .base file's own folder`);
    }

    const existingViews = await listViews(planned.folderId);
    for (const v of doc.views ?? []) {
      const view = planViewImport(v, baseFilter, kinds);
      view.exists = existingViews.some((e) => e.name === view.name);
      planned.views.push(view);
    }
    if (!doc.views?.length) planned.skipped.push('no views declared');
  }

  return plan;
}

export async function applyImport(fs: VaultFs, plan: ImportPlan): Promise<{ types: number; views: number }> {
  let types = 0;
  if (Object.keys(plan.typesNew).length > 0) {
    const existing = await loadPropertyTypes(fs);
    await savePropertyTypes(fs, { ...plan.typesNew, ...existing }); // existing wins on any collision
    types = Object.keys(plan.typesNew).length;
  }
  let views = 0;
  for (const base of plan.bases) {
    for (const v of base.views) {
      if (v.exists) continue;
      const created = await createView(base.folderId, v.name);
      await saveViewState(created.id, v.layout, v.cfg);
      views++;
    }
  }
  return { types, views };
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

function planViewImport(v: BaseView, baseFilter: FilterNode | null, kinds: PropertyTypes): PlannedView {
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
  return { name: v.name?.trim() || 'Imported view', layout, cfg, notes, exists: false };
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
