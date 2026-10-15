import {
  MessageScroller as MessageScrollerPrimitive,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
} from '@shadcn/react/message-scroller';
import { cn } from 'cn';
import { ArrowDownIcon } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button.js';
import { useScrollFade } from '../../hooks/use-scroll-fade.js';

/** CDS stick-to-bottom: pin when distanceFromBottom ≤ 40px (plan SP). */
export const FOLLOW_THRESHOLD = 40;
/** CDS stick-to-bottom: show jump-to-latest past 120px (plan SP). */
export const JUMP_THRESHOLD = 120;

function MessageScrollerProvider(
  props: React.ComponentProps<typeof MessageScrollerPrimitive.Provider>,
) {
  return <MessageScrollerPrimitive.Provider {...props} />;
}

function MessageScroller({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Root>) {
  return (
    <MessageScrollerPrimitive.Root
      data-slot="message-scroller"
      className={cn(
        'group/message-scroller relative flex size-full min-h-0 flex-col overflow-hidden',
        className,
      )}
      {...props}
    />
  );
}

function MessageScrollerViewport({
  className,
  ref,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Viewport>) {
  // Wire 7-stop scroll-edge fade (plan SF). Class was a dead `scroll-fade-b`
  // typo; real utility is `.scroll-fade` + useScrollFade CSS vars.
  const fadeRef = React.useRef<HTMLDivElement | null>(null);
  useScrollFade(fadeRef);
  const setRefs = React.useCallback(
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
    <MessageScrollerPrimitive.Viewport
      data-slot="message-scroller-viewport"
      ref={setRefs}
      className={cn(
        'size-full min-h-0 min-w-0 scroll-fade scrollbar-thin scrollbar-gutter-stable overflow-y-auto overscroll-contain contain-content data-autoscrolling:scrollbar-thumb-transparent data-autoscrolling:scrollbar-track-transparent data-pending-scroll:invisible',
        className,
      )}
      {...props}
    />
  );
}

function MessageScrollerContent({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Content>) {
  return (
    <MessageScrollerPrimitive.Content
      data-slot="message-scroller-content"
      className={cn('flex h-max min-h-full flex-col gap-6', className)}
      {...props}
    />
  );
}

function MessageScrollerItem({
  className,
  scrollAnchor = false,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Item>) {
  return (
    <MessageScrollerPrimitive.Item
      data-slot="message-scroller-item"
      scrollAnchor={scrollAnchor}
      className={cn(
        'min-w-0 shrink-0 [contain-intrinsic-size:auto_10rem] [content-visibility:auto]',
        className,
      )}
      {...props}
    />
  );
}

function MessageScrollerButton({
  direction = 'end',
  className,
  children,
  render,
  variant = 'secondary',
  size = 'icon-sm',
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Button> &
  Pick<React.ComponentProps<typeof Button>, 'variant' | 'size'>) {
  return (
    <MessageScrollerPrimitive.Button
      data-slot="message-scroller-button"
      data-direction={direction}
      data-variant={variant}
      data-size={size}
      direction={direction}
      className={cn(
        'absolute inset-s-1/2 -translate-x-1/2 border-border bg-background text-foreground transition-[translate,scale,opacity] duration-200 hover:bg-muted hover:text-foreground data-[active=false]:pointer-events-none data-[active=false]:scale-95 data-[active=false]:opacity-0 data-[active=false]:duration-400 data-[active=false]:ease-[cubic-bezier(0.7,0,0.84,0)] data-[active=true]:translate-y-0 data-[active=true]:scale-100 data-[active=true]:opacity-100 data-[active=true]:ease-[cubic-bezier(0.23,1,0.32,1)] data-[direction=end]:bottom-4 data-[direction=end]:data-[active=false]:translate-y-full data-[direction=start]:top-4 data-[direction=start]:data-[active=false]:-translate-y-full rtl:translate-x-1/2 data-[direction=start]:[&_svg]:rotate-180',
        className,
      )}
      render={render ?? <Button variant={variant} size={size} />}
      {...props}
    >
      {children ?? (
        <>
          <ArrowDownIcon />
          <span className="sr-only">
            {direction === 'end' ? 'Scroll to end' : 'Scroll to start'}
          </span>
        </>
      )}
    </MessageScrollerPrimitive.Button>
  );
}

const JUMP_BTN_CLS =
  'absolute inset-s-1/2 -translate-x-1/2 border-border bg-background text-foreground transition-[translate,scale,opacity] duration-200 hover:bg-muted hover:text-foreground data-[active=false]:pointer-events-none data-[active=false]:scale-95 data-[active=false]:opacity-0 data-[active=false]:duration-400 data-[active=false]:ease-[cubic-bezier(0.7,0,0.84,0)] data-[active=true]:translate-y-0 data-[active=true]:scale-100 data-[active=true]:opacity-100 data-[active=true]:ease-[cubic-bezier(0.23,1,0.32,1)] bottom-4 data-[active=false]:translate-y-full rtl:translate-x-1/2';

/**
 * Jump-to-latest with an independent distance threshold (CDS plan SP:
 * follow pin at FOLLOW_THRESHOLD, jump button past JUMP_THRESHOLD).
 * MessageScrollerButton shares scrollEdgeThreshold for both; this splits them.
 */
function MessageScrollerJumpButton({
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
  const [active, setActive] = React.useState(false);
  const btnRef = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => {
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
      {children ?? (
        <>
          <ArrowDownIcon />
          <span className="sr-only">Scroll to end</span>
        </>
      )}
    </Button>
  );
}

export {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerJumpButton,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
};
