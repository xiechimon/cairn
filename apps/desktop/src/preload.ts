import type { DesktopUpdateState } from '@cairn/shared';
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('cairnDesktop', {
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
