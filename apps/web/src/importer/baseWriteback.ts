/**
 * Write-back half of the bidirectional base sync: editing a DERIVED view in
 * Waffle patches its `.base` view node — the frontmatter discipline applied to
 * bases. Rules that keep user files safe:
 *  - YAML document surgery: only the keys we own (name/type/filters/order/
 *    sort plus widths for ordered properties) are set. Unknown `columnSize`
 *    entries, formulas, limit, and unknown keys survive; comments and
 *    formatting are preserved by the yaml Document.
 *  - Base-level filter children (merged into the view at import) are
 *    SUBTRACTED structurally before writing; if the user's edit altered those
 *    shared conditions the state is inexpressible per-view → we FREEZE
 *    (return 'frozen', write nothing) rather than corrupt the file.
 *  - Layouts outside the implemented sync subset (masonry and, pending the
 *    compatibility slice, list) also freeze; groupBy never reaches this code
 *    yet (Waffle-side field, docs in obsidianImport.specOf).
 *  - Anti-flap: after writing we re-derive the view from the new file and
 *    store THAT canonical state + spec, so the next sync sees perfect equality.
 */
import { parseDocument } from 'yaml';
import { rescanFile, type FilterNode, type PropertyTypes, type VaultFs, loadPropertyTypes } from '@waffle/core';
import { normalizeTableColumnWidth } from '@waffle/ui';
import { platform } from '../platform/instance';
import { saveViewState, type FolderView, type ViewCfg } from '../library/queries';
import { reimportView, specOf } from './obsidianImport';

const OP: Record<string, string> = { eq: '==', ne: '!=', lt: '<', lte: '<=', gt: '>', gte: '>=' };
const LAYOUT_TO_TYPE: Record<string, string | undefined> = { table: 'table', grid: 'cards' };

export type WriteBackOutcome = 'synced' | 'frozen';

/** Persist a Waffle-side edit of a derived view into its .base file. */
export async function writeBackView(fs: VaultFs, view: FolderView): Promise<WriteBackOutcome> {
  const origin = view.cfg.origin;
  if (!origin) return 'synced'; // not derived — nothing to do

  const type = LAYOUT_TO_TYPE[view.layout];
  if (!type) return 'frozen'; // outside the currently implemented Bases subset

  const current = await reimportView(fs, origin.base, origin.view);
  if (!current) return 'frozen'; // base or view node vanished under us

  // Subtract the base-level filter children the import merged in.
  const children = view.cfg.filters ? (view.cfg.filters.op === 'and' ? view.cfg.filters.children : [view.cfg.filters]) : [];
  const baseChildren = current.baseChildren;
  for (let i = 0; i < baseChildren.length; i++) {
    if (JSON.stringify(children[i]) !== JSON.stringify(baseChildren[i])) return 'frozen'; // shared conditions edited — inexpressible per-view
  }
  const ownChildren = children.slice(baseChildren.length);

  const kinds = await loadPropertyTypes(fs);
  const exprs: string[] = [];
  for (const child of ownChildren) {
    const expr = toExpression(child, kinds);
    if (!expr) return 'frozen'; // a condition Bases can't express
    exprs.push(expr);
  }

  const text = new TextDecoder().decode(await fs.read(origin.base));
  const doc = parseDocument(text);
  if (doc.errors.length > 0) return 'frozen';
  const views = doc.toJS() as { views?: Array<{ name?: string; columnSize?: unknown }> };
  const index = (views.views ?? []).findIndex((v) => (v.name?.trim() || 'Imported view') === origin.view);
  if (index < 0) return 'frozen';
  const rawColumnSize = views.views?.[index]?.columnSize;
  if (
    view.cfg.columns?.length &&
    rawColumnSize !== undefined &&
    (rawColumnSize === null || typeof rawColumnSize !== 'object' || Array.isArray(rawColumnSize))
  ) {
    return 'frozen'; // malformed user-owned structure: never coerce or replace it
  }

  doc.setIn(['views', index, 'type'], type);
  doc.setIn(['views', index, 'name'], view.name);
  if (exprs.length > 0) doc.setIn(['views', index, 'filters'], { and: exprs });
  else doc.deleteIn(['views', index, 'filters']);
  if (view.cfg.columns?.length) {
    doc.setIn(['views', index, 'order'], ['file.name', ...view.cfg.columns.map((column) => column.key)]);
    const columnSize = { ...((rawColumnSize as Record<string, unknown> | undefined) ?? {}) };
    for (const column of view.cfg.columns) columnSize[`note.${column.key}`] = normalizeTableColumnWidth(column.width);
    doc.setIn(['views', index, 'columnSize'], columnSize);
  } else {
    doc.deleteIn(['views', index, 'order']);
  }
  doc.setIn(['views', index, 'sort'], [{ property: sortKeyToBases(view.cfg.sort.key), direction: view.cfg.sort.dir === 'desc' ? 'DESC' : 'ASC' }]);

  await fs.write(origin.base, new TextEncoder().encode(doc.toString()));
  await rescanFile(platform.db, fs, origin.base);

  // Canonicalize: store exactly what the next sync will derive from the file.
  const canon = await reimportView(fs, origin.base, view.name);
  if (canon) {
    await saveViewState(view.id, canon.layout, {
      ...canon.cfg,
      groupBy: view.cfg.groupBy, // Waffle-side field rides along
      origin: { base: origin.base, view: view.name, spec: specOf(canon.layout, canon.cfg) },
    });
  }
  return 'synced';
}

/** Remove a derived view's node from its .base (Waffle-side delete = file delete, or the sync would resurrect it). */
export async function writeBackViewRemoval(fs: VaultFs, view: FolderView): Promise<void> {
  const origin = view.cfg.origin;
  if (!origin) return;
  let text: string;
  try {
    text = new TextDecoder().decode(await fs.read(origin.base));
  } catch {
    return; // base already gone
  }
  const doc = parseDocument(text);
  if (doc.errors.length > 0) return;
  const views = doc.toJS() as { views?: Array<{ name?: string }> };
  const index = (views.views ?? []).findIndex((v) => (v.name?.trim() || 'Imported view') === origin.view);
  if (index < 0) return;
  doc.deleteIn(['views', index]);
  await fs.write(origin.base, new TextEncoder().encode(doc.toString()));
  await rescanFile(platform.db, fs, origin.base);
}

function sortKeyToBases(key: string): string {
  if (key === '$title') return 'file.name';
  if (key === '$updated') return 'file.mtime';
  return key;
}

function toExpression(node: FilterNode, kinds: PropertyTypes): string | null {
  if (node.op !== 'cmp') return null; // nested or-groups aren't produced by the UI yet
  if (node.key === '$tag' && node.cmp === 'tagged') return `file.hasTag(${quote(String(node.value))})`;
  const key = node.key === '$title' ? 'file.name' : node.key;
  if (node.cmp === 'contains') return `${key}.contains(${quote(String(node.value))})`;
  const op = OP[node.cmp];
  if (!op) return null;
  return `${key} ${op} ${literalToBases(node.value, kinds[node.key]?.kind)}`;
}

function literalToBases(value: unknown, kind: string | undefined): string {
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') {
    // Date cmp values are Date.parse ms in our AST; Bases speaks ISO dates.
    if (kind === 'date') return quote(new Date(value).toISOString().slice(0, 10));
    return String(value);
  }
  return quote(String(value));
}

const quote = (s: string): string => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
