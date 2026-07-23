/**
 * Write-back half of the bidirectional base sync: editing a DERIVED view in
 * Waffle patches its `.base` view node — the frontmatter discipline applied to
 * bases. Rules that keep user files safe:
 *  - YAML document surgery: only the keys we own (name/type/filters/order/
 *    sort/groupBy plus widths for ordered properties) are set. Unknown `columnSize`
 *    entries, formulas, limit, and unknown keys survive; comments and
 *    formatting are preserved by the yaml Document.
 *  - Base-level filter children (merged into the view at import) are
 *    SUBTRACTED structurally before writing; if the user's edit altered those
 *    shared conditions the state is inexpressible per-view → we FREEZE
 *    (return 'frozen', write nothing) rather than corrupt the file.
 *  - Layouts and fields outside the implemented sync subset freeze before the
 *    file is parsed for mutation.
 *  - Anti-flap: after writing we re-derive the view from the new file and
 *    store THAT canonical state + spec, so the next sync sees perfect equality.
 */
import { parseDocument } from 'yaml';
import { rescanFile, type VaultFs, loadPropertyTypes } from '@waffle/core';
import { normalizeTableColumnWidth } from '@waffle/ui';
import { platform } from '../platform/instance';
import { saveViewState, type FolderView, type ViewCfg } from '../library/queries';
import { filterToBases, groupByToBases, waffleKeyToBases } from './basesCompatibility';
import { reimportView, specOf } from './obsidianImport';

const LAYOUT_TO_TYPE: Record<string, string | undefined> = { table: 'table', grid: 'cards', list: 'list' };

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
  const filterBlocks: unknown[] = [];
  for (const child of ownChildren) {
    const block = filterToBases(child, kinds);
    if (block === null) return 'frozen'; // a condition Bases can't express
    filterBlocks.push(block);
  }
  const sortProperty = waffleKeyToBases(view.cfg.sort.key);
  if (!sortProperty) return 'frozen';
  const groupBy = view.cfg.groupBy ? groupByToBases(view.cfg.groupBy) : null;
  if (view.cfg.groupBy && !groupBy) return 'frozen';

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
  if (filterBlocks.length > 0) doc.setIn(['views', index, 'filters'], { and: filterBlocks });
  else doc.deleteIn(['views', index, 'filters']);
  if (view.cfg.columns?.length) {
    doc.setIn(['views', index, 'order'], ['file.name', ...view.cfg.columns.map((column) => column.key)]);
    const columnSize = { ...((rawColumnSize as Record<string, unknown> | undefined) ?? {}) };
    for (const column of view.cfg.columns) columnSize[`note.${column.key}`] = normalizeTableColumnWidth(column.width);
    doc.setIn(['views', index, 'columnSize'], columnSize);
  } else {
    doc.deleteIn(['views', index, 'order']);
  }
  doc.setIn(['views', index, 'sort'], [{ property: sortProperty, direction: view.cfg.sort.dir === 'desc' ? 'DESC' : 'ASC' }]);
  if (groupBy) doc.setIn(['views', index, 'groupBy'], groupBy);
  else doc.deleteIn(['views', index, 'groupBy']);

  await fs.write(origin.base, new TextEncoder().encode(doc.toString()));
  await rescanFile(platform.db, fs, origin.base);

  // Canonicalize: store exactly what the next sync will derive from the file.
  const canon = await reimportView(fs, origin.base, view.name);
  if (canon) {
    await saveViewState(view.id, canon.layout, {
      ...canon.cfg,
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
