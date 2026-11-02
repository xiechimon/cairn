import { useLayoutEffect, useRef } from 'react';

const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

export const isEditableTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && target.closest(EDITABLE) !== null;

export const isEditableOutsideChiefDrawer = (target: EventTarget | null): boolean =>
  isEditableTarget(target) &&
  !(target instanceof HTMLElement && target.closest('.chief-drawer') !== null);

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

export function useNewTaskHotkey(onOpen: () => void): void {
  useHotkey('c', isEditableTarget, onOpen);
}
