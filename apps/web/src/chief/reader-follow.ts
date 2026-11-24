import { createContext, useContext, useMemo, useRef } from 'react';
import { flushSync } from 'react-dom';
import { FOLLOW_THRESHOLD } from '../components/chat/jump-to-latest.js';
import { useMessageScroller } from '../components/ui/message-scroller.js';

type ReaderFollow = { readerLeft: boolean; setReaderLeft: (left: boolean) => void };

export const ReaderFollowContext = createContext<ReaderFollow>({
  readerLeft: false,
  setReaderLeft: () => {},
});

export const useReaderLeft = () => useContext(ReaderFollowContext).readerLeft;

const UP_KEYS = new Set(['PageUp', 'Home']);
const DOWN_KEYS = new Set(['ArrowDown', 'PageDown', ' ']);
const QUESTION_OPTION = 'button[data-question-row], [role="checkbox"][data-question-row]';

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
  const { scrollToEnd } = useMessageScroller();
  const returningRef = useRef(false);
  const jumpedRef = useRef(false);
  const followEpochRef = useRef(0);
  const touchYRef = useRef(0);
  return useMemo(() => {
    const stopFollowing = () => {
      returningRef.current = false;
      followEpochRef.current += 1;
      setReaderLeft(true);
    };
    const follow = () => {
      returningRef.current = false;
      jumpedRef.current = false;
      followEpochRef.current += 1;
      setReaderLeft(false);
    };
    const scrollUp = (node: HTMLDivElement, by: number) => {
      if (node.scrollTop <= 0 || gapOf(node) + by <= FOLLOW_THRESHOLD) return;
      flushSync(stopFollowing);
    };
    const scrollDown = (node: HTMLDivElement) => {
      if (gapOf(node) <= FOLLOW_THRESHOLD) follow();
      else returningRef.current = true;
    };
    return {
      pause: () => {
        jumpedRef.current = true;
        stopFollowing();
      },
      follow,
      viewportProps: {
        onWheel: (event: React.WheelEvent<HTMLDivElement>) => {
          if (event.deltaY > 0) scrollDown(event.currentTarget);
          else if (event.deltaY < 0)
            scrollUp(
              event.currentTarget,
              event.deltaMode === 0 ? -event.deltaY : Number.POSITIVE_INFINITY,
            );
        },
        onTouchStart: (event: React.TouchEvent<HTMLDivElement>) => {
          touchYRef.current = event.touches[0]?.clientY ?? 0;
        },
        onTouchMove: (event: React.TouchEvent<HTMLDivElement>) => {
          const dragged = (event.touches[0]?.clientY ?? touchYRef.current) - touchYRef.current;
          if (dragged > 0) scrollUp(event.currentTarget, dragged);
          else if (dragged < 0) scrollDown(event.currentTarget);
        },
        onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
          if (event.defaultPrevented || event.nativeEvent?.isComposing) return;
          const fromViewport = event.target === event.currentTarget;
          const endFromOption =
            !fromViewport &&
            event.key === 'End' &&
            !event.altKey &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.shiftKey &&
            event.target instanceof Element &&
            event.target.matches(QUESTION_OPTION);
          if (!fromViewport && !endFromOption) return;
          if (event.key === 'End') {
            event.preventDefault();
            flushSync(follow);
            scrollToEnd({ behavior: 'instant' });
            return;
          }
          if (UP_KEYS.has(event.key)) scrollUp(event.currentTarget, Number.POSITIVE_INFINITY);
          else if (DOWN_KEYS.has(event.key)) scrollDown(event.currentTarget);
        },
        onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
          if (!jumpedRef.current || event.target === event.currentTarget)
            returningRef.current = true;
        },
        onClickCapture: (event: React.MouseEvent<HTMLDivElement>) => {
          const disclosure =
            event.target instanceof Element ? event.target.closest(DISCLOSURE) : null;
          if (disclosure === null) return;
          const node = event.currentTarget;
          flushSync(stopFollowing);
          if (jumpedRef.current || disclosure.getAttribute('aria-expanded') !== 'true') return;
          const epoch = followEpochRef.current;
          whenHeightSettles(node, () => {
            if (followEpochRef.current === epoch && gapOf(node) <= FOLLOW_THRESHOLD)
              setReaderLeft(false);
          });
        },
        onScroll: (event: React.UIEvent<HTMLDivElement>) => {
          if (!returningRef.current || gapOf(event.currentTarget) > FOLLOW_THRESHOLD) return;
          follow();
        },
      },
    };
  }, [setReaderLeft, scrollToEnd]);
}
