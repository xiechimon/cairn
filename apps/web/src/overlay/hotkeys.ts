import { useLayoutEffect } from 'react';

const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

export const isEditableTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && target.closest(EDITABLE) !== null;

const COMPOSE_TARGET_ATTR = 'data-compose-target';

const BLOCKING_LAYER =
  '.overlay, [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

const isTypedCharacter = (event: KeyboardEvent): boolean =>
  (event.key.length === 1 && event.key !== ' ') || event.key === 'Process';

const blockingLayerOpen = (): boolean =>
  [...document.querySelectorAll(BLOCKING_LAYER)].some((el) => el.checkVisibility());

function isOnTop(el: HTMLElement): boolean {
  const box = el.getBoundingClientRect();
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  const surface = el.closest('.composer, .chief-composer') ?? el;
  return hit !== null && surface.contains(hit);
}

function visibleComposeTarget(): HTMLTextAreaElement | null {
  const usable = [
    ...document.querySelectorAll<HTMLTextAreaElement>(`textarea[${COMPOSE_TARGET_ATTR}]`),
  ].filter((el) => !el.readOnly && !el.disabled && el.checkVisibility() && isOnTop(el));
  return usable[0] ?? null;
}

export function useTypeToFocus(
  fieldNow: () => HTMLInputElement | HTMLTextAreaElement | null,
  blocked: () => boolean,
): void {
  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (!isTypedCharacter(event)) return;
      if (isEditableTarget(event.target)) return;
      if (blocked()) return;
      const field = fieldNow();
      if (field === null) return;
      field.focus({ preventScroll: true });
      const end = field.value.length;
      field.setSelectionRange(end, end);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fieldNow, blocked]);
}

export function useTypeToCompose(): void {
  useTypeToFocus(visibleComposeTarget, blockingLayerOpen);
}
