import type {
  AntigravityLocalStatus,
  AntigravityLoginOutcome,
  AntigravityLoginPhase,
  DesktopMenuCommand,
  DesktopNotifyPayload,
  DesktopRollbackNotice,
  DesktopTrayOpen,
  DesktopTrayState,
  DesktopUpdateState,
  DevinLocalStatus,
  DevinLoginOutcome,
  HostPermissions,
  LocalProvider,
  LocalProviderImport,
} from '@cairn/shared';
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('cairnDesktop', {
  menu: {
    subscribe: (listener: (command: DesktopMenuCommand) => void): (() => void) => {
      const relay = (_event: unknown, command: DesktopMenuCommand) => listener(command);
      ipcRenderer.on('desktop-menu', relay);
      return () => {
        ipcRenderer.removeListener('desktop-menu', relay);
      };
    },
  },
  navigate: {
    subscribe: (listener: (path: string) => void): (() => void) => {
      const relay = (_event: unknown, path: string) => listener(path);
      ipcRenderer.on('desktop-navigate', relay);
      return () => {
        ipcRenderer.removeListener('desktop-navigate', relay);
      };
    },
  },
  notify: {
    show: (payload: DesktopNotifyPayload): void => ipcRenderer.send('desktop-notify', payload),
  },
  tray: {
    state: (): Promise<DesktopTrayState | null> => ipcRenderer.invoke('desktop-tray:state'),
    subscribe: (listener: (state: DesktopTrayState) => void): (() => void) => {
      const relay = (_event: unknown, state: DesktopTrayState) => listener(state);
      ipcRenderer.on('desktop-tray:state', relay);
      return () => {
        ipcRenderer.removeListener('desktop-tray:state', relay);
      };
    },
    open: (target: DesktopTrayOpen): void => ipcRenderer.send('desktop-tray:open', target),
    setRunner: (on: boolean): Promise<void> => ipcRenderer.invoke('desktop-tray:runner', on),
    setKeepAwake: (on: boolean): void => ipcRenderer.send('desktop-tray:keep-awake', on),
    resize: (height: number): void => ipcRenderer.send('desktop-tray:resize', height),
    hide: (): void => ipcRenderer.send('desktop-tray:hide'),
    quit: (): void => ipcRenderer.send('desktop-tray:quit'),
  },
  localProviders: {
    scan: (): Promise<LocalProvider[]> => ipcRenderer.invoke('local-providers:scan'),
    read: (providerIds: string[]): Promise<LocalProviderImport[]> =>
      ipcRenderer.invoke('local-providers:read', providerIds),
  },
  ownComputer: {
    guide: (): Promise<boolean | null> => ipcRenderer.invoke('own-computer:guide'),
    permissions: (): Promise<HostPermissions | null> =>
      ipcRenderer.invoke('own-computer:permissions'),
  },
  localRunner: {
    reconnect: (): Promise<void> => ipcRenderer.invoke('local-runner:reconnect'),
  },
  devin: {
    status: (): Promise<DevinLocalStatus> => ipcRenderer.invoke('devin:status'),
    importKey: (): Promise<{ ok: true; key: string } | { ok: false; reason: string }> =>
      ipcRenderer.invoke('devin:import-key'),
    login: (): Promise<DevinLoginOutcome> => ipcRenderer.invoke('devin:login'),
    cancelLogin: (): Promise<void> => ipcRenderer.invoke('devin:cancel-login'),
  },
  antigravity: {
    status: (): Promise<AntigravityLocalStatus> => ipcRenderer.invoke('antigravity:status'),
    importKey: (): Promise<{ ok: true; key: string } | { ok: false; reason: string }> =>
      ipcRenderer.invoke('antigravity:import-key'),
    login: (): Promise<AntigravityLoginOutcome> => ipcRenderer.invoke('antigravity:login'),
    cancelLogin: (): Promise<void> => ipcRenderer.invoke('antigravity:cancel-login'),
    onLoginProgress: (listener: (phase: AntigravityLoginPhase) => void): (() => void) => {
      const relay = (_event: unknown, phase: AntigravityLoginPhase) => listener(phase);
      ipcRenderer.on('antigravity:login-progress', relay);
      return () => {
        ipcRenderer.removeListener('antigravity:login-progress', relay);
      };
    },
  },
  windowControls: {
    setVisible: (visible: boolean): void => {
      ipcRenderer.send('window-controls:set-visible', visible === true);
    },
  },
  update: {
    state: (): Promise<DesktopUpdateState> => ipcRenderer.invoke('desktop-update:state'),
    check: (): Promise<void> => ipcRenderer.invoke('desktop-update:check'),
    rollbackNotice: (): Promise<DesktopRollbackNotice | null> =>
      ipcRenderer.invoke('desktop-update:rollback-notice'),
    install: (): Promise<void> => ipcRenderer.invoke('desktop-update:install'),
    subscribe: (listener: (state: DesktopUpdateState) => void): (() => void) => {
      const relay = (_event: unknown, state: DesktopUpdateState) => listener(state);
      ipcRenderer.on('desktop-update:state', relay);
      return () => {
        ipcRenderer.removeListener('desktop-update:state', relay);
      };
    },
  },
});
