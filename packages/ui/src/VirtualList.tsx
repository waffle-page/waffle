import { useRef, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

const ROW_H = 52;

/** Row-virtualized flat list — same O(visible) DOM contract as VirtualGrid. */
export function VirtualList({ count, renderRow }: { count: number; renderRow: (index: number) => ReactNode }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_H,
    overscan: 10,
  });

  return (
    <div ref={parentRef} style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((row) => (
          <div
            key={row.key}
            style={{ position: 'absolute', top: 0, left: 16, right: 16, height: ROW_H, transform: `translateY(${row.start}px)` }}
          >
            {renderRow(row.index)}
          </div>
        ))}
      </div>
    </div>
  );
}
