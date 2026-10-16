// CDS PR-6: jump-to-latest with an independent distance threshold.
// Lives outside the pristine message-scroller registry file (S5).
// Follow pin stays on MessageScrollerProvider.scrollEdgeThreshold={40};
// this button shows past JUMP_THRESHOLD (120px).

import { cn } from 'cn';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../ui/button.js';
import { useMessageScroller } from '../ui/message-scroller.js';

/** CDS stick-to-bottom: pin when distanceFromBottom ≤ 40px (plan SP). */
export const FOLLOW_THRESHOLD = 40;
/** CDS stick-to-bottom: show jump-to-latest past 120px (plan SP). */
export const JUMP_THRESHOLD = 120;

const JUMP_BTN_CLS =
  'absolute inset-s-1/2 -translate-x-1/2 border-border bg-background text-foreground transition-[translate,scale,opacity] duration-200 hover:bg-muted hover:text-foreground data-[active=false]:pointer-events-none data-[active=false]:scale-95 data-[active=false]:opacity-0 data-[active=false]:duration-400 data-[active=false]:ease-[cubic-bezier(0.7,0,0.84,0)] data-[active=true]:translate-y-0 data-[active=true]:scale-100 data-[active=true]:opacity-100 data-[active=true]:ease-[cubic-bezier(0.23,1,0.32,1)] bottom-4 data-[active=false]:translate-y-full rtl:translate-x-1/2';

export function JumpToLatestButton({
  threshold = JUMP_THRESHOLD,
  className,
  children,
  variant = 'secondary',
  size = 'icon-sm',
  ...props
}: {
  threshold?: number;
  className?: string;
  children?: React.ReactNode;
  variant?: React.ComponentProps<typeof Button>['variant'];
  size?: React.ComponentProps<typeof Button>['size'];
} & Omit<React.ComponentProps<'button'>, 'children' | 'className'>) {
  const { scrollToEnd } = useMessageScroller();
  const [active, setActive] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const root = btnRef.current?.closest('[data-slot="message-scroller"]');
    const viewport = root?.querySelector(
      '[data-slot="message-scroller-viewport"]',
    ) as HTMLElement | null;
    if (!viewport) return;
    const sync = () => {
      const dist = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      setActive(dist > threshold);
    };
    sync();
    viewport.addEventListener('scroll', sync, { passive: true });
    const ro = new ResizeObserver(sync);
    ro.observe(viewport);
    const mo = new MutationObserver(sync);
    mo.observe(viewport, { childList: true, subtree: true, characterData: true });
    return () => {
      viewport.removeEventListener('scroll', sync);
      ro.disconnect();
      mo.disconnect();
    };
  }, [threshold]);

  return (
    <Button
      ref={btnRef}
      type="button"
      variant={variant}
      size={size}
      data-slot="message-scroller-jump"
      data-testid="jump-to-latest"
      data-active={active ? 'true' : 'false'}
      data-direction="end"
      aria-hidden={!active}
      tabIndex={active ? 0 : -1}
      className={cn(JUMP_BTN_CLS, className)}
      {...props}
      onClick={(e) => {
        props.onClick?.(e);
        if (e.defaultPrevented) return;
        e.currentTarget.blur();
        scrollToEnd({ behavior: 'smooth' });
      }}
    >
      {children}
    </Button>
  );
}
