import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef } from 'react';

const LOAD_EDGE = 200;
const READER_EVENTS = ['scroll', 'wheel', 'touchmove'] as const;

interface Anchor {
  element: Element | null;
  offset: number;
  scrollTop: number;
  scrollHeight: number;
}

function offsetIn(element: Element, viewport: HTMLElement): number {
  return element.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
}

function readAnchor(viewport: HTMLElement): Anchor {
  const top = viewport.getBoundingClientRect().top;
  const element =
    [...viewport.querySelectorAll('[data-slot="message-scroller-item"]')].find(
      (item) => item.getBoundingClientRect().bottom > top,
    ) ?? null;
  return {
    element,
    offset: element === null ? 0 : offsetIn(element, viewport),
    scrollTop: viewport.scrollTop,
    scrollHeight: viewport.scrollHeight,
  };
}

function restoreAnchor(anchor: Anchor, viewport: HTMLElement): void {
  if (anchor.element?.isConnected) {
    viewport.scrollTop += offsetIn(anchor.element, viewport) - anchor.offset;
    return;
  }
  viewport.scrollTop = anchor.scrollTop + viewport.scrollHeight - anchor.scrollHeight;
}

function wantsEarlier(viewport: HTMLElement): boolean {
  if (viewport.clientHeight === 0) return false;
  const fits = viewport.scrollHeight <= viewport.clientHeight;
  return fits || viewport.scrollTop <= LOAD_EDGE;
}

export interface EarlierPages {
  loading: boolean;
  failed: boolean;
  onLoad: () => void;
}

export function EarlierLoader({
  earlier,
  hasEarlier,
  rowCount,
  viewportRef,
}: {
  earlier: EarlierPages;
  hasEarlier: boolean;
  rowCount: number;
  viewportRef: RefObject<HTMLDivElement | null>;
}) {
  const anchorRef = useRef<Anchor | null>(null);
  const { loading, failed, onLoad } = earlier;
  const maybeLoad = useCallback(
    (byScroll: boolean) => {
      const viewport = viewportRef.current;
      if (viewport === null) return;
      if (anchorRef.current !== null) {
        anchorRef.current = readAnchor(viewport);
        return;
      }
      if (!hasEarlier || loading || (failed && !byScroll) || !wantsEarlier(viewport)) return;
      anchorRef.current = readAnchor(viewport);
      onLoad();
    },
    [hasEarlier, loading, failed, onLoad, viewportRef],
  );
  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) return;
    maybeLoad(false);
    const byReader = () => maybeLoad(true);
    for (const type of READER_EVENTS) {
      viewport.addEventListener(type, byReader, { passive: true });
    }
    return () => {
      for (const type of READER_EVENTS) viewport.removeEventListener(type, byReader);
    };
  }, [maybeLoad, rowCount, viewportRef]);
  const wasLoading = useRef(loading);
  const lastRowCount = useRef(rowCount);
  useLayoutEffect(() => {
    const settled = !loading && (wasLoading.current || lastRowCount.current !== rowCount);
    wasLoading.current = loading;
    lastRowCount.current = rowCount;
    const anchor = anchorRef.current;
    const viewport = viewportRef.current;
    if (!settled || anchor === null || viewport === null) return;
    anchorRef.current = null;
    restoreAnchor(anchor, viewport);
    requestAnimationFrame(() => restoreAnchor(anchor, viewport));
  }, [loading, rowCount, viewportRef]);
  return null;
}
