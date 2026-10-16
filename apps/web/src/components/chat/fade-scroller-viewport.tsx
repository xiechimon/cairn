// CDS PR-6: wire useScrollFade onto the MessageScroller viewport without
// editing the pristine registry message-scroller.tsx (S5). Call sites pass
// className including `scroll-fade` (replacing the dead `scroll-fade-b` that
// still ships on the registry Viewport default — our className appends the
// live utility; both can coexist harmlessly).

import { useCallback, useRef } from 'react';
import { useScrollFade } from '../../hooks/use-scroll-fade.js';
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
      className={['scroll-fade', className].filter(Boolean).join(' ')}
      {...props}
    />
  );
}
