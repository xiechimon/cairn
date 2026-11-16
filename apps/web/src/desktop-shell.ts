import { DESKTOP_SHELL_USER_AGENT } from '@cairn/shared';

export const MAC_DESKTOP_SHELL = 'mac-desktop';

export function markDesktopShell(root: HTMLElement, userAgent: string): boolean {
  if (!userAgent.includes(DESKTOP_SHELL_USER_AGENT)) return false;
  root.dataset.shell = MAC_DESKTOP_SHELL;
  const strip = root.ownerDocument.createElement('div');
  strip.className = 'desktop-drag-strip';
  strip.setAttribute('aria-hidden', 'true');
  root.ownerDocument.body.append(strip);
  return true;
}
