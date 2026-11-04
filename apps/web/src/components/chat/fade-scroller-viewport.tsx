import { useCallback, useRef } from 'react';
import { useScrollFade } from '../../hooks/use-scroll-fade.js';
import { FOCUS_RING_INSET } from '../../lib/focus-ring.js';
import { MessageScrollerViewport } from '../ui/message-scroller.js';

type Props = React.ComponentProps<typeof MessageScrollerViewport>;

export function FadeScrollerViewport({ className, ref, ...props }: Props) {
  const fadeRef = useRef<HTMLDivElement | null>(null);
  useScrollFade(fadeRef);
  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      fadeRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref != null) {
        (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }
    },
    [ref],
  );
  return (
    <MessageScrollerViewport
      ref={setRefs}
      className={['scroll-fade', FOCUS_RING_INSET, className].filter(Boolean).join(' ')}
      {...props}
    />
  );
}
