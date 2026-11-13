import { useVirtualizer } from '@tanstack/react-virtual';
import { type ReactNode, type RefObject, useLayoutEffect, useRef, useState } from 'react';
import { FOLLOW_THRESHOLD } from '../components/chat/jump-to-latest.js';

const ESTIMATED_ROW_HEIGHT = 120;
const OVERSCAN = 4;

export function VirtualStream({
  keys,
  renderRow,
  viewportRef,
}: {
  keys: readonly (string | number)[];
  renderRow: (index: number) => ReactNode;
  viewportRef: RefObject<HTMLDivElement | null>;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const virtualizer = useVirtualizer({
    count: keys.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    getItemKey: (index) => keys[index] ?? index,
    overscan: OVERSCAN,
    anchorTo: 'end',
    initialOffset: Number.MAX_SAFE_INTEGER,
    scrollEndThreshold: FOLLOW_THRESHOLD,
    scrollMargin,
  });
  useLayoutEffect(() => {
    const list = listRef.current;
    const viewport = viewportRef.current;
    if (list === null || viewport === null) return;
    const top = Math.round(
      list.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop,
    );
    if (top !== scrollMargin) setScrollMargin(top);
  });
  return (
    <div
      ref={listRef}
      data-testid="chief-virtual-rows"
      className="relative w-full shrink-0"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((item) => (
        <div
          key={item.key}
          data-index={item.index}
          ref={virtualizer.measureElement}
          className="absolute top-0 left-0 flex w-full min-w-0 flex-col"
          style={{ transform: `translateY(${item.start - scrollMargin}px)` }}
        >
          {renderRow(item.index)}
        </div>
      ))}
    </div>
  );
}
