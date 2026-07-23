/**
 * VirtualMasonry — QUARANTINE MODULE (docs/08-code-conventions.md).
 *
 * Why this is hairy: Pinterest-style variable-height columns AND an O(visible)
 * DOM at 20k items. TanStack's `lanes` option assigns each item to the
 * shortest column; we supply per-item height from the stored aspect ratio.
 * Invariants:
 *  - DOM node count is O(visible), never O(items).
 *  - Item height = colWidth / clamped aspect + meta; re-derives on resize.
 *  - Width is measured before first paint (useLayoutEffect) — no 1-col flash.
 * The measure/columns logic intentionally mirrors VirtualGrid (2nd occurrence;
 * abstraction waits for the third, per docs/08).
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { CARD_META_H, clampAspect } from './ToppingCard';

const GAP = 12;
const PAD = 16;
const MIN_CARD = 190;

export function VirtualMasonry({
  items,
  renderItem,
}: {
  /** Stable ids + aspect ratios. Ids matter: the virtualizer caches sizes by
   *  key, and without stable keys a list mutation attributes cached heights to
   *  the wrong items (cards visually swallowing their neighbors). */
  items: Array<{ id: string; aspect?: number | null }>;
  renderItem: (index: number) => ReactNode;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const usable = Math.max(width - PAD * 2, MIN_CARD);
  const cols = Math.max(1, Math.floor((usable + GAP) / (MIN_CARD + GAP)));
  const colWidth = (usable - GAP * (cols - 1)) / cols;

  const virtualizer = useVirtualizer({
    count: items.length,
    lanes: cols,
    getScrollElement: () => parentRef.current,
    getItemKey: (i) => items[i]!.id,
    estimateSize: (i) => colWidth / clampAspect(items[i]?.aspect) + CARD_META_H + GAP,
    overscan: 12,
  });

  // Re-measure when geometry OR the item set changes — stale cached sizes are
  // exactly how cards end up visually overlapping after adds/re-sorts.
  useEffect(() => virtualizer.measure(), [colWidth, items, virtualizer]);

  return (
    <div ref={parentRef} style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((v) => (
          <div
            key={v.key}
            style={{
              position: 'absolute',
              top: 0,
              left: PAD + v.lane * (colWidth + GAP),
              width: colWidth,
              height: v.size - GAP,
              transform: `translateY(${v.start}px)`,
            }}
          >
            {renderItem(v.index)}
          </div>
        ))}
      </div>
    </div>
  );
}
