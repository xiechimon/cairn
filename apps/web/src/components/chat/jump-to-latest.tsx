import { cn } from 'cn';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../ui/button.js';
import { useMessageScroller } from '../ui/message-scroller.js';

export const FOLLOW_THRESHOLD = 40;
export const JUMP_THRESHOLD = 120;

const JUMP_BTN_CLS =
  'absolute bottom-3 inset-s-1/2 size-8 -translate-x-1/2 rounded-full border-0 bg-card text-content-secondary shadow-(--e2) transition-none hover:bg-card hover:text-foreground data-[active=false]:pointer-events-none data-[active=false]:opacity-0 data-[active=true]:opacity-100 rtl:translate-x-1/2';

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
  const followingRef = useRef(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const root = btnRef.current?.closest('[data-slot="message-scroller"]');
    const viewport = root?.querySelector(
      '[data-slot="message-scroller-viewport"]',
    ) as HTMLElement | null;
    if (!viewport) return;
    const sync = () => {
      const dist = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      if (followingRef.current && dist > 2) scrollToEnd({ behavior: 'instant' });
      setActive(dist > threshold);
    };
    const stopFollowing = () => {
      followingRef.current = false;
    };
    sync();
    for (const type of ['wheel', 'touchmove', 'keydown', 'pointerdown']) {
      viewport.addEventListener(type, stopFollowing, { passive: true });
    }
    viewport.addEventListener('scroll', sync, { passive: true });
    const ro = new ResizeObserver(sync);
    ro.observe(viewport);
    for (const child of viewport.children) ro.observe(child);
    const mo = new MutationObserver(sync);
    mo.observe(viewport, { childList: true, subtree: true, characterData: true });
    return () => {
      stopFollowing();
      for (const type of ['wheel', 'touchmove', 'keydown', 'pointerdown']) {
        viewport.removeEventListener(type, stopFollowing);
      }
      viewport.removeEventListener('scroll', sync);
      ro.disconnect();
      mo.disconnect();
    };
  }, [scrollToEnd, threshold]);

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
        followingRef.current = true;
        scrollToEnd({ behavior: 'instant' });
      }}
    >
      {children}
    </Button>
  );
}
