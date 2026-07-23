/**
 * Pointer/keyboard session boundary for table column presentation.
 *
 * Invariants:
 *  - Title never participates;
 *  - pointer motion changes draft state only;
 *  - release/drop emits at most one complete `{key,width}[]` config;
 *  - window listeners survive the initiating DOM node moving or unmounting
 *    and are always removed on finish, cancel, or component unmount.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  normalizeTableColumnWidth,
  type TableColumnConfig,
} from './types';

type DropTarget = { key: string; edge: 'before' | 'after' };

export function useTableColumnInteractions(
  columns: TableColumnConfig[],
  onColumnsChange: ((columns: TableColumnConfig[]) => void) | undefined,
) {
  const [resizeDraft, setResizeDraft] = useState<{ key: string; width: number } | null>(null);
  const [draggedKey, setDraggedKey] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const resizeSession = useRef<{ key: string; startX: number; startWidth: number; width: number } | null>(null);
  const resizeCleanup = useRef<(() => void) | null>(null);
  const columnDragCleanup = useRef<(() => void) | null>(null);
  const dropTargetRef = useRef<DropTarget | null>(null);
  const suppressHeaderClick = useRef(false);

  const columnWidths = useMemo(
    () => columns.map((column) => resizeDraft?.key === column.key ? resizeDraft.width : column.width),
    [columns, resizeDraft],
  );

  const persistColumnWidth = (key: string, width: number): void => {
    const normalized = normalizeTableColumnWidth(width);
    if (columns.find((column) => column.key === key)?.width === normalized) return;
    onColumnsChange?.(columns.map((column) => ({
      key: column.key,
      width: column.key === key ? normalized : column.width,
    })));
  };

  const startColumnResize = (event: ReactPointerEvent<HTMLSpanElement>, column: TableColumnConfig): void => {
    if (!onColumnsChange) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus({ preventScroll: true });
    const pointerId = event.pointerId;
    resizeSession.current = {
      key: column.key,
      startX: event.clientX,
      startWidth: column.width,
      width: column.width,
    };
    setResizeDraft({ key: column.key, width: column.width });

    const cleanup = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancel);
      resizeCleanup.current = null;
    };
    const move = (moveEvent: globalThis.PointerEvent): void => {
      const session = resizeSession.current;
      if (!session || moveEvent.pointerId !== pointerId) return;
      moveEvent.preventDefault();
      const width = normalizeTableColumnWidth(session.startWidth + moveEvent.clientX - session.startX);
      session.width = width;
      setResizeDraft({ key: session.key, width });
    };
    const finish = (finishEvent: globalThis.PointerEvent): void => {
      const session = resizeSession.current;
      if (!session || finishEvent.pointerId !== pointerId) return;
      session.width = normalizeTableColumnWidth(session.startWidth + finishEvent.clientX - session.startX);
      cleanup();
      resizeSession.current = null;
      setResizeDraft(null);
      persistColumnWidth(session.key, session.width);
    };
    const cancel = (cancelEvent: globalThis.PointerEvent): void => {
      if (cancelEvent.pointerId !== pointerId) return;
      cleanup();
      resizeSession.current = null;
      setResizeDraft(null);
    };
    resizeCleanup.current?.();
    resizeCleanup.current = cleanup;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', cancel);
  };

  const dropColumn = (sourceKey: string, targetKey: string, edge: DropTarget['edge']): void => {
    if (!onColumnsChange || sourceKey === targetKey) return;
    const source = columns.find((column) => column.key === sourceKey);
    if (!source) return;
    const remaining = columns.filter((column) => column.key !== sourceKey);
    const targetIndex = remaining.findIndex((column) => column.key === targetKey);
    if (targetIndex < 0) return;
    const insertAt = targetIndex + (edge === 'after' ? 1 : 0);
    const reordered = [...remaining.slice(0, insertAt), source, ...remaining.slice(insertAt)];
    if (reordered.every((column, index) => column.key === columns[index]?.key)) return;
    onColumnsChange(reordered.map(({ key, width }) => ({ key, width })));
  };

  const startColumnDrag = (event: ReactPointerEvent<HTMLDivElement>, column: TableColumnConfig): void => {
    if (!onColumnsChange || event.button !== 0) return;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    let dragging = false;

    const cleanup = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancel);
      columnDragCleanup.current = null;
    };
    const targetAt = (clientX: number, clientY: number): DropTarget | null => {
      const element = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('[data-table-column-key]');
      const key = element?.dataset.tableColumnKey;
      if (!element || !key || key === column.key) return null;
      const rect = element.getBoundingClientRect();
      return { key, edge: clientX < rect.left + rect.width / 2 ? 'before' : 'after' };
    };
    const move = (moveEvent: globalThis.PointerEvent): void => {
      if (moveEvent.pointerId !== pointerId) return;
      if (!dragging && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 6) return;
      moveEvent.preventDefault();
      dragging = true;
      setDraggedKey(column.key);
      const target = targetAt(moveEvent.clientX, moveEvent.clientY);
      dropTargetRef.current = target;
      setDropTarget(target);
    };
    const finish = (finishEvent: globalThis.PointerEvent): void => {
      if (finishEvent.pointerId !== pointerId) return;
      cleanup();
      if (dragging) {
        finishEvent.preventDefault();
        const target = dropTargetRef.current ?? targetAt(finishEvent.clientX, finishEvent.clientY);
        if (target) dropColumn(column.key, target.key, target.edge);
        suppressHeaderClick.current = true;
        window.setTimeout(() => {
          suppressHeaderClick.current = false;
        }, 0);
      }
      dropTargetRef.current = null;
      setDraggedKey(null);
      setDropTarget(null);
    };
    const cancel = (cancelEvent: globalThis.PointerEvent): void => {
      if (cancelEvent.pointerId !== pointerId) return;
      cleanup();
      dropTargetRef.current = null;
      setDraggedKey(null);
      setDropTarget(null);
    };
    columnDragCleanup.current?.();
    columnDragCleanup.current = cleanup;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', cancel);
  };

  useEffect(() => () => {
    resizeCleanup.current?.();
    columnDragCleanup.current?.();
  }, []);

  return {
    columnWidths,
    draggedKey,
    dropTarget,
    resizeDraft,
    persistColumnWidth,
    startColumnDrag,
    startColumnResize,
    suppressesHeaderClick: () => suppressHeaderClick.current,
  };
}
