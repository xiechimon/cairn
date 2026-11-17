import { DESKTOP_SHELL_USER_AGENT, type DesktopMenuCommand } from '@cairn/shared';
import { useEffect } from 'react';

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

interface DesktopMenuBridge {
  subscribe: (listener: (command: DesktopMenuCommand) => void) => () => void;
}

export function useDesktopMenu(command: DesktopMenuCommand, run: () => void): void {
  useEffect(() => {
    const menu = (window as Window & { cairnDesktop?: { menu?: DesktopMenuBridge } }).cairnDesktop
      ?.menu;
    return menu?.subscribe((sent) => {
      if (sent === command) run();
    });
  }, [command, run]);
}

interface DesktopWindowControlsBridge {
  setVisible: (visible: boolean) => void;
}

export function setDesktopWindowControlsVisible(visible: boolean): void {
  (
    window as Window & { cairnDesktop?: { windowControls?: DesktopWindowControlsBridge } }
  ).cairnDesktop?.windowControls?.setVisible(visible);
}
