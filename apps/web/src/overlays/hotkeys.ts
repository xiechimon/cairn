import { useLayoutEffect, useRef } from 'react';

const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

export const isEditableTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && target.closest(EDITABLE) !== null;

export const isEditableOutsideChiefDrawer = (target: EventTarget | null): boolean =>
  isEditableTarget(target) &&
  !(target instanceof HTMLElement && target.closest('.chief-drawer') !== null);

const TAB_CYCLE_SEATS = ['.new-task-project', '.new-task-spec'];

const isTabCycleSeat = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  TAB_CYCLE_SEATS.some((selector) => target.closest(selector) !== null);

function useHotkey(
  key: string,
  guard: (target: EventTarget | null) => boolean,
  onOpen: () => void,
  enabled = true,
) {
  const guardRef = useRef(guard);
  const onOpenRef = useRef(onOpen);
  useLayoutEffect(() => {
    guardRef.current = guard;
    onOpenRef.current = onOpen;
  });
  useLayoutEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.key !== key) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (guardRef.current(event.target)) return;
      event.preventDefault();
      onOpenRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [key, enabled]);
}

export function useChordHotkey(
  key: string,
  guard: (target: EventTarget | null) => boolean,
  onFire: () => void,
  enabled = true,
) {
  const guardRef = useRef(guard);
  const onFireRef = useRef(onFire);
  useLayoutEffect(() => {
    guardRef.current = guard;
    onFireRef.current = onFire;
  });
  useLayoutEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.repeat) return;
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() !== key) return;
      if (guardRef.current(event.target)) return;
      event.preventDefault();
      onFireRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [key, enabled]);
}

export function useNewTaskHotkey(onOpen: () => void): void {
  useHotkey('c', isEditableTarget, onOpen);
}

export function useChiefNewThreadHotkey(active: boolean, onNewThread: () => void): void {
  useHotkey('n', isEditableTarget, onNewThread, active);
}

export function useProjectCycleHotkey(active: boolean, onCycle: () => void): void {
  useLayoutEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      if (event.defaultPrevented || event.isComposing) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (!isTabCycleSeat(event.target)) return;
      event.preventDefault();
      onCycle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, onCycle]);
}
