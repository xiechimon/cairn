import {
  defaultRangeExtractor,
  measureElement,
  type Range,
  type Rect,
  useVirtualizer,
  type VirtualItem,
} from '@tanstack/react-virtual';
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { FOLLOW_THRESHOLD } from '../components/chat/jump-to-latest.js';
import {
  useMessageScroller,
  useMessageScrollerScrollable,
} from '../components/ui/message-scroller.js';
import { readScrollFadeSize } from '../hooks/use-scroll-fade.js';
import { safeSessionStorage } from '../safe-storage.js';
import { useReaderLeft } from './reader-follow.js';

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

export interface VirtualStreamScrollTarget {
  index: number;
  onMounted: (node: HTMLElement) => void;
}

export function VirtualStream({
  cacheKey,
  keys,
  renderRow,
  viewportRef,
  scrollTarget,
}: {
  cacheKey: string;
  keys: readonly (string | number)[];
  renderRow: (index: number) => ReactNode;
  viewportRef: RefObject<HTMLDivElement | null>;
  scrollTarget?: VirtualStreamScrollTarget;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [restored] = useState(() => readSnapshot(cacheKey));
  const [scrollMargin, setScrollMargin] = useState(restored?.scrollMargin ?? 0);
  const scrollPaddingStart = useRef(0);
  const [observedSizes] = useState(() => new WeakMap<Element, number>());
  const scheduleReadBack = useRef<(() => void) | null>(null);
  const { end } = useMessageScrollerScrollable();
  const { scrollToEnd } = useMessageScroller();
  const readerLeft = useReaderLeft();
  const virtualizer = useVirtualizer({
    count: keys.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    measureElement: (node, entry, instance) => {
      const size = measureElement(node, entry, instance);
      if (entry !== undefined) {
        observedSizes.set(node, size);
        scheduleReadBack.current?.();
      }
      return size;
    },
    getItemKey: (index) => keys[index] ?? index,
    overscan: OVERSCAN,
    rangeExtractor: keepNewestRowMounted,
    anchorTo: 'end',
    initialOffset: readerLeft ? 0 : Number.MAX_SAFE_INTEGER,
    initialMeasurementsCache: restored?.items ?? [],
    ...(restored?.rect != null ? { initialRect: restored.rect } : {}),
    scrollEndThreshold: readerLeft ? -1 : FOLLOW_THRESHOLD,
    scrollMargin,
    scrollPaddingStart: scrollPaddingStart.current,
  });
  const measureNewestRow = useCallback(
    (node: HTMLDivElement | null) => {
      virtualizer.measureElement(node);
      if (node !== null)
        virtualizer.resizeItem(virtualizer.indexFromElement(node), node.offsetHeight);
    },
    [virtualizer],
  );
  useLayoutEffect(() => {
    if (!end && !readerLeft) scrollToEnd();
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
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null || scrollTarget === undefined) return;
    scrollPaddingStart.current = readScrollFadeSize(viewport, 'top');
    virtualizer.setOptions({
      ...virtualizer.options,
      scrollPaddingStart: scrollPaddingStart.current,
    });
    const { index, onMounted } = scrollTarget;
    let frame: number | null = null;
    let previous: { node: HTMLElement; geometry: number[] } | null = null;
    const schedule = () => {
      frame ??= requestAnimationFrame(readBack);
    };
    const stop = () => {
      scheduleReadBack.current = null;
      viewport.removeEventListener('scroll', schedule);
      if (frame !== null) cancelAnimationFrame(frame);
    };
    const readBack = () => {
      frame = null;
      const items = virtualizer.getVirtualItems();
      const target = items.find((item) => item.index === index);
      const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`);
      const [offset] = virtualizer.getOffsetForIndex(index, 'start') ?? [];
      const { scrollTop } = viewport;
      const { scrollOffset } = virtualizer;
      const measured = items.every((item) => {
        if (item.index > index) return true;
        const element = virtualizer.elementsCache.get(item.key);
        return element !== undefined && observedSizes.get(element) === item.size;
      });
      if (
        target !== undefined &&
        node != null &&
        node === virtualizer.elementsCache.get(target.key) &&
        measured &&
        offset !== undefined &&
        scrollOffset !== null &&
        Math.abs(scrollTop - offset) <= 1 &&
        Math.abs(scrollOffset - offset) <= 1
      ) {
        const geometry = [offset, scrollTop, scrollOffset, target.start, target.size];
        if (
          previous?.node === node &&
          previous.geometry.every((value, i) => value === geometry[i])
        ) {
          stop();
          onMounted(node);
          return;
        }
        previous = { node, geometry };
        schedule();
      } else previous = null;
    };
    scheduleReadBack.current = schedule;
    viewport.addEventListener('scroll', schedule, { passive: true });
    virtualizer.scrollToIndex(index, { align: 'start' });
    schedule();
    return stop;
  }, [observedSizes, scrollPaddingStart, scrollTarget, viewportRef, virtualizer]);
  useLayoutEffect(() => {
    scheduleReadBack.current?.();
  });
  return (
    <div
      ref={listRef}
      data-testid="chief-virtual-rows"
      className="relative w-full shrink-0 [overflow-anchor:none]"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((item) => (
        <div
          key={item.key}
          data-index={item.index}
          ref={item.index === keys.length - 1 ? measureNewestRow : virtualizer.measureElement}
          className="absolute top-0 left-0 flex w-full min-w-0 flex-col"
          style={{ transform: `translateY(${item.start - scrollMargin}px)` }}
        >
          {renderRow(item.index)}
        </div>
      ))}
    </div>
  );
}
