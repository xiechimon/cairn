import {
  defaultRangeExtractor,
  type Range,
  type Rect,
  useVirtualizer,
  type VirtualItem,
} from '@tanstack/react-virtual';
import { type ReactNode, type RefObject, useLayoutEffect, useRef, useState } from 'react';
import { FOLLOW_THRESHOLD } from '../components/chat/jump-to-latest.js';
import { safeSessionStorage } from '../safe-storage.js';

const ESTIMATED_ROW_HEIGHT = 120;
const OVERSCAN = 4;

function keepNewestRowMounted(range: Range): number[] {
  const indexes = defaultRangeExtractor(range);
  const newest = range.count - 1;
  if (newest >= 0 && indexes[indexes.length - 1] !== newest) indexes.push(newest);
  return indexes;
}

interface StreamSnapshot {
  items: VirtualItem[];
  rect: Rect | null;
  scrollMargin: number;
}

const snapshots = new Map<string, StreamSnapshot>();
const STORED_ROWS = 200;
const storageKey = (cacheKey: string) => `cairn.chief-stream.${cacheKey}`;

function readSnapshot(cacheKey: string): StreamSnapshot | undefined {
  const cached = snapshots.get(cacheKey);
  if (cached !== undefined || cacheKey === '') return cached;
  try {
    const raw = safeSessionStorage()?.getItem(storageKey(cacheKey));
    return raw == null ? undefined : (JSON.parse(raw) as StreamSnapshot);
  } catch {
    return undefined;
  }
}

function saveSnapshot(cacheKey: string, snapshot: StreamSnapshot): void {
  snapshots.set(cacheKey, snapshot);
  if (cacheKey === '') return;
  try {
    safeSessionStorage()?.setItem(
      storageKey(cacheKey),
      JSON.stringify({ ...snapshot, items: snapshot.items.slice(-STORED_ROWS) }),
    );
  } catch {}
}

export function VirtualStream({
  cacheKey,
  keys,
  renderRow,
  viewportRef,
}: {
  cacheKey: string;
  keys: readonly (string | number)[];
  renderRow: (index: number) => ReactNode;
  viewportRef: RefObject<HTMLDivElement | null>;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [restored] = useState(() => readSnapshot(cacheKey));
  const [scrollMargin, setScrollMargin] = useState(restored?.scrollMargin ?? 0);
  const virtualizer = useVirtualizer({
    count: keys.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    getItemKey: (index) => keys[index] ?? index,
    overscan: OVERSCAN,
    rangeExtractor: keepNewestRowMounted,
    anchorTo: 'end',
    initialOffset: Number.MAX_SAFE_INTEGER,
    initialMeasurementsCache: restored?.items ?? [],
    ...(restored?.rect != null ? { initialRect: restored.rect } : {}),
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
  useLayoutEffect(() => {
    const viewport = listRef.current?.closest<HTMLElement>(
      '[data-slot="message-scroller-viewport"]',
    );
    if (viewport != null) viewport.scrollTop = viewport.scrollHeight;
  }, []);
  useLayoutEffect(
    () => () => {
      saveSnapshot(cacheKey, {
        items: virtualizer.takeSnapshot(),
        rect: virtualizer.scrollRect,
        scrollMargin: virtualizer.options.scrollMargin,
      });
    },
    [cacheKey, virtualizer],
  );
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
