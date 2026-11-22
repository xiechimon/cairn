import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';
import type { useComputerControl } from '../api/use-computer-control.js';
import type { TFunc } from '../i18n/translate.js';

export type ComputerControl = ReturnType<typeof useComputerControl>;

export const HOVER_DWELL_MS = 150;
export const HOVER_RELEASE_MS = 800;
export const LOGIN_RELEASE_MS = 60_000;
export const TOUCH_IDLE_MS = 30_000;

const NOVNC_CAPTURE_ID = 'noVNC_mouse_capture_elem';

export interface ScreenHoverIntent {
  enter: () => void;
  leave: () => void;
  touch: () => void;
  touchOutside: () => void;
  dispose: () => void;
}

export function screenHoverIntent(
  want: (held: boolean) => void,
  loginPending: () => boolean = () => false,
): ScreenHoverIntent {
  let wanted = false;
  let dwell: ReturnType<typeof setTimeout> | undefined;
  let release: ReturnType<typeof setTimeout> | undefined;
  let idle: ReturnType<typeof setTimeout> | undefined;
  const set = (next: boolean) => {
    if (wanted === next) return;
    wanted = next;
    want(next);
  };
  const clearAll = () => {
    clearTimeout(dwell);
    clearTimeout(release);
    clearTimeout(idle);
    dwell = undefined;
    release = undefined;
    idle = undefined;
  };
  return {
    enter: () => {
      clearTimeout(release);
      release = undefined;
      if (wanted || dwell !== undefined) return;
      dwell = setTimeout(() => {
        dwell = undefined;
        set(true);
      }, HOVER_DWELL_MS);
    },
    leave: () => {
      clearTimeout(dwell);
      dwell = undefined;
      if (!wanted || release !== undefined) return;
      release = setTimeout(
        () => {
          release = undefined;
          set(false);
        },
        loginPending() ? LOGIN_RELEASE_MS : HOVER_RELEASE_MS,
      );
    },
    touch: () => {
      clearAll();
      set(true);
      idle = setTimeout(() => {
        idle = undefined;
        set(false);
      }, TOUCH_IDLE_MS);
    },
    touchOutside: () => {
      clearAll();
      set(false);
    },
    dispose: () => {
      clearAll();
      set(false);
    },
  };
}

export interface ScreenPointerProps {
  onPointerEnter: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerLeave: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
}

export interface ScreenHover {
  pointer: ScreenPointerProps;
  leave: () => void;
}

function leaveUnlessDraggingInside(event: ReactPointerEvent<HTMLElement>, leave: () => void): void {
  const surface = event.currentTarget;
  const related = event.relatedTarget;
  if (!(related instanceof Element) || related.id !== NOVNC_CAPTURE_ID) {
    leave();
    return;
  }
  window.addEventListener(
    'pointerup',
    (up) => {
      const under = document.elementFromPoint(up.clientX, up.clientY);
      if (under === null || !surface.contains(under)) leave();
    },
    { once: true },
  );
}

const NO_HOVER_QUERY = '(hover: none)';

function hoversWithMouse(event: ReactPointerEvent<HTMLElement>): boolean {
  return event.pointerType !== 'touch' && !window.matchMedia(NO_HOVER_QUERY).matches;
}

export function useScreenHoverControl(control: ComputerControl, loginPending = false): ScreenHover {
  const [wanted, setWanted] = useState(false);
  const login = useRef(loginPending);
  login.current = loginPending;
  const [intent] = useState(() => screenHoverIntent(setWanted, () => login.current));
  const pendingChange = useRef(false);
  const insideDown = useRef<Event | null>(null);
  const latest = useRef(control);
  latest.current = control;
  const held = control.leaseId !== null;

  const [hover] = useState<ScreenHover>(() => ({
    leave: intent.leave,
    pointer: {
      onPointerEnter: (event) => {
        if (hoversWithMouse(event)) intent.enter();
      },
      onPointerMove: (event) => {
        if (hoversWithMouse(event)) intent.enter();
      },
      onPointerLeave: (event) => {
        if (event.pointerType !== 'touch') leaveUnlessDraggingInside(event, intent.leave);
      },
      onPointerDown: (event) => {
        if (event.pointerType !== 'touch') return;
        insideDown.current = event.nativeEvent;
        intent.touch();
      },
    },
  }));

  useEffect(() => {
    pendingChange.current = true;
  }, [wanted]);

  useEffect(() => {
    if (!pendingChange.current || control.busy) return;
    pendingChange.current = false;
    if (wanted !== held) latest.current.setHeld(wanted);
  }, [wanted, held, control.busy]);

  useEffect(() => {
    if (!wanted) return;
    const onDown = (event: PointerEvent) => {
      if (event.pointerType === 'touch' && event !== insideDown.current) intent.touchOutside();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [wanted, intent]);

  useEffect(
    () => () => {
      intent.dispose();
      if (latest.current.leaseId !== null) latest.current.setHeld(false);
    },
    [intent],
  );

  return hover;
}

const COARSE_QUERY = '(pointer: coarse)';

export function screenControlStatus(control: ComputerControl, t: TFunc): string {
  if (control.failed) return t('未能接管，电脑没有响应');
  if (control.leaseId !== null) return t('你在操作，Coordinator 先等着');
  return window.matchMedia(COARSE_QUERY).matches
    ? t('点击画面即可操作')
    : t('鼠标移进画面就能操作');
}
