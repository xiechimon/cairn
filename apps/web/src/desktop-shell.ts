import {
  DESKTOP_SHELL_USER_AGENT,
  DESKTOP_TRAY_PATH,
  type DesktopMenuCommand,
  type DesktopNotifyPayload,
  type DesktopNotifySound,
  type DesktopTrayOpen,
  type DesktopTrayState,
} from '@cairn/shared';
import { useEffect } from 'react';

export const MAC_DESKTOP_SHELL = 'mac-desktop';
export const MAC_TRAY_SHELL = 'mac-tray';

export function markDesktopShell(root: HTMLElement, userAgent: string, pathname: string): boolean {
  if (!userAgent.includes(DESKTOP_SHELL_USER_AGENT)) return false;
  if (pathname === DESKTOP_TRAY_PATH) {
    root.dataset.shell = MAC_TRAY_SHELL;
    return true;
  }
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

interface DesktopNotifyBridge {
  show: (payload: DesktopNotifyPayload) => void;
  preview?: (sound: DesktopNotifySound) => void;
}

export function desktopNotify(): DesktopNotifyBridge | null {
  if (typeof window === 'undefined') return null;
  return (
    (window as Window & { cairnDesktop?: { notify?: DesktopNotifyBridge } }).cairnDesktop?.notify ??
    null
  );
}

interface DesktopNavigateBridge {
  subscribe: (listener: (path: string) => void) => () => void;
}

export function followDesktopNavigation(navigate: (path: string) => void): void {
  (
    window as Window & { cairnDesktop?: { navigate?: DesktopNavigateBridge } }
  ).cairnDesktop?.navigate?.subscribe(navigate);
}

export interface DesktopTrayBridge {
  state: () => Promise<DesktopTrayState | null>;
  subscribe: (listener: (state: DesktopTrayState) => void) => () => void;
  open: (target: DesktopTrayOpen) => void;
  setRunner: (on: boolean) => Promise<void>;
  setKeepAwake: (on: boolean) => void;
  resize: (height: number) => void;
  hide: () => void;
  quit: () => void;
}

export function desktopTray(): DesktopTrayBridge | null {
  return (
    (window as Window & { cairnDesktop?: { tray?: DesktopTrayBridge } }).cairnDesktop?.tray ?? null
  );
}
