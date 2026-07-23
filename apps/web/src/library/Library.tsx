/**
 * The library screen: folder tree + toppings, rendered through the layout
 * registry. Each folder holds NAMED views (tabs) with their own layout, sort,
 * filters, and grouping; one is the default (ADR-006/-014). This replaces the
 * dev harness as the app's face (harness stays at ?dev).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { scanVault, type FilterNode } from '@waffle/core';
import { FilterPopover, getLayout, listLayouts, ViewTabs, type FilterCondition, type FilterField, type GroupSection, type LibraryItem, type TableViewConfig } from '@waffle/ui';
import { getVaultFs, platform, platformReady, setVaultFs, type PlatformStatus } from '../platform/instance';
import { fsAccessSupported, pickRealFolder, restoreRealFolder } from '../platform/web/fsAccessFs';
import { runThumbnailer } from '../thumbs/thumbnailer';
import {
  createView, deleteView, listViews, loadFolderTree, loadGroupSections, loadItems, loadPropertyKeys, renameView, saveViewState, setDefaultView,
  type FolderNode, type FolderView, type ViewCfg,
} from './queries';
import { loadThumb } from './thumbLoader';
import { FolderTree } from './FolderTree';
import { AddMenu, type AddAction } from './AddMenu';
import { addFiles, createLink, createNote } from './addFlows';
import { NoteEditor } from '../editor/NoteEditor';
import { LinkDetail } from '../editor/LinkDetail';
import { findNoteByTitle } from '../editor/resolve';
import './TableLayout'; // registers the 'table' layout (same load-time pattern as @waffle/ui's entries)

/** cfg.filters is a flat AND of cmps in v1 — the popover edits exactly that. */
const toConditions = (filters: FilterNode | null): FilterCondition[] =>
  filters && filters.op === 'and'
    ? filters.children.filter((c): c is Extract<FilterNode, { op: 'cmp' }> => c.op === 'cmp').map((c) => ({ key: c.key, cmp: c.cmp, value: c.value as FilterCondition['value'] }))
    : [];

const toFilterNode = (conditions: FilterCondition[]): FilterNode | null =>
  conditions.length === 0 ? null : { op: 'and', children: conditions.map((c) => ({ op: 'cmp' as const, key: c.key, cmp: c.cmp, value: c.value })) };

