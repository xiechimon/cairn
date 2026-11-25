import {
  DESKTOP_SHELL_USER_AGENT,
  DESKTOP_TRAY_PATH,
  type DesktopActivity,
  type DesktopMenuCommand,
  type DesktopNotifyPayload,
  type DesktopRollbackNotice,
  type DesktopTrayOpen,
  type DesktopTrayState,
  type DesktopUpdateState,
  type NativeTrayMenu,
} from '@cairn/shared';
import { useEffect } from 'react';
import { EN } from './i18n/en.js';
import { readStoredLocale } from './i18n/locale.js';
import { type TVars, translate } from './i18n/translate.js';
import { safeLocalStorage } from './safe-storage.js';

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
}

export function desktopNotify(): DesktopNotifyBridge | null {
  if (typeof window === 'undefined') return null;
  return (
    (window as Window & { cairnDesktop?: { notify?: DesktopNotifyBridge } }).cairnDesktop?.notify ??
    null
  );
}

interface DesktopActivityBridge {
  report: (activity: DesktopActivity) => void;
}

export function desktopActivity(): DesktopActivityBridge | null {
  if (typeof window === 'undefined') return null;
  return (
    (window as Window & { cairnDesktop?: { activity?: DesktopActivityBridge } }).cairnDesktop
      ?.activity ?? null
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
  publish: (menu: NativeTrayMenu) => void;
  onOpened: (listener: () => void) => () => void;
}

export function desktopTray(): DesktopTrayBridge | null {
  return (
    (window as Window & { cairnDesktop?: { tray?: DesktopTrayBridge } }).cairnDesktop?.tray ?? null
  );
}

export interface DesktopHostConnection {
  id: string;
  kind: 'local' | 'remote';
  name: string;
  url: string | null;
}

export interface DesktopHostStatus {
  activeId: string;
  connections: DesktopHostConnection[];
  residentSupported: boolean;
  residentInstalled: boolean;
  attachedToResident: boolean;
}

export interface DesktopHostBridge {
  status: () => Promise<DesktopHostStatus | null>;
  addRemote: (input: { name: string; url: string }) => Promise<DesktopHostStatus | null>;
  removeRemote: (id: string) => Promise<DesktopHostStatus | null>;
  switch: (id: string) => Promise<DesktopHostStatus | null>;
  setResident: (enabled: boolean) => Promise<DesktopHostStatus | null>;
}

export function desktopHost(): DesktopHostBridge | null {
  if (typeof window === 'undefined') return null;
  return (
    (window as Window & { cairnDesktop?: { host?: DesktopHostBridge } }).cairnDesktop?.host ?? null
  );
}

export interface DesktopUpdateBridge {
  state: () => Promise<DesktopUpdateState | null>;
  check: () => Promise<void>;
  install: () => Promise<void>;
  rollbackNotice: () => Promise<DesktopRollbackNotice | null>;
  subscribe: (listener: (state: DesktopUpdateState) => void) => () => void;
}

export function desktopUpdates(): DesktopUpdateBridge | null {
  return (
    (window as Window & { cairnDesktop?: { update?: DesktopUpdateBridge } }).cairnDesktop?.update ??
    null
  );
}

export async function showPendingRollbackNotice(): Promise<void> {
  const updates = desktopUpdates();
  const notify = desktopNotify();
  if (updates === null || notify === null) return;
  const notice = await updates.rollbackNotice();
  if (notice === null) return;
  const t = (source: string, vars?: TVars) =>
    translate(readStoredLocale(safeLocalStorage()), EN, source, vars);
  const title = t('Cairn 回滚了更新');
  const line = t('{failed} 未能启动，Cairn 已恢复到 {restored}。', {
    failed: notice.failedVersion,
    restored: notice.restoredVersion,
  });
  notify.show({
    title,
    body: line,
    href: '/app',
    tag: 'update-rollback',
    dialog: {
      title,
      detail: `${line}\n\n${t('失败记录在 {path}。', { path: notice.logPath })}`,
    },
  });
}
