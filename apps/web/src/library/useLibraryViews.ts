/**
 * Saved-view controller for the Library screen.
 *
 * This hook owns view/folder selection, SQL projection loading, and the
 * distinction between two persistence classes:
 *
 *  - ordinary Waffle view state persists in the local `views` config table;
 *  - Obsidian-derived view state additionally writes its owned fields to the
 *    canonical `.base` file, or freezes there when inexpressible.
 *
 * Vault scanning, thumbnail reconciliation, folder picking, and item editors
 * deliberately remain outside this controller.
 */
import { useCallback, useRef, useState } from 'react';
import { getLayout, type GroupSection, type LibraryItem } from '@waffle/ui';
import { getVaultFs } from '../platform/instance';
import { writeBackView, writeBackViewRemoval } from '../importer/baseWriteback';
import {
  createView,
  deleteView,
  listViews,
  loadFolderTree,
  loadGroupSections,
  loadItems,
  renameView,
  saveViewState,
  setDefaultView,
  type FolderNode,
  type FolderView,
  type ViewCfg,
} from './queries';

interface ViewRows {
  items: LibraryItem[];
  groups: GroupSection[] | null;
}

async function queryViewRows(folderId: string | null, view: FolderView): Promise<ViewRows> {
  const loaded = await loadItems(folderId, view.cfg);
  if (view.cfg.groupBy && getLayout(view.layout).groupable) {
    return { ...(await loadGroupSections(folderId, view.cfg.groupBy, loaded)) };
  }
  return { items: loaded, groups: null };
}

function findFolder(roots: FolderNode[], id: string): FolderNode | null {
  for (const root of roots) {
    if (root.id === id) return root;
    const found = findFolder(root.children, id);
    if (found) return found;
  }
  return null;
}

function countTree(roots: FolderNode[]): number {
  let total = 0;
  const walk = (node: FolderNode): void => {
    total += node.count;
    node.children.forEach(walk);
  };
  roots.forEach(walk);
  return total;
}

