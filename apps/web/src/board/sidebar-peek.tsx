import { PanelLeft } from 'lucide-react';
import { type PointerEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';

const OPEN_DELAY_MS = 250;
const CLOSE_DELAY_MS = 300;
const OPEN_MENU = '[data-slot="dropdown-menu-content"][data-open]';

const menuOpen = () => document.querySelector(OPEN_MENU) != null;

export function SidebarPeek({
  armed: startArmed,
  onExpand,
  children,
}: {
  armed: boolean;
  onExpand: () => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const hovered = useRef(false);
  const armed = useRef(startArmed);
  const focusPanel = useRef(false);
  const focusTrigger = useRef(false);
  const quietFocus = useRef(false);
  const opening = useRef(false);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    if (open && focusPanel.current) {
      focusPanel.current = false;
      panelRef.current?.querySelector<HTMLElement>('.sidebar-team-collapse')?.focus();
    }
    if (!open && focusTrigger.current) {
      focusTrigger.current = false;
      quietFocus.current = true;
      triggerRef.current?.focus();
    }
  }, [open]);

  const schedule = (run: () => void, ms: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(run, ms);
  };
  const closeUnlessHeld = () => {
    if (
      hovered.current ||
      menuOpen() ||
      panelRef.current?.querySelector(':focus-visible') != null
    ) {
      return;
    }
    setOpen(false);
  };
  const moveOnTrigger = (event: PointerEvent) => {
    if (event.pointerType === 'touch' || !armed.current || opening.current || open) return;
    hovered.current = true;
    opening.current = true;
    schedule(() => {
      opening.current = false;
      setOpen(true);
    }, OPEN_DELAY_MS);
  };
  const enterPanel = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return;
    hovered.current = true;
    opening.current = false;
    window.clearTimeout(timer.current);
  };
  const overPanel = (event: PointerEvent) =>
    event.clientX >= 0 &&
    event.clientX < (panelRef.current?.offsetWidth ?? 0) &&
    event.clientY >= 0 &&
    event.clientY < window.innerHeight;
  const leave = (event: PointerEvent) => {
    armed.current = true;
    opening.current = false;
    if (event.pointerType === 'touch' || (open && overPanel(event))) return;
    hovered.current = false;
    schedule(closeUnlessHeld, CLOSE_DELAY_MS);
  };

  return (
    <>
      <Button
        ref={triggerRef}
        variant="ghost"
        data-testid="sidebar-reopen"
        className={`fixed top-2.5 left-2.5 z-(--z-floating) size-7 text-content-tertiary ${open ? 'invisible' : ''}`}
        aria-label={t('展开侧边栏')}
        onClick={onExpand}
        onPointerMove={moveOnTrigger}
        onPointerLeave={leave}
        onFocus={(event) => {
          if (quietFocus.current) {
            quietFocus.current = false;
            return;
          }
          if (!event.currentTarget.matches(':focus-visible')) return;
          focusPanel.current = true;
          window.clearTimeout(timer.current);
          setOpen(true);
        }}
      >
        <PanelLeft className="size-5.5" strokeWidth={1.75} />
      </Button>
      <div
        aria-hidden
        data-testid="sidebar-peek-edge"
        className="fixed inset-y-0 left-0 z-(--z-floating) w-2"
        onPointerMove={moveOnTrigger}
        onPointerLeave={leave}
      />
      <section
        ref={panelRef}
        aria-label={t('侧边栏')}
        data-testid="sidebar-peek"
        data-open={open ? '' : undefined}
        inert={!open}
        className="invisible fixed inset-y-0 left-0 z-(--z-floating) flex -translate-x-full opacity-0 shadow-(--e3) transition-[translate,opacity,visibility] duration-(--dur-fast) ease-(--ease-standard) motion-reduce:transition-none data-open:visible data-open:translate-x-0 data-open:opacity-100 data-open:transition-[translate,opacity]"
        onPointerEnter={enterPanel}
        onPointerLeave={leave}
        onBlur={(event) => {
          if (
            event.relatedTarget instanceof Node &&
            event.currentTarget.contains(event.relatedTarget)
          ) {
            return;
          }
          schedule(closeUnlessHeld, 0);
        }}
        onKeyDownCapture={(event) => {
          if (event.key !== 'Escape' || menuOpen()) return;
          hovered.current = false;
          focusTrigger.current = true;
          window.clearTimeout(timer.current);
          setOpen(false);
        }}
      >
        {children}
      </section>
    </>
  );
}
