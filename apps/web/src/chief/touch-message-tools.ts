import { useEffect } from 'react';

export const TOOLS_OPEN_ATTR = 'data-tools-open';

const MESSAGE_SELECTOR = '[data-testid="chief-msg"], [data-tools-root]';
const INTERACTIVE_SELECTOR =
  'a, button, input, textarea, select, summary, label, [role="button"], [role="menuitem"], [contenteditable="true"]';
const COARSE_QUERY = '(pointer: coarse)';

function closeAll(root: HTMLElement, keep: Element | null): void {
  for (const open of root.querySelectorAll(`[${TOOLS_OPEN_ATTR}]`)) {
    if (open !== keep) open.removeAttribute(TOOLS_OPEN_ATTR);
  }
}

export function useTouchMessageTools(root: HTMLElement | null): void {
  useEffect(() => {
    if (root === null) return;
    const coarse = window.matchMedia(COARSE_QUERY);
    const onClick = (event: MouseEvent) => {
      if (!coarse.matches || !(event.target instanceof Element)) return;
      const message = event.target.closest(MESSAGE_SELECTOR);
      if (event.target.closest(INTERACTIVE_SELECTOR) !== null) {
        if (message === null) closeAll(root, null);
        return;
      }
      if (window.getSelection()?.isCollapsed === false) return;
      closeAll(root, message);
      if (message === null) return;
      if (message.hasAttribute(TOOLS_OPEN_ATTR)) message.removeAttribute(TOOLS_OPEN_ATTR);
      else message.setAttribute(TOOLS_OPEN_ATTR, '');
    };
    const onContextMenu = (event: MouseEvent) => {
      if (!coarse.matches || !(event.target instanceof Element)) return;
      const message = event.target.closest(MESSAGE_SELECTOR);
      if (message === null) return;
      closeAll(root, message);
      message.setAttribute(TOOLS_OPEN_ATTR, '');
    };
    root.addEventListener('click', onClick);
    root.addEventListener('contextmenu', onContextMenu);
    return () => {
      root.removeEventListener('click', onClick);
      root.removeEventListener('contextmenu', onContextMenu);
    };
  }, [root]);
}
