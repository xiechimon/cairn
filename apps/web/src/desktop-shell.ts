import {
  type AntigravityLocalStatus,
  type AntigravityLoginOutcome,
  type AntigravityLoginPhase,
  type AntigravitySignInOutcome,
  DESKTOP_SHELL_USER_AGENT,
  DESKTOP_TRAY_PATH,
  type DesktopActivity,
  type DesktopLocalProvider,
  type DesktopMenuCommand,
  type DesktopNotifyPayload,
  type DesktopProviderImportInput,
  type DesktopProviderImportResult,
  type DesktopRollbackNotice,
  type DesktopShellCapabilities,
  type DesktopShellDescriptor,
  type DesktopSubscriptionInput,
  type DesktopTrayOpen,
  type DesktopTrayState,
  type DesktopUpdateInstallResult,
  type DesktopUpdateState,
  type DevinLocalStatus,
  type DevinLoginOutcome,
  type HostPermissions,
  MIN_SUPPORTED_BRIDGE_VERSION,
  type NativeTrayMenu,
  type RemoteVersionState,
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

export interface DesktopShellBridge {
  isFullScreen?: () => Promise<boolean>;
  onFullScreenChange?: (listener: (fullScreen: boolean) => void) => () => void;
}

export function syncDesktopFullScreen(root: HTMLElement): () => void {
  const apply = (fullScreen: boolean): void => {
    if (fullScreen) root.dataset.fullscreen = '';
    else delete root.dataset.fullscreen;
  };
  const shell = (window as Window & { cairnDesktop?: { shell?: DesktopShellBridge } }).cairnDesktop
    ?.shell;
  if (shell === undefined) {
    delete root.dataset.fullscreen;
    return () => {};
  }
  let active = true;
  void shell.isFullScreen?.().then((fullScreen) => {
    if (active) apply(fullScreen === true);
  });
  const unsubscribe = shell.onFullScreenChange?.((fullScreen) => apply(fullScreen === true));
  return () => {
    active = false;
    unsubscribe?.();
  };
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

export type DesktopCapabilityState = 'allowed' | 'needs-update' | 'hidden';

interface CairnDesktopWindow extends Window {
  cairnDesktop?: {
    shell?: DesktopShellBridge & Partial<DesktopShellDescriptor>;
    update?: DesktopUpdateBridge;
    antigravity?: AntigravityBridge;
    devin?: DevinBridge;
    localProviders?: LocalProviderBridge;
    localRunner?: LocalRunnerBridge;
    ownComputer?: OwnComputerBridge;
  };
}

export function isDesktopShell(): boolean {
  if (typeof window === 'undefined') return false;
  if ((window as CairnDesktopWindow).cairnDesktop !== undefined) return true;
  return typeof navigator !== 'undefined' && navigator.userAgent.includes(DESKTOP_SHELL_USER_AGENT);
}

export function desktopShellDescriptor(): DesktopShellDescriptor | null {
  if (typeof window === 'undefined') return null;
  const raw = (window as CairnDesktopWindow).cairnDesktop?.shell;
  if (
    raw == null ||
    typeof raw !== 'object' ||
    typeof raw.shellVersion !== 'string' ||
    typeof raw.bridgeVersion !== 'number' ||
    typeof raw.capabilities !== 'object' ||
    raw.capabilities === null
  ) {
    return null;
  }
  return {
    shellVersion: raw.shellVersion,
    bridgeVersion: raw.bridgeVersion,
    capabilities: raw.capabilities,
  };
}

export function desktopCapabilityState(
  capability: keyof DesktopShellCapabilities,
  methodPresent: boolean,
  opts?: { localOnly?: boolean; minBridgeVersion?: number },
): DesktopCapabilityState {
  if (!isDesktopShell()) return 'hidden';
  const minBridgeVersion = opts?.minBridgeVersion ?? MIN_SUPPORTED_BRIDGE_VERSION;
  const descriptor = desktopShellDescriptor();
  if (descriptor !== null) {
    if (descriptor.bridgeVersion < minBridgeVersion) return 'needs-update';
    if (
      opts?.localOnly === true &&
      descriptor.capabilities[capability] === false &&
      methodPresent
    ) {
      return 'hidden';
    }
    return descriptor.capabilities[capability] === true && methodPresent
      ? 'allowed'
      : 'needs-update';
  }
  return methodPresent ? 'allowed' : 'needs-update';
}

export interface DesktopUpdateBridge {
  state: () => Promise<DesktopUpdateState | null>;
  check: () => Promise<void>;
  install: () => Promise<DesktopUpdateInstallResult | undefined>;
  rollbackNotice: () => Promise<DesktopRollbackNotice | null>;
  subscribe: (listener: (state: DesktopUpdateState) => void) => () => void;
  remoteState: () => Promise<RemoteVersionState | null>;
  retryRemote: () => Promise<void>;
  subscribeRemote: (listener: (state: RemoteVersionState) => void) => () => void;
}

export function desktopUpdates(): DesktopUpdateBridge | null {
  if (typeof window === 'undefined') return null;
  return (window as CairnDesktopWindow).cairnDesktop?.update ?? null;
}

export interface AntigravityBridge {
  status: () => Promise<AntigravityLocalStatus>;
  import: (input: DesktopSubscriptionInput) => Promise<AntigravityLoginOutcome>;
  signIn: () => Promise<AntigravitySignInOutcome>;
  cancelLogin: () => Promise<void>;
  onLoginProgress?: (listener: (phase: AntigravityLoginPhase) => void) => () => void;
}

export function antigravityCapabilityState(minBridgeVersion?: number): DesktopCapabilityState {
  const bridge =
    typeof window === 'undefined'
      ? undefined
      : (window as CairnDesktopWindow).cairnDesktop?.antigravity;
  return desktopCapabilityState('antigravitySignIn', typeof bridge?.signIn === 'function', {
    minBridgeVersion,
  });
}

export function antigravityBridge(): AntigravityBridge | null {
  if (antigravityCapabilityState() !== 'allowed') return null;
  return (window as CairnDesktopWindow).cairnDesktop?.antigravity ?? null;
}

export interface DevinBridge {
  status: () => Promise<DevinLocalStatus>;
  import: (input: DesktopSubscriptionInput) => Promise<DevinLoginOutcome>;
  login: (input: DesktopSubscriptionInput) => Promise<DevinLoginOutcome>;
  cancelLogin: () => Promise<void>;
}

export function devinCapabilityState(minBridgeVersion?: number): DesktopCapabilityState {
  const bridge =
    typeof window === 'undefined' ? undefined : (window as CairnDesktopWindow).cairnDesktop?.devin;
  return desktopCapabilityState('devinSignIn', typeof bridge?.login === 'function', {
    localOnly: true,
    minBridgeVersion,
  });
}

export function devinBridge(): DevinBridge | null {
  if (devinCapabilityState() !== 'allowed') return null;
  return (window as CairnDesktopWindow).cairnDesktop?.devin ?? null;
}

export interface LocalProviderBridge {
  scan: () => Promise<DesktopLocalProvider[]>;
  import: (input: DesktopProviderImportInput) => Promise<DesktopProviderImportResult[]>;
}

export function localProviderBridge(): LocalProviderBridge | null {
  const bridge =
    typeof window === 'undefined'
      ? undefined
      : (window as CairnDesktopWindow).cairnDesktop?.localProviders;
  const state = desktopCapabilityState('localProviders', typeof bridge?.scan === 'function', {
    localOnly: true,
  });
  return state === 'allowed' ? (bridge ?? null) : null;
}

export interface LocalRunnerBridge {
  reconnect: () => Promise<void>;
}

export function localRunnerCapabilityState(minBridgeVersion?: number): DesktopCapabilityState {
  const bridge =
    typeof window === 'undefined'
      ? undefined
      : (window as CairnDesktopWindow).cairnDesktop?.localRunner;
  return desktopCapabilityState('localRunner', typeof bridge?.reconnect === 'function', {
    minBridgeVersion,
  });
}

export function localRunnerBridge(): LocalRunnerBridge | null {
  if (localRunnerCapabilityState() !== 'allowed') return null;
  return (window as CairnDesktopWindow).cairnDesktop?.localRunner ?? null;
}

export interface OwnComputerBridge {
  guide: () => Promise<boolean | null>;
  permissions: () => Promise<HostPermissions | null>;
}

export function ownComputerCapabilityState(minBridgeVersion?: number): DesktopCapabilityState {
  const bridge =
    typeof window === 'undefined'
      ? undefined
      : (window as CairnDesktopWindow).cairnDesktop?.ownComputer;
  return desktopCapabilityState('ownComputer', typeof bridge?.permissions === 'function', {
    localOnly: true,
    minBridgeVersion,
  });
}

export function ownComputerBridge(): OwnComputerBridge | undefined {
  if (ownComputerCapabilityState() !== 'allowed') return undefined;
  return (window as CairnDesktopWindow).cairnDesktop?.ownComputer;
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
