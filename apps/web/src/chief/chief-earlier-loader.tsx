import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react';
import { useMessageScrollerScrollable } from '../components/ui/message-scroller.js';
import type { ChiefEarlier } from './use-chief-surface.js';

const TOP_EDGE = 8;

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

export function ChiefEarlierLoader({
  earlier,
  hasEarlier,
  rowCount,
  viewportRef,
}: {
  earlier: ChiefEarlier;
  hasEarlier: boolean;
  rowCount: number;
  viewportRef: RefObject<HTMLDivElement | null>;
}) {
  const scrollable = useMessageScrollerScrollable();
  const atTop = !scrollable.start && scrollable.end;
  const anchorRef = useRef<Anchor | null>(null);
  const { loading, onLoad } = earlier;
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!atTop || !hasEarlier || loading || anchorRef.current !== null || viewport === null) return;
    if (viewport.scrollTop > TOP_EDGE) return;
    anchorRef.current = readAnchor(viewport);
    onLoad();
  }, [atTop, hasEarlier, loading, onLoad, viewportRef]);
  const wasLoading = useRef(loading);
  useLayoutEffect(() => {
    const settled = wasLoading.current && !loading;
    wasLoading.current = loading;
    const anchor = anchorRef.current;
    const viewport = viewportRef.current;
    if (!settled || anchor === null || viewport === null) return;
    anchorRef.current = null;
    restoreAnchor(anchor, viewport);
  }, [loading, rowCount, viewportRef]);
  return null;
}
