/**
 * The library screen: folder tree + toppings, rendered through the layout
 * registry. Each folder holds NAMED views (tabs) with their own layout, sort,
 * filters, and grouping; one is the default (ADR-006/-014). This replaces the
 * dev harness as the app's face (harness stays at ?dev).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FilterNode } from '@waffle/core';
import {
  DismissibleNotice,
  FilterPopover,
  ViewTabs,
  getLayout,
  listLayouts,
  type FilterCondition,
  type FilterField,
  type LibraryItem,
  type TableViewConfig,
} from '@waffle/ui';
import { getVaultFs, platform, platformReady, setVaultFs, type PlatformStatus } from '../platform/instance';
import { fsAccessSupported, pickRealFolder, restoreRealFolder } from '../platform/web/fsAccessFs';
import { inFolderFilter, loadPropertyKeys, type ViewCfg } from './queries';
import { loadThumb } from './thumbLoader';
import { FolderTree } from './FolderTree';
import { AddMenu, type AddAction } from './AddMenu';
import { addFiles, createLink, createNote } from './addFlows';
import { NoteEditor } from '../editor/NoteEditor';
import { LinkDetail } from '../editor/LinkDetail';
import { findNoteByTitle } from '../editor/resolve';
import { ImportDialog } from './ImportDialog';
import { SessionHistoryProvider, useSessionHistoryController } from './sessionHistory';
import { useLibraryViews } from './useLibraryViews';
import { reconcileActiveVault } from './vaultLifecycle';
import './TableLayout'; // registers the 'table' layout (same load-time pattern as @waffle/ui's entries)

/** cfg.filters is a flat AND of cmps in v1 — the popover edits exactly that. */
const EDITABLE_FILTER_CMPS = new Set<FilterCondition['cmp']>(['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'contains', 'tagged']);
const filtersAreEditable = (filters: FilterNode | null): boolean =>
  !filters || (filters.op === 'and' && filters.children.every((child) => child.op === 'cmp' && EDITABLE_FILTER_CMPS.has(child.cmp as FilterCondition['cmp'])));

const toConditions = (filters: FilterNode | null): FilterCondition[] =>
  filtersAreEditable(filters) && filters?.op === 'and'
    ? filters.children.filter((c): c is Extract<FilterNode, { op: 'cmp' }> => c.op === 'cmp').map((c) => ({ key: c.key, cmp: c.cmp as FilterCondition['cmp'], value: c.value as FilterCondition['value'] }))
    : [];

const filterCount = (filters: FilterNode | null): number =>
  !filters ? 0 : filters.op === 'cmp' ? 1 : filters.children.reduce((sum, child) => sum + filterCount(child), 0);

const toFilterNode = (conditions: FilterCondition[]): FilterNode | null =>
  conditions.length === 0 ? null : { op: 'and', children: conditions.map((c) => ({ op: 'cmp' as const, key: c.key, cmp: c.cmp, value: c.value })) };

const INTERACTION_STATUS_OPTIONS = [
  { value: 'queued', label: 'Queued / want to' },
  { value: 'active', label: 'Active / in progress' },
  { value: 'done', label: 'Done' },
  { value: 'dropped', label: 'Dropped' },
];

export function Library() {
  const [status, setStatus] = useState<PlatformStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [fields, setFields] = useState<FilterField[]>([]);
  const [openNote, setOpenNote] = useState<{ path: string; title: string } | null>(null);
  const [openLink, setOpenLink] = useState<{ item: LibraryItem; url: string } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const {
    roots,
    selected,
    items,
    groups,
    views,
    activeId,
    activeView,
    folderName,
    targetDir,
    totalCount,
    markItemsLoading,
    openFolder,
    refreshRoots,
    refreshAll,
    refreshQuiet,
    switchView,
    patchActive,
    createNamedView,
    deleteNamedView,
    setDefaultNamedView,
    renameNamedView,
  } = useLibraryViews();
  const sessionHistory = useSessionHistoryController(refreshQuiet);

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

  const syncVault = useCallback(async () => {
    const generated = await reconcileActiveVault();
    await refreshAll();
    return generated;
  }, [refreshAll]);

  // StrictMode double-invokes mount effects in dev; init (scan + obsidian
  // sync + thumbs) must run once — concurrent syncs would race their writes.
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    (async () => {
      try {
        setStatus(await platformReady);
        await refreshRoots();
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
    setError(null);
    try {
      // Note/link/file creation is canonical but not yet reversible. Clear
      // older inverses before the first write so undo never crosses it.
      sessionHistory.invalidate();
      const fs = await getVaultFs();
      const dir = targetDir;
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

  const onOpenImport = (): void => {
    try {
      // Sync may merge property declarations. That can change how an older
      // property receipt parses, even when no note bytes change.
      sessionHistory.invalidate();
      setImportOpen(true);
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
    setError(null);
    try {
      const fs = await pickRealFolder();
      sessionHistory.clear();
      setVaultFs(fs);
      markItemsLoading();
      await syncVault();
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return; // user cancelled the picker
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const openFilters = async (): Promise<void> => {
    if (!filterOpen) {
      const props = await loadPropertyKeys(inFolderFilter(activeView?.cfg.filters ?? null) === null ? selected : null);
      setFields([
        { key: '$title', kind: 'title' },
        { key: '$type', kind: 'type' },
        { key: '$tag', kind: 'tag' },
        { key: '$name', kind: 'text' },
        { key: '$path', kind: 'text' },
        { key: '$folder', kind: 'text' },
        { key: '$ext', kind: 'text' },
        { key: '$updated', kind: 'date' },
        { key: '$interaction.status', kind: 'interaction-status', label: 'My status', options: INTERACTION_STATUS_OPTIONS },
        { key: '$interaction.rating', kind: 'interaction-rating', label: 'My rating' },
        ...props.map((p) => ({ key: p.key, kind: p.kind })),
      ]);
    }
    setFilterOpen((o) => !o);
  };

  const layout = getLayout(activeView?.layout ?? 'masonry');
  const LayoutComponent = layout.component;
  const cfg = activeView?.cfg ?? null;
  const conditionCount = cfg ? filterCount(cfg.filters) : 0;
  const grouped = !!cfg?.groupBy && !!layout.groupable;
  const sortValue = cfg?.sort.key === '$title' ? '$title' : cfg?.sort.key === '$updated' ? '$updated' : 'prop';
  const tableConfig: TableViewConfig = { columns: cfg?.columns, sort: cfg?.sort ?? null, groupBy: cfg?.groupBy ?? null };

  const screen = (
    <div style={{ display: 'flex', height: '100vh' }}>
      <aside style={{ width: 240, flexShrink: 0, borderRight: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '0.9rem 1rem 0.5rem', fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: '1.05rem' }}>
          🧇 Waffle
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <FolderTree
            roots={roots}
            selectedId={selected}
            totalCount={totalCount}
            onSelect={(id) => {
              setFilterOpen(false);
              void openFolder(id);
            }}
          />
        </div>
        <button
          onClick={onOpenImport}
          title="Obsidian config syncs automatically at every scan — this shows the last result and any skipped constructs"
          style={{ margin: '0.5rem 0.75rem 0', padding: '0.4rem 0.6rem', fontSize: '0.78rem', background: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
        >
          Obsidian sync report…
        </button>
        {fsAccessSupported() && (
          <button
            disabled={sessionHistory.busy}
            onClick={() => void onPickFolder()}
            style={{ margin: '0.5rem 0.75rem', padding: '0.4rem 0.6rem', fontSize: '0.78rem', background: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', cursor: sessionHistory.busy ? 'default' : 'pointer', opacity: sessionHistory.busy ? 0.5 : 1 }}
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
          {sessionHistory.error && (
            <DismissibleNotice
              compact
              dismissLabel="Dismiss history message"
              onDismiss={sessionHistory.dismissError}
              style={{ maxWidth: 'min(38vw, 480px)' }}
            >
              {sessionHistory.error}
            </DismissibleNotice>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              aria-label={sessionHistory.undoLabel ? `Undo ${sessionHistory.undoLabel}` : 'Undo'}
              title={sessionHistory.undoLabel ? `Undo ${sessionHistory.undoLabel} (Cmd/Ctrl+Z)` : 'Nothing to undo'}
              disabled={!sessionHistory.canUndo}
              onClick={() => void sessionHistory.undo()}
              style={{ ...historyButtonStyle, cursor: sessionHistory.canUndo ? 'pointer' : 'default', opacity: sessionHistory.canUndo ? 1 : 0.45 }}
            >
              ↶
            </button>
            <button
              aria-label={sessionHistory.redoLabel ? `Redo ${sessionHistory.redoLabel}` : 'Redo'}
              title={sessionHistory.redoLabel ? `Redo ${sessionHistory.redoLabel} (Shift+Cmd/Ctrl+Z)` : 'Nothing to redo'}
              disabled={!sessionHistory.canRedo}
              onClick={() => void sessionHistory.redo()}
              style={{ ...historyButtonStyle, cursor: sessionHistory.canRedo ? 'pointer' : 'default', opacity: sessionHistory.canRedo ? 1 : 0.45 }}
            >
              ↷
            </button>
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
              filtersReadOnly={!filtersAreEditable(cfg.filters)}
              groupBy={cfg.groupBy}
              groupChoices={fields.filter((f) => f.key !== '$tag' && f.kind !== 'interaction-status' && f.kind !== 'interaction-rating').map((f) => f.key)}
              showGroupBy={!!layout.groupable}
              onApply={(conditions, groupBy) => {
                setFilterOpen(false);
                void patchActive({ filters: filtersAreEditable(cfg.filters) ? toFilterNode(conditions) : cfg.filters, groupBy });
              }}
              onClose={() => setFilterOpen(false)}
            />
          )}
        </header>

        {activeId && (
          <ViewTabs
            views={views.map((v) => ({ id: v.id, name: v.name, isDefault: v.isDefault }))}
            activeId={activeId}
            onSelect={(id) => {
              setFilterOpen(false);
              void switchView(id);
            }}
            onCreate={(name) => void createNamedView(name)}
            onRename={(id, name) => void renameNamedView(id, name)}
            onDelete={(id) => void deleteNamedView(id)}
            onSetDefault={(id) => void setDefaultNamedView(id)}
          />
        )}

        <div style={{ flex: 1, minHeight: 0, background: 'var(--bg)', position: 'relative' }} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
          {error && (
            <DismissibleNotice
              dismissLabel="Dismiss library message"
              onDismiss={() => setError(null)}
              style={{ position: 'absolute', top: 12, left: 12, right: 12, zIndex: 9, boxShadow: 'var(--shadow-menu-soft)' }}
            >
              {error}
            </DismissibleNotice>
          )}
          {items === null ? null : items.length === 0 && layout.key !== 'table' && conditionCount === 0 ? (
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
              crossFolder={inFolderFilter(cfg?.filters ?? null) !== null}
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
          {openLink && (
            <LinkDetail
              key={openLink.item.id}
              item={openLink.item}
              url={openLink.url}
              onClose={() => {
                setOpenLink(null);
                // Marks live outside topping properties; refresh the active
                // projection so badges and interaction filters change together.
                void refreshQuiet();
              }}
            />
          )}
          {importOpen && (
            <ImportDialog
              onClose={() => setImportOpen(false)}
              onImported={() => void refreshAll()}
            />
          )}
        </div>
      </main>
    </div>
  );

  return (
    <SessionHistoryProvider controller={sessionHistory}>
      {screen}
    </SessionHistoryProvider>
  );
}

const historyButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 30,
  height: 30,
  padding: 0,
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--surface)',
  color: 'var(--text-dim)',
  fontSize: '1rem',
};
