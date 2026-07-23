/**
 * The library screen: folder tree + toppings, rendered through the layout
 * registry, with per-folder persisted views. This replaces the dev harness as
 * the app's face (harness stays at ?dev).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { scanVault } from '@waffle/core';
import { getLayout, listLayouts, type LibraryItem } from '@waffle/ui';
import { getVaultFs, platform, platformReady, setVaultFs, type PlatformStatus } from '../platform/instance';
import { fsAccessSupported, pickRealFolder, restoreRealFolder } from '../platform/web/fsAccessFs';
import { runThumbnailer } from '../thumbs/thumbnailer';
import { loadFolderTree, loadItems, loadView, saveView, type FolderNode, type FolderViewState, type SortKey } from './queries';
import { loadThumb } from './thumbLoader';
import { FolderTree } from './FolderTree';
import { AddMenu, type AddAction } from './AddMenu';
import { addFiles, createLink, createNote } from './addFlows';
import { NoteEditor } from '../editor/NoteEditor';
import { LinkDetail } from '../editor/LinkDetail';
import { findNoteByTitle } from '../editor/resolve';
import './TableLayout'; // registers the 'table' layout (same load-time pattern as @waffle/ui's entries)

export function Library() {
  const [status, setStatus] = useState<PlatformStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [roots, setRoots] = useState<FolderNode[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  // null = loading (never show "empty" while a query is in flight)
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [openNote, setOpenNote] = useState<{ path: string; title: string } | null>(null);
  const [openLink, setOpenLink] = useState<{ item: LibraryItem; url: string } | null>(null);

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
  const [view, setView] = useState<FolderViewState>({ layout: 'grid', sort: 'updated' });
  // Latest view, immune to stale closures: two rapid changes (layout then sort)
  // must compose, not overwrite each other.
  const viewRef = useRef(view);
  viewRef.current = view;

  const totalCount = countTree(roots);

  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const openFolder = useCallback(async (folderId: string | null) => {
    setSelected(folderId);
    setItems(null);
    const v = await loadView(folderId);
    setView(v);
    setItems(await loadItems(folderId, v.sort));
  }, []);

  const refreshAll = useCallback(async () => {
    setRoots(await loadFolderTree());
    await openFolder(selectedRef.current);
  }, [openFolder]);

  // Post-write refresh that swaps rows IN PLACE — no null flash, so the table
  // keeps its scroll position, selection, and mounted editors across edits.
  const refreshQuiet = useCallback(async () => {
    setRoots(await loadFolderTree());
    setItems(await loadItems(selectedRef.current, viewRef.current.sort));
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

  const changeView = async (patch: Partial<FolderViewState>): Promise<void> => {
    const next = { ...viewRef.current, ...patch };
    setView(next);
    await saveView(selected, next);
    if (patch.sort) setItems(await loadItems(selected, next.sort));
  };

  const layout = getLayout(view.layout);
  const LayoutComponent = layout.component;
  const folderName = selected === null ? 'Everything' : findName(roots, selected) ?? '…';

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
        <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)' }}>
          <h1 style={{ fontSize: '1.05rem', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{folderName}</h1>
          <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>{items === null ? '…' : items.length.toLocaleString()}</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
            <AddMenu onAdd={(action) => void onAdd(action)} />
            <select
              value={view.sort}
              onChange={(e) => void changeView({ sort: e.target.value as SortKey })}
              style={{ background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0.3rem 0.5rem', fontSize: '0.8rem' }}
            >
              <option value="updated">Recently updated</option>
              <option value="title">Title A–Z</option>
            </select>
            {listLayouts().map((entry) => {
              const Icon = entry.icon;
              const active = entry.key === layout.key;
              return (
                <button
                  key={entry.key}
                  title={entry.label}
                  onClick={() => void changeView({ layout: entry.key })}
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
        </header>

        <div style={{ flex: 1, minHeight: 0, background: 'var(--bg)', position: 'relative' }} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
          {error ? (
            <pre style={{ color: 'var(--ink-blush)', padding: '1rem', whiteSpace: 'pre-wrap' }}>{error}</pre>
          ) : items === null ? null : items.length === 0 && view.layout !== 'table' ? (
            // The table renders even empty: its ghost row IS the add affordance (docs/12).
            <div style={{ padding: '3rem 1rem', textAlign: 'center', color: 'var(--text-dim)' }}>
              <p style={{ fontFamily: 'var(--font-head)', fontSize: '1rem' }}>Nothing here yet</p>
              <p style={{ fontSize: '0.85rem' }}>Add toppings, or open the <a href="?dev" style={{ color: 'var(--accent-ink)' }}>dev harness</a> to seed data.</p>
            </div>
          ) : (
            <LayoutComponent
              items={items}
              loadThumb={loadThumb}
              onOpen={onOpenItem}
              folderId={selected}
              onMutated={refreshQuiet}
              tableConfig={{ columns: view.columns, colSort: view.colSort ?? null }}
              onTableConfig={(patch) => void changeView(patch)}
            />
          )}
          {openNote && (
            <NoteEditor
              key={openNote.path}
              path={openNote.path}
              title={openNote.title}
              onClose={() => setOpenNote(null)}
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
