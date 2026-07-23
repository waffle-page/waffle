/**
 * VirtualGrid — QUARANTINE MODULE (docs/08-code-conventions.md).
 *
 * Why this is hairy: rendering 20,000 cards means never mounting more than the
 * visible ~30. We virtualize by ROW (uniform card aspect → uniform row height),
 * computing the column count from measured width. With `groups`, the row model
 * becomes MIXED — section-header rows between runs of card rows — so sizes go
 * per-index. Invariants:
 *  - DOM node count is O(visible), never O(items).
 *  - Row height derives from column width; both re-derive on resize (measure()).
 *  - `groups` is a contiguous partition of the item order; card indexes are
 *    computed from the model, never searched.
 * True variable-height masonry replaces this in P0 step 5 when real thumbnail
 * aspect ratios exist.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { CARD_META_H } from './ToppingCard';
import type { GroupSection } from './types';

const GAP = 12;
const PAD = 16;
const MIN_CARD = 190;
const HEADER_H = 40;

/** A rendered line: a section header, or `n` cards starting at item index `start`. */
type GridRow = { header: string; count: number } | { start: number; n: number };

export function VirtualGrid({ count, renderItem, groups }: { count: number; renderItem: (index: number) => ReactNode; groups?: GroupSection[] | null }) {
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

  const rowModel = useMemo<GridRow[] | null>(() => {
    if (!groups?.length) return null;
    const rows: GridRow[] = [];
    let index = 0;
    for (const g of groups) {
      rows.push({ header: g.label, count: g.count });
      for (let s = 0; s < g.count; s += cols) rows.push({ start: index + s, n: Math.min(cols, g.count - s) });
      index += g.count;
    }
    return rows;
  }, [groups, cols]);

  const rowCount = rowModel ? rowModel.length : Math.ceil(count / cols);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => (rowModel && 'header' in rowModel[i]! ? HEADER_H : rowHeight),
    overscan: 4,
  });

  useEffect(() => virtualizer.measure(), [rowHeight, rowModel, virtualizer]);

  return (
    <div ref={parentRef} style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((row) => {
          const model: GridRow = rowModel ? rowModel[row.index]! : { start: row.index * cols, n: cols };

          if ('header' in model) {
            return (
              <div
                key={row.key}
                style={{ position: 'absolute', top: 0, left: PAD, right: PAD, height: HEADER_H, transform: `translateY(${row.start}px)`, display: 'flex', alignItems: 'flex-end', gap: 8, paddingBottom: 6, fontWeight: 600, fontSize: '0.8rem', borderBottom: '1px solid var(--border)' }}
              >
                {model.header}
                <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>{model.count}</span>
              </div>
            );
          }

          return (
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
                const index = model.start + col;
                // Definite height is load-bearing: with an auto row track, the
                // card's height:100% chain collapses and image intrinsic sizes
                // overflow the row (cards visually overlapping the next row).
                return (
                  <div key={col} style={{ height: rowHeight - GAP, minWidth: 0 }}>
                    {col < model.n && index < count ? renderItem(index) : null}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
