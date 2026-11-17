import type {
  DesktopMenuCommand,
  DesktopUpdateState,
  HostPermissions,
  LocalProvider,
  LocalProviderImport,
  OwnComputerInstallResult,
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
  localProviders: {
    scan: (): Promise<LocalProvider[]> => ipcRenderer.invoke('local-providers:scan'),
    read: (providerIds: string[]): Promise<LocalProviderImport[]> =>
      ipcRenderer.invoke('local-providers:read', providerIds),
  },
  ownComputer: {
    install: (): Promise<OwnComputerInstallResult | null> =>
      ipcRenderer.invoke('own-computer:install'),
    guide: (): Promise<boolean | null> => ipcRenderer.invoke('own-computer:guide'),
    permissions: (): Promise<HostPermissions | null> =>
      ipcRenderer.invoke('own-computer:permissions'),
  },
  localRunner: {
    reconnect: (): Promise<void> => ipcRenderer.invoke('local-runner:reconnect'),
  },
  windowControls: {
    setVisible: (visible: boolean): void => {
      ipcRenderer.send('window-controls:set-visible', visible === true);
    },
  },
  update: {
    state: (): Promise<DesktopUpdateState> => ipcRenderer.invoke('desktop-update:state'),
    check: (): Promise<void> => ipcRenderer.invoke('desktop-update:check'),
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
