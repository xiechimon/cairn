import { createContext, useContext, useMemo, useRef } from 'react';
import { flushSync } from 'react-dom';
import { FOLLOW_THRESHOLD } from '../components/chat/jump-to-latest.js';

type ReaderFollow = { readerLeft: boolean; setReaderLeft: (left: boolean) => void };

export const ReaderFollowContext = createContext<ReaderFollow>({
  readerLeft: false,
  setReaderLeft: () => {},
});

export const useReaderLeft = () => useContext(ReaderFollowContext).readerLeft;

const UP_KEYS = new Set(['PageUp', 'Home']);
const DOWN_KEYS = new Set(['ArrowDown', 'PageDown', 'End', ' ']);

const gapOf = (node: HTMLElement) => node.scrollHeight - node.scrollTop - node.clientHeight;

const DISCLOSURE = '[aria-expanded]:not([aria-haspopup])';
const SETTLED_FRAMES = 3;
const MAX_SETTLE_FRAMES = 120;

export function whenHeightSettles(node: { scrollHeight: number }, then: () => void) {
  const from = node.scrollHeight;
  let last = -1;
  let still = 0;
  let moved = false;
  let frames = 0;
  const tick = () => {
    const height = node.scrollHeight;
    moved ||= height !== from;
    still = moved && height === last ? still + 1 : 0;
    last = height;
    frames += 1;
    if ((moved && still >= SETTLED_FRAMES) || frames >= MAX_SETTLE_FRAMES) then();
    else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export function useReaderFollow() {
  const { setReaderLeft } = useContext(ReaderFollowContext);
  const returningRef = useRef(false);
  const touchYRef = useRef(0);
  return useMemo(() => {
    const scrollUp = (node: HTMLDivElement, by: number) => {
      if (node.scrollTop <= 0 || gapOf(node) + by <= FOLLOW_THRESHOLD) return;
      returningRef.current = false;
      flushSync(() => setReaderLeft(true));
    };
    const scrollDown = () => {
      returningRef.current = true;
    };
    return {
      follow: () => {
        returningRef.current = false;
        setReaderLeft(false);
      },
      viewportProps: {
        onWheel: (event: React.WheelEvent<HTMLDivElement>) => {
          if (event.deltaY > 0) scrollDown();
          else if (event.deltaY < 0)
            scrollUp(
              event.currentTarget,
              event.deltaMode === 0 ? -event.deltaY : Number.POSITIVE_INFINITY,
            );
        },
        onTouchStartCapture: (event: React.TouchEvent<HTMLDivElement>) => {
          touchYRef.current = event.touches[0]?.clientY ?? 0;
        },
        onTouchMove: (event: React.TouchEvent<HTMLDivElement>) => {
          const dragged = (event.touches[0]?.clientY ?? touchYRef.current) - touchYRef.current;
          if (dragged > 0) scrollUp(event.currentTarget, dragged);
          else if (dragged < 0) scrollDown();
        },
        onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
          if (UP_KEYS.has(event.key)) scrollUp(event.currentTarget, Number.POSITIVE_INFINITY);
          else if (DOWN_KEYS.has(event.key)) scrollDown();
        },
        onPointerDown: scrollDown,
        onClickCapture: (event: React.MouseEvent<HTMLDivElement>) => {
          const disclosure =
            event.target instanceof Element ? event.target.closest(DISCLOSURE) : null;
          if (disclosure === null) return;
          const node = event.currentTarget;
          returningRef.current = false;
          flushSync(() => setReaderLeft(true));
          if (disclosure.getAttribute('aria-expanded') !== 'true') return;
          whenHeightSettles(node, () => {
            if (gapOf(node) <= FOLLOW_THRESHOLD) setReaderLeft(false);
          });
        },
        onScroll: (event: React.UIEvent<HTMLDivElement>) => {
          if (!returningRef.current || gapOf(event.currentTarget) > FOLLOW_THRESHOLD) return;
          returningRef.current = false;
          setReaderLeft(false);
        },
      },
    };
  }, [setReaderLeft]);
}