export function useLibraryViews() {
  const [roots, setRoots] = useState<FolderNode[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [groups, setGroups] = useState<GroupSection[] | null>(null);
  const [views, setViews] = useState<FolderView[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  // A slower query for an old folder/view must never replace a newer
  // projection. Every projection-changing gesture invalidates its predecessor.
  const projectionGeneration = useRef(0);
  // View patches serialize because derived views ultimately edit one canonical
  // .base file. Callers still publish optimistic state before entering this
  // queue, so rapid patches compose without waiting for React or disk.
  const viewPersistenceQueue = useRef<Promise<void>>(Promise.resolve());
  const viewRevision = useRef(0);

  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  // Rapid patches must compose against the latest optimistic state rather
  // than a render-time closure.
  const viewsRef = useRef(views);
  viewsRef.current = views;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  const publishSelected = useCallback((folderId: string | null): void => {
    selectedRef.current = folderId;
    setSelected(folderId);
  }, []);
  const publishViews = useCallback((next: FolderView[]): void => {
    viewsRef.current = next;
    setViews(next);
  }, []);
  const publishActiveId = useCallback((id: string | null): void => {
    activeIdRef.current = id;
    setActiveId(id);
  }, []);

  const activeView = views.find((view) => view.id === activeId) ?? null;
  const currentView = useCallback(
    (): FolderView | null =>
      viewsRef.current.find((view) => view.id === activeIdRef.current) ?? null,
    [],
  );

  const publishProjection = useCallback((
    generation: number,
    loaded: ViewRows,
  ): void => {
    if (projectionGeneration.current !== generation) return;
    setItems(loaded.items);
    setGroups(loaded.groups);
  }, []);

  const openFolder = useCallback(async (folderId: string | null) => {
    const generation = ++projectionGeneration.current;
    publishSelected(folderId);
    setItems(null);
    const list = await listViews(folderId);
    if (projectionGeneration.current !== generation) return;
    const initial = list.find((view) => view.isDefault) ?? list[0]!;
    publishViews(list);
    publishActiveId(initial.id);
    publishProjection(generation, await queryViewRows(folderId, initial));
  }, [publishActiveId, publishProjection, publishSelected, publishViews]);

  const refreshRoots = useCallback(async () => {
    setRoots(await loadFolderTree());
  }, []);

  const refreshAll = useCallback(async () => {
    await refreshRoots();
    await openFolder(selectedRef.current);
  }, [openFolder, refreshRoots]);

  /** Requery in place so table scroll, selection, and mounted editors survive. */
  const refreshQuiet = useCallback(async () => {
    const generation = ++projectionGeneration.current;
    await refreshRoots();
    const view = currentView();
    if (!view) return;
    publishProjection(generation, await queryViewRows(selectedRef.current, view));
  }, [currentView, publishProjection, refreshRoots]);

  const switchView = async (id: string): Promise<void> => {
    const generation = ++projectionGeneration.current;
    publishActiveId(id);
    const view = viewsRef.current.find((candidate) => candidate.id === id);
    if (!view) return;
    publishProjection(generation, await queryViewRows(selectedRef.current, view));
  };

  /** Optimistically patch, persist, mirror to Bases when owned, then requery. */
  const patchActive = async (patch: Partial<ViewCfg> & { layout?: string }): Promise<void> => {
    const current = currentView();
    if (!current) return;
    const folderId = selectedRef.current;
    const { layout, ...cfgPatch } = patch;
    const next: FolderView = {
      ...current,
      layout: layout ?? current.layout,
      cfg: { ...current.cfg, ...cfgPatch },
    };
    publishViews(viewsRef.current.map((view) => view.id === next.id ? next : view));
    const revision = ++viewRevision.current;
    const changesRows =
      'sort' in cfgPatch ||
      'filters' in cfgPatch ||
      'groupBy' in cfgPatch ||
      (layout !== undefined && !!next.cfg.groupBy);
    const generation = changesRows ? ++projectionGeneration.current : null;

    const persist = viewPersistenceQueue.current.catch(() => undefined).then(async () => {
      await saveViewState(next.id, next.layout, next.cfg);

      if (next.cfg.origin) {
        try {
          const result = await writeBackView(await getVaultFs(), next);
          if (
            result === 'synced' &&
            viewRevision.current === revision &&
            selectedRef.current === folderId
          ) {
            publishViews(await listViews(folderId));
          }
        } catch (error) {
          console.warn('base write-back failed', error);
        }
      }

      if (generation !== null) {
        publishProjection(generation, await queryViewRows(folderId, next));
      }
    });
    viewPersistenceQueue.current = persist;
    await persist;
  };

  const createNamedView = async (name: string): Promise<void> => {
    const view = await createView(selectedRef.current, name);
    publishViews([...viewsRef.current, view]);
    await switchView(view.id);
  };

  const deleteNamedView = async (id: string): Promise<void> => {
    const target = viewsRef.current.find((view) => view.id === id);
    if (target?.cfg.origin) {
      try {
        await writeBackViewRemoval(await getVaultFs(), target);
      } catch (error) {
        console.warn('base write-back (removal) failed', error);
      }
    }
    await deleteView(id);
    const remaining = viewsRef.current.filter((view) => view.id !== id);
    publishViews(remaining);
    const fallback = remaining.find((view) => view.isDefault) ?? remaining[0];
    if (fallback) await switchView(fallback.id);
  };

  const setDefaultNamedView = async (id: string): Promise<void> => {
    await setDefaultView(selectedRef.current, id);
    publishViews(viewsRef.current.map((view) => ({ ...view, isDefault: view.id === id })));
  };

  const renameNamedView = async (id: string, name: string): Promise<void> => {
    await renameView(id, name);
    publishViews(viewsRef.current.map((view) => view.id === id ? { ...view, name } : view));
    const renamed = viewsRef.current.find((view) => view.id === id);
    if (renamed?.cfg.origin) {
      try {
        if ((await writeBackView(await getVaultFs(), { ...renamed, name })) === 'synced') {
          publishViews(await listViews(selectedRef.current));
        }
      } catch (error) {
        console.warn('base write-back (rename) failed', error);
      }
    }
  };

  const selectedFolder = selected === null ? null : findFolder(roots, selected);

  return {
    roots,
    selected,
    items,
    groups,
    views,
    activeId,
    activeView,
    folderName: selected === null ? 'Everything' : selectedFolder?.name === '/' ? 'Vault' : selectedFolder?.name ?? '…',
    targetDir: selectedFolder?.vaultPath ?? '',
    totalCount: countTree(roots),
    markItemsLoading: () => setItems(null),
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
  };
}
