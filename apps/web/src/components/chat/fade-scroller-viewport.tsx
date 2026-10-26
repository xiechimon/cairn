import { useCallback, useRef } from 'react';
import { useScrollFade } from '../../hooks/use-scroll-fade.js';
import { MessageScrollerViewport } from '../ui/message-scroller.js';

type Props = React.ComponentProps<typeof MessageScrollerViewport>;

const INSET_FOCUS_RING =
  'outline-none focus-visible:[outline:2px_solid_var(--focus-ring)] focus-visible:-outline-offset-2';

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
      className={['scroll-fade', INSET_FOCUS_RING, className].filter(Boolean).join(' ')}
      {...props}
    />
  );
}
