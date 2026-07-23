/**
 * VirtualGrid — QUARANTINE MODULE (docs/08-code-conventions.md).
 *
 * Why this is hairy: rendering 20,000 cards means never mounting more than the
 * visible ~30. We virtualize by ROW (uniform card aspect → uniform row height),
 * computing the column count from measured width. Invariants:
 *  - DOM node count is O(visible), never O(items).
 *  - Row height derives from column width; both re-derive on resize (measure()).
 * True variable-height masonry replaces this in P0 step 5 when real thumbnail
 * aspect ratios exist.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { CARD_META_H } from './ToppingCard';

const GAP = 12;
const PAD = 16;
const MIN_CARD = 190;

export function VirtualGrid({ count, renderItem }: { count: number; renderItem: (index: number) => ReactNode }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  // Layout effect: measure BEFORE first paint, or the grid flashes one column.
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
  const rowHeight = colWidth * 0.75 + CARD_META_H + GAP;
  const rows = Math.ceil(count / cols);

  const virtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 4,
  });

  useEffect(() => virtualizer.measure(), [rowHeight, virtualizer]);

  return (
    <div ref={parentRef} style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((row) => (
          <div
            key={row.key}
            style={{
              position: 'absolute',
              top: 0,
              left: PAD,
              right: PAD,
              height: rowHeight - GAP,
              transform: `translateY(${row.start}px)`,
              display: 'grid',
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              gap: GAP,
            }}
          >
            {Array.from({ length: cols }, (_, col) => {
              const index = row.index * cols + col;
              // Definite height is load-bearing: with an auto row track, the
              // card's height:100% chain collapses and image intrinsic sizes
              // overflow the row (cards visually overlapping the next row).
              return (
                <div key={col} style={{ height: rowHeight - GAP, minWidth: 0 }}>
                  {index < count ? renderItem(index) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
