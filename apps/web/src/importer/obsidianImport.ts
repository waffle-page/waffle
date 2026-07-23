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
import { normalizeTableColumnWidth } from '@waffle/ui';
import { createView, deleteView, inFolderFilter, listViews, moveViewToFolder, saveViewState, type FolderView, type ViewCfg } from '../library/queries';
import { basesKeyToWaffle, parseFilterBlock, parseGroupBy, stripNote } from './basesCompatibility';

const OBSIDIAN_KIND: Record<string, PropertyTypeDecl['kind'] | undefined> = {
  text: 'text',
  number: 'number',
  checkbox: 'checkbox',
  date: 'date',
  datetime: 'date',
  multitext: 'list',
};

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
  const baseRows = await db.exec<{ content_ref: string }>(
    `SELECT t.content_ref FROM toppings t
     WHERE t.source = 'vault' AND t.deleted_at IS NULL AND t.content_ref LIKE '%.base' ORDER BY t.content_ref`,
  );
  result.found.baseFiles = baseRows.length;
  const mergedKinds = await loadPropertyTypes(fs); // includes the just-added keys

  interface Desired { folderId: string | null; folderName: string; base: string; view: string; name: string; layout: string; cfg: ViewCfg; spec: string }
  const desired = new Map<string, Desired>();
  const parsedBases = new Set<string>();
  const seenOrigins = new Set<string>();
  const presentBases = new Set(baseRows.map((row) => row.content_ref));
  const folderScopes = new Map<string, { id: string; name: string } | null>();
  const resolveFolderScope = async (scope: string): Promise<{ id: string; name: string } | null> => {
    const normalized = scope.replace(/^\/+|\/+$/g, '');
    if (folderScopes.has(normalized)) return folderScopes.get(normalized) ?? null;
    const target = await db.exec<{ id: string; name: string }>(`SELECT id, name FROM folders WHERE path = ? LIMIT 1`, ['/' + normalized]);
    const resolved = target[0] ?? null;
    folderScopes.set(normalized, resolved);
    return resolved;
  };

  for (const row of baseRows) {
    let doc: BaseFile;
    try {
      doc = (parseYaml(new TextDecoder().decode(await fs.read(row.content_ref))) ?? {}) as BaseFile;
    } catch (e) {
      result.notes.push(`${row.content_ref}: unparseable YAML (${e instanceof Error ? e.message : 'error'})`);
      continue;
    }
    parsedBases.add(row.content_ref);
    const fileNotes: string[] = [];
    if (doc.formulas) fileNotes.push('formulas are not imported');
    if (doc.views !== undefined && !Array.isArray(doc.views)) {
      result.notes.push(`${row.content_ref}: views is not a list — existing projections frozen`);
      parsedBases.delete(row.content_ref);
      continue;
    }

    const baseFilter = parseFilterBlock(doc.filters, mergedKinds, fileNotes);
    // Bases are vault-global unless a positive file.inFolder predicate narrows
    // them. Waffle stores that global projection under Everything.
    let folderId: string | null = null;
    let folderName = 'Everything';
    const folderOverride = inFolderFilter(baseFilter.node);
    if (folderOverride) {
      const target = await resolveFolderScope(folderOverride);
      if (target) {
        folderId = target.id;
        folderName = target.name;
      } else fileNotes.push(`file.inFolder("${folderOverride}"): no such folder — projection stays under Everything`);
    }

    for (const rawView of doc.views ?? []) {
      if (!rawView || typeof rawView !== 'object' || Array.isArray(rawView)) {
        fileNotes.push('non-object view entry skipped');
        parsedBases.delete(row.content_ref);
        continue;
      }
      const v = rawView as BaseView;
      const viewName = typeof v.name === 'string' && v.name.trim() ? v.name.trim() : 'Imported view';
      const originKey = `${row.content_ref}#${viewName}`;
      if (seenOrigins.has(originKey)) {
        desired.delete(originKey);
        fileNotes.push(`${viewName}: duplicate view name — projections frozen`);
        continue;
      }
      seenOrigins.add(originKey);
      if (!baseFilter.supported) {
        fileNotes.push(`${viewName}: shared filters are unsupported — view frozen`);
        continue;
      }
      const planned = planViewImport(v, baseFilter.node, mergedKinds);
      if (!planned.supported) {
        for (const note of planned.notes) fileNotes.push(`${viewName}: ${note}`);
        fileNotes.push(`${viewName}: unsupported state — view frozen`);
        continue;
      }
      const spec = specOf(planned.layout, planned.cfg);
      let viewFolderId = folderId;
      let viewFolderName = folderName;
      const viewScope = inFolderFilter(planned.cfg.filters);
      if (viewScope && viewScope !== folderOverride) {
        const target = await resolveFolderScope(viewScope);
        if (target) {
          viewFolderId = target.id;
          viewFolderName = target.name;
        } else {
          fileNotes.push(`${viewName}: file.inFolder("${viewScope}") has no matching folder — projection stays under Everything`);
          viewFolderId = null;
          viewFolderName = 'Everything';
        }
      }
      desired.set(originKey, { folderId: viewFolderId, folderName: viewFolderName, base: row.content_ref, view: viewName, name: viewName, layout: planned.layout, cfg: planned.cfg, spec });
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
    const viewsByFolder = new Map<string | null, FolderView[]>();
    for (const folderId of folderIds) viewsByFolder.set(folderId, await listViews(folderId));
    const allViews = [...viewsByFolder.values()].flat();
    for (const folderId of folderIds) {
      const views = viewsByFolder.get(folderId) ?? [];
      const here = [...desired.values()].filter((d) => d.folderId === folderId);

      for (const d of here) {
        const matches = allViews.filter((v) => v.cfg.origin?.base === d.base && v.cfg.origin.view === d.view);
        // Self-heal duplicates (e.g. from a pre-transaction race): keep the
        // first and remove untouched extras.
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
        const currentFolder = [...viewsByFolder.entries()].find(([, candidates]) => candidates.some((view) => view.id === match.id))?.[0] ?? null;
        if (currentFolder !== folderId) {
          if (views.some((view) => view.id !== match.id && !view.cfg.origin && view.name === d.name)) {
            result.notes.push(`${d.base}: view "${d.name}" cannot move to ${d.folderName} — a Waffle view already has that name`);
            continue;
          }
          await moveViewToFolder(match.id, folderId);
        }
        if (currentFolder !== folderId || match.cfg.origin!.spec !== d.spec) {
          await saveViewState(match.id, d.layout, { ...d.cfg, origin: { base: d.base, view: d.view, spec: d.spec } });
          result.viewsUpdated.push({ folder: d.folderName, name: match.name });
        }
      }

      // Orphans: derived here, base/view gone, still untouched → remove.
      for (const v of views) {
        if (!v.cfg.origin) continue;
        const originKey = `${v.cfg.origin.base}#${v.cfg.origin.view}`;
        if (desired.has(originKey) || seenOrigins.has(originKey)) continue;
        // Unparseable and unsupported bases freeze their projections. Remove
        // only when the file is gone, or a successfully parsed base truly no
        // longer contains the view.
        if (presentBases.has(v.cfg.origin.base) && !parsedBases.has(v.cfg.origin.base)) continue;
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
 * construction. Every field here has a symmetric write-back spelling; adding
 * an import-only field would make ownership detection lie.
 */
export function specOf(layout: string, cfg: ViewCfg): string {
  return JSON.stringify({ layout, sort: cfg.sort, filters: cfg.filters, groupBy: cfg.groupBy, columns: cfg.columns ?? null });
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
  if (!baseFilter.supported) return null;
  const baseChildren = baseFilter.node ? (baseFilter.node.op === 'and' ? baseFilter.node.children : [baseFilter.node]) : [];
  const v = (Array.isArray(doc.views) ? doc.views : []).find((view) => (typeof view.name === 'string' && view.name.trim() ? view.name.trim() : 'Imported view') === viewName);
  if (!v) return null;
  const planned = planViewImport(v, baseFilter.node, kinds);
  if (!planned.supported) return null;
  return { layout: planned.layout, cfg: planned.cfg, baseChildren };
}

// ── Bases parsing (the documented subset) ────────────────────────────────────

interface BaseView {
  type?: unknown;
  name?: unknown;
  filters?: unknown;
  order?: unknown;
  sort?: unknown;
  limit?: unknown;
  columnSize?: unknown;
  groupBy?: unknown;
}
interface BaseFile {
  filters?: unknown;
  formulas?: Record<string, string>;
  properties?: Record<string, unknown>;
  views?: BaseView[];
}

function planViewImport(v: BaseView, baseFilter: FilterNode | null, kinds: PropertyTypes): { name: string; layout: string; cfg: ViewCfg; notes: string[]; supported: boolean } {
  const notes: string[] = [];
  const layout = v.type === 'table' ? 'table' : v.type === 'cards' ? 'grid' : v.type === 'list' ? 'list' : 'masonry';
  let supported = v.type === 'table' || v.type === 'cards' || v.type === 'list';
  if (!supported) notes.push(`view type "${String(v.type)}" is unsupported`);
  const ownedKeys = new Set(['type', 'name', 'filters', 'order', 'sort', 'groupBy', 'columnSize', 'limit']);
  const extraKeys = Object.keys(v).filter((key) => !ownedKeys.has(key));
  if (extraKeys.length) {
    notes.push(`view settings ${extraKeys.join(', ')} are unsupported`);
    supported = false;
  }
  if (v.limit !== undefined) {
    notes.push(`limit ${v.limit} is unsupported`);
    supported = false;
  }

  const own = parseFilterBlock(v.filters, kinds, notes);
  supported &&= own.supported;
  const children = [...(baseFilter?.op === 'and' ? baseFilter.children : baseFilter ? [baseFilter] : []), ...(own.node?.op === 'and' ? own.node.children : own.node ? [own.node] : [])];
  const filters: FilterNode | null = children.length ? { op: 'and', children } : null;

  const order = v.order === undefined
    ? []
    : Array.isArray(v.order) && v.order.every((key) => typeof key === 'string')
      ? v.order as string[]
      : [];
  if (v.order !== undefined && order !== v.order) {
    notes.push('order must be a list of property names');
    supported = false;
  }
  const validColumnSize =
    v.columnSize !== undefined &&
    !!v.columnSize &&
    typeof v.columnSize === 'object' &&
    !Array.isArray(v.columnSize) &&
    Object.values(v.columnSize).every((width) => typeof width === 'number' && Number.isFinite(width));
  if (v.columnSize !== undefined && !validColumnSize) {
    notes.push('columnSize must contain only finite numeric widths');
    supported = false;
  }
  const columnSize = validColumnSize ? v.columnSize as Record<string, number> : undefined;
  const columns = order.flatMap((rawKey) => {
    if (rawKey === 'file.name') return []; // the built-in fixed-width title column
    if (rawKey.startsWith('file.')) {
      notes.push(`column ${rawKey} is unsupported`);
      supported = false;
      return [];
    }
    if (rawKey.startsWith('formula.')) {
      notes.push(`column ${rawKey} is unsupported`);
      supported = false;
      return [];
    }
    const key = stripNote(rawKey);
    const width = normalizeTableColumnWidth(columnSize?.[`note.${key}`] ?? columnSize?.[rawKey] ?? columnSize?.[key]);
    return [{ key, width }];
  });

  let sort: ViewCfg['sort'] = { key: '$updated', dir: 'desc' };
  const sortRows = v.sort === undefined
    ? []
    : Array.isArray(v.sort) && v.sort.every((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
      ? v.sort as Array<Record<string, unknown>>
      : [];
  if (v.sort !== undefined && sortRows !== v.sort) {
    notes.push('sort must be a list of sort rules');
    supported = false;
  }
  const first = sortRows[0];
  if (first) {
    if (typeof first.property !== 'string') {
      notes.push('sort property is missing');
      supported = false;
    }
    const key = typeof first.property === 'string' ? basesKeyToWaffle(first.property) : null;
    const direction = first.direction === undefined
      ? 'ASC'
      : typeof first.direction === 'string'
        ? first.direction.toUpperCase()
        : '';
    if (direction !== 'ASC' && direction !== 'DESC') {
      notes.push(`sort direction "${String(first.direction)}" is unsupported`);
      supported = false;
    } else if (key && key !== '$ext' && key !== '$name') {
      sort = { key, dir: direction === 'DESC' ? 'desc' : 'asc' };
    } else if (typeof first.property === 'string') {
      notes.push(`sort by ${String(first.property)} is unsupported`);
      supported = false;
    }
  }
  if (sortRows.length > 1) {
    notes.push('multiple sort levels are unsupported');
    supported = false;
  }

  const group = parseGroupBy(v.groupBy, notes);
  supported &&= group.supported;
  const cfg: ViewCfg = { sort, filters, groupBy: group.groupBy };
  if (columns.length) cfg.columns = columns;
  return { name: typeof v.name === 'string' && v.name.trim() ? v.name.trim() : 'Imported view', layout, cfg, notes, supported };
}