export function Library() {
  const [status, setStatus] = useState<PlatformStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [roots, setRoots] = useState<FolderNode[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  // null = loading (never show "empty" while a query is in flight)
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [groups, setGroups] = useState<GroupSection[] | null>(null);
  const [views, setViews] = useState<FolderView[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [fields, setFields] = useState<FilterField[]>([]);
  const [openNote, setOpenNote] = useState<{ path: string; title: string } | null>(null);
  const [openLink, setOpenLink] = useState<{ item: LibraryItem; url: string } | null>(null);

  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  // Latest views/active, immune to stale closures: two rapid patches (layout
  // then sort) must compose, not overwrite each other.
  const viewsRef = useRef(views);
  viewsRef.current = views;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  const activeView = views.find((v) => v.id === activeId) ?? null;

  const onOpenItem = (item: LibraryItem): void => {
    // Notes → editor. Links → detail view (docs/10). Files/dash open in later slices.
    if (item.type === 'note' && item.contentRef?.endsWith('.md')) {
      setOpenNote({ path: item.contentRef, title: item.title });
    } else if (item.type === 'link') {
      void (async () => {
        const rows = await platform.db.exec<{ value_text: string | null }>(
          `SELECT value_text FROM properties WHERE topping_id = ? AND key = 'url'`,
          [item.id],
        );
        const url = rows[0]?.value_text ?? item.contentRef;
        if (url && /^https?:/.test(url)) setOpenLink({ item, url });
      })();
    }
  };

  const onNavigateWikilink = async (name: string): Promise<void> => {
    const target = await findNoteByTitle(name);
    if (target) setOpenNote({ path: target, title: name });
  };

  /** Adds target the selected folder when it's vault-backed; vault root otherwise. */
  const targetDir = (): string => {
    if (selected === null) return '';
    const find = (list: FolderNode[]): FolderNode | null => {
      for (const n of list) {
        if (n.id === selected) return n;
        const hit = find(n.children);
        if (hit) return hit;
      }
      return null;
    };
    return find(roots)?.vaultPath ?? '';
  };

  const activeViewRef = (): FolderView | null => viewsRef.current.find((v) => v.id === activeIdRef.current) ?? null;

  /** One query path for every load site: items + (when the layout renders them) group sections. */
  const queryRows = async (folderId: string | null, view: FolderView): Promise<{ items: LibraryItem[]; groups: GroupSection[] | null }> => {
    const loaded = await loadItems(folderId, view.cfg);
    if (view.cfg.groupBy && getLayout(view.layout).groupable) return { ...(await loadGroupSections(folderId, view.cfg.groupBy, loaded)) };
    return { items: loaded, groups: null };
  };

  const openFolder = useCallback(async (folderId: string | null) => {
    setSelected(folderId);
    setItems(null);
    setFilterOpen(false);
    const list = await listViews(folderId);
    const initial = list.find((v) => v.isDefault) ?? list[0]!;
    setViews(list);
    setActiveId(initial.id);
    const loaded = await queryRows(folderId, initial);
    setItems(loaded.items);
    setGroups(loaded.groups);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshAll = useCallback(async () => {
    setRoots(await loadFolderTree());
    await openFolder(selectedRef.current);
  }, [openFolder]);

  // Post-write refresh that swaps rows IN PLACE — no null flash, so the table
  // keeps its scroll position, selection, and mounted editors across edits.
  const refreshQuiet = useCallback(async () => {
    setRoots(await loadFolderTree());
    const view = activeViewRef();
    if (!view) return;
    const loaded = await queryRows(selectedRef.current, view);
    setItems(loaded.items);
    setGroups(loaded.groups);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Scan the active vault, generate missing thumbnails, refresh everything. */
  const syncVault = useCallback(async () => {
    const fs = await getVaultFs();
    await scanVault(platform.db, fs);
    const generated = await runThumbnailer(platform.db, fs);
    await refreshAll();
    return generated;
  }, [refreshAll]);

  useEffect(() => {
    (async () => {
      try {
        setStatus(await platformReady);
        setRoots(await loadFolderTree());
        await openFolder(null);
        // Re-attach a previously picked real folder (silent; falls back to OPFS),
        // then catch up on any thumbs the last session didn't generate.
        const restored = await restoreRealFolder().catch(() => null);
        if (restored) setVaultFs(restored);
        await syncVault();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onAdd = async (action: AddAction): Promise<void> => {
    try {
      const fs = await getVaultFs();
      const dir = targetDir();
      if (action.kind === 'note') {
        const notePath = await createNote(fs, dir, action.name);
        await syncVault();
        setOpenNote({ path: notePath, title: notePath.split('/').pop()!.replace(/\.md$/, '') });
      } else if (action.kind === 'link') {
        await createLink(fs, dir, action.url);
        await syncVault();
      } else {
        await addFiles(fs, dir, action.files);
        await syncVault();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault();
    const files = [...e.dataTransfer.files];
    if (files.length) void onAdd({ kind: 'files', files });
  };

  const onPickFolder = async (): Promise<void> => {
    try {
      const fs = await pickRealFolder();
      setVaultFs(fs);
      setItems(null);
      await syncVault();
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return; // user cancelled the picker
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // ── View manager ──────────────────────────────────────────────────────────

  const switchView = async (id: string): Promise<void> => {
    setActiveId(id);
    setFilterOpen(false);
    const view = viewsRef.current.find((v) => v.id === id);
    if (!view) return;
    const loaded = await queryRows(selectedRef.current, view);
    setItems(loaded.items);
    setGroups(loaded.groups);
  };

  /** Patch the active view (optimistic), persist, and requery when results can change. */
  const patchActive = async (patch: Partial<ViewCfg> & { layout?: string }): Promise<void> => {
    const current = viewsRef.current.find((v) => v.id === activeIdRef.current);
    if (!current) return;
    const { layout, ...cfgPatch } = patch;
    const next: FolderView = { ...current, layout: layout ?? current.layout, cfg: { ...current.cfg, ...cfgPatch } };
    setViews(viewsRef.current.map((v) => (v.id === next.id ? next : v)));
    await saveViewState(next.id, next.layout, next.cfg);
    // Layout switches requery too when grouped: sections exist only for groupable layouts.
    if ('sort' in cfgPatch || 'filters' in cfgPatch || 'groupBy' in cfgPatch || (layout !== undefined && next.cfg.groupBy)) {
      const loaded = await queryRows(selectedRef.current, next);
      setItems(loaded.items);
      setGroups(loaded.groups);
    }
  };

  const onCreateView = async (name: string): Promise<void> => {
    const view = await createView(selectedRef.current, name);
    setViews([...viewsRef.current, view]);
    await switchView(view.id);
  };

  const onDeleteView = async (id: string): Promise<void> => {
    await deleteView(id);
    const remaining = viewsRef.current.filter((v) => v.id !== id);
    setViews(remaining);
    const fallback = remaining.find((v) => v.isDefault) ?? remaining[0];
    if (fallback) await switchView(fallback.id);
  };

  const onSetDefaultView = async (id: string): Promise<void> => {
    await setDefaultView(selectedRef.current, id);
    setViews(viewsRef.current.map((v) => ({ ...v, isDefault: v.id === id })));
  };

  const onRenameView = async (id: string, name: string): Promise<void> => {
    await renameView(id, name);
    setViews(viewsRef.current.map((v) => (v.id === id ? { ...v, name } : v)));
  };

  const openFilters = async (): Promise<void> => {
    if (!filterOpen) {
      const props = await loadPropertyKeys(selectedRef.current);
      setFields([{ key: '$title', kind: 'title' }, { key: '$type', kind: 'type' }, { key: '$tag', kind: 'tag' }, ...props.map((p) => ({ key: p.key, kind: p.kind }))]);
    }
    setFilterOpen((o) => !o);
  };

  const layout = getLayout(activeView?.layout ?? 'masonry');
  const LayoutComponent = layout.component;
  const folderName = selected === null ? 'Everything' : findName(roots, selected) ?? '…';
  const cfg = activeView?.cfg ?? null;
  const conditionCount = cfg ? toConditions(cfg.filters).length : 0;
  const grouped = !!cfg?.groupBy && !!layout.groupable;
  const sortValue = cfg?.sort.key === '$title' ? '$title' : cfg?.sort.key === '$updated' ? '$updated' : 'prop';
  const tableConfig: TableViewConfig = { columns: cfg?.columns, sort: cfg?.sort ?? null, groupBy: cfg?.groupBy ?? null };
  const totalCount = countTree(roots);

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <aside style={{ width: 240, flexShrink: 0, borderRight: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '0.9rem 1rem 0.5rem', fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: '1.05rem' }}>
          🧇 Waffle
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <FolderTree roots={roots} selectedId={selected} totalCount={totalCount} onSelect={(id) => void openFolder(id)} />
        </div>
        {fsAccessSupported() && (
          <button
            onClick={() => void onPickFolder()}
            style={{ margin: '0.5rem 0.75rem', padding: '0.4rem 0.6rem', fontSize: '0.78rem', background: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
          >
            Open folder…
          </button>
        )}
        {status && (
          <div style={{ padding: '0.5rem 1rem', fontSize: '0.68rem', color: 'var(--text-dim)', borderTop: '1px solid var(--border)' }}>
            {status.storage} · sqlite {status.sqliteVersion} · schema v{status.schemaVersion} · <a href="?dev" style={{ color: 'var(--text-dim)' }}>dev</a>
          </div>
        )}
      </aside>

      <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <header style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12, padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)' }}>
          <h1 style={{ fontSize: '1.05rem', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{folderName}</h1>
          <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>{items === null ? '…' : items.length.toLocaleString()}</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
            <AddMenu onAdd={(action) => void onAdd(action)} />
            <button
              onClick={() => void openFilters()}
              style={{
                padding: '0.3rem 0.6rem',
                fontSize: '0.8rem',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                background: conditionCount > 0 || grouped ? 'var(--accent)' : 'var(--surface)',
                color: conditionCount > 0 || grouped ? 'var(--accent-ink)' : 'var(--text-dim)',
                cursor: 'pointer',
              }}
            >
              Filter{conditionCount > 0 ? ` · ${conditionCount}` : ''}{grouped ? ' · grouped' : ''}
            </button>
            <select
              value={sortValue}
              onChange={(e) => {
                const v = e.target.value;
                if (v === '$updated') void patchActive({ sort: { key: '$updated', dir: 'desc' } });
                else if (v === '$title') void patchActive({ sort: { key: '$title', dir: 'asc' } });
              }}
              style={{ background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0.3rem 0.5rem', fontSize: '0.8rem' }}
            >
              <option value="$updated">Recently updated</option>
              <option value="$title">Title A–Z</option>
              {sortValue === 'prop' && cfg && <option value="prop">{cfg.sort.key} {cfg.sort.dir === 'asc' ? '▲' : '▼'}</option>}
            </select>
            {listLayouts().map((entry) => {
              const Icon = entry.icon;
              const active = entry.key === layout.key;
              return (
                <button
                  key={entry.key}
                  title={entry.label}
                  onClick={() => void patchActive({ layout: entry.key })}
                  style={{
                    display: 'inline-flex',
                    padding: '0.35rem 0.5rem',
                    fontSize: '1rem',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    background: active ? 'var(--accent)' : 'var(--surface)',
                    color: active ? 'var(--accent-ink)' : 'var(--text-dim)',
                    cursor: 'pointer',
                  }}
                >
                  <Icon />
                </button>
              );
            })}
          </div>
          {filterOpen && cfg && (
            <FilterPopover
              fields={fields}
              conditions={toConditions(cfg.filters)}
              groupBy={cfg.groupBy}
              groupChoices={fields.filter((f) => !f.key.startsWith('$')).map((f) => f.key)}
              showGroupBy={!!layout.groupable}
              onApply={(conditions, groupBy) => {
                setFilterOpen(false);
                void patchActive({ filters: toFilterNode(conditions), groupBy });
              }}
              onClose={() => setFilterOpen(false)}
            />
          )}
        </header>

        {activeId && (
          <ViewTabs
            views={views.map((v) => ({ id: v.id, name: v.name, isDefault: v.isDefault }))}
            activeId={activeId}
            onSelect={(id) => void switchView(id)}
            onCreate={(name) => void onCreateView(name)}
            onRename={(id, name) => void onRenameView(id, name)}
            onDelete={(id) => void onDeleteView(id)}
            onSetDefault={(id) => void onSetDefaultView(id)}
          />
        )}

        <div style={{ flex: 1, minHeight: 0, background: 'var(--bg)', position: 'relative' }} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
          {error ? (
            <pre style={{ color: 'var(--ink-blush)', padding: '1rem', whiteSpace: 'pre-wrap' }}>{error}</pre>
          ) : items === null ? null : items.length === 0 && layout.key !== 'table' && conditionCount === 0 ? (
            // The table renders even empty (its ghost row IS the add affordance,
            // docs/12), and a filtered-to-zero view must show its zero.
            <div style={{ padding: '3rem 1rem', textAlign: 'center', color: 'var(--text-dim)' }}>
              <p style={{ fontFamily: 'var(--font-head)', fontSize: '1rem' }}>Nothing here yet</p>
              <p style={{ fontSize: '0.85rem' }}>Add toppings, or open the <a href="?dev" style={{ color: 'var(--accent-ink)' }}>dev harness</a> to seed data.</p>
            </div>
          ) : (
            <LayoutComponent
              items={items}
              groups={groups}
              loadThumb={loadThumb}
              onOpen={onOpenItem}
              folderId={selected}
              onMutated={refreshQuiet}
              tableConfig={tableConfig}
              onTableConfig={(patch) => {
                const p: Partial<ViewCfg> = {};
                if (patch.columns) p.columns = patch.columns;
                if (patch.sort) p.sort = patch.sort;
                if ('groupBy' in patch) p.groupBy = patch.groupBy ?? null;
                void patchActive(p);
              }}
            />
          )}
          {openNote && (
            <NoteEditor
              key={openNote.path}
              path={openNote.path}
              title={openNote.title}
              onClose={() => {
                setOpenNote(null);
                // The editor flushed save + rescan before calling this — requery
                // so edited frontmatter lands in cells/filters/groups immediately.
                void refreshQuiet();
              }}
              onNavigate={(name) => void onNavigateWikilink(name)}
            />
          )}
          {openLink && <LinkDetail key={openLink.item.id} item={openLink.item} url={openLink.url} onClose={() => setOpenLink(null)} />}
        </div>
      </main>
    </div>
  );
}

function countTree(roots: FolderNode[]): number {
  let total = 0;
  const walk = (n: FolderNode): void => {
    total += n.count;
    n.children.forEach(walk);
  };
  roots.forEach(walk);
  return total;
}

function findName(roots: FolderNode[], id: string): string | null {
  for (const root of roots) {
    if (root.id === id) return root.name === '/' ? 'Vault' : root.name;
    const found = findName(root.children, id);
    if (found) return found;
  }
  return null;
}
