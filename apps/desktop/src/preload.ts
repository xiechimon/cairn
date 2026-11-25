import type {
  AntigravityLocalStatus,
  AntigravityLoginOutcome,
  AntigravityLoginPhase,
  AntigravitySignInOutcome,
  DesktopActivity,
  DesktopLocalProvider,
  DesktopMenuCommand,
  DesktopNotifyPayload,
  DesktopProviderImportInput,
  DesktopProviderImportResult,
  DesktopRollbackNotice,
  DesktopShellDescriptor,
  DesktopSubscriptionInput,
  DesktopTrayOpen,
  DesktopTrayState,
  DesktopUpdateState,
  DevinLocalStatus,
  DevinLoginOutcome,
  HostPermissions,
  NativeTrayMenu,
  RemoteVersionState,
} from '@cairn/shared';
import { contextBridge, ipcRenderer } from 'electron';

<<<<<<< HEAD
type RemoteFallbackCopy = { message: string; action: string | null; quiet: boolean };

function remoteFallbackCopy(state: RemoteVersionState, zh: boolean): RemoteFallbackCopy | null {
  const target = state.targetVersion ?? state.appVersion;
  if (state.phase === 'updating') {
    if (state.updaterState === 'waiting-idle') {
      return {
        message: zh
          ? `远程主机正忙，空闲后会自动更新到 ${target}。`
          : `The remote host is busy; it will update to ${target} when idle.`,
        action: null,
        quiet: true,
      };
    }
    return {
      message: zh ? `正在把远程主机更新到 ${target}。` : `Updating the remote host to ${target}.`,
      action: null,
      quiet: true,
    };
  }
  if (state.phase === 'restarting' || state.phase === 'reloading') {
    return {
      message: zh ? '远程主机正在重启。' : 'The remote host is restarting.',
      action: null,
      quiet: true,
    };
  }
  if (state.phase === 'old-server') {
    return {
      message: zh
        ? '这台远程主机版本较旧，无法自动更新，请在该电脑上更新 Cairn。'
        : 'This remote host is too old to update automatically. Update Cairn on that computer.',
      action: zh ? '重新检查' : 'Check again',
      quiet: false,
    };
  }
  if (state.phase === 'unsupported') {
    return {
      message: zh
        ? '这台远程主机无法自动更新，请在该电脑上手动更新 Cairn。'
        : 'This remote host cannot update automatically. Update Cairn on that computer.',
      action: zh ? '重新检查' : 'Check again',
      quiet: false,
    };
  }
  if (state.phase === 'failed') {
    const message =
      state.reason === 'offline'
        ? zh
          ? '远程主机无法连接更新服务，请稍后重试。'
          : 'The remote host could not reach the update service. Try again later.'
        : state.reason === 'no-release'
          ? zh
            ? '远程主机尚无可用的新版本。'
            : 'No newer release is available for the remote host yet.'
          : zh
            ? '远程主机未能完成更新。'
            : 'The remote host could not finish updating.';
    return { message, action: zh ? '重试' : 'Retry', quiet: false };
  }
  return null;
}

function startRemoteUpdateFallback(): void {
  let bar: HTMLDivElement | null = null;
  const remove = (): void => {
    bar?.remove();
    bar = null;
  };
  const render = (state: RemoteVersionState): void => {
    if (document.querySelector('[data-testid="remote-update-bar"]') !== null) {
      remove();
      return;
    }
    const copy = remoteFallbackCopy(state, navigator.language.toLowerCase().startsWith('zh'));
    if (copy === null || document.body === null) {
      remove();
      return;
    }
    if (bar === null) {
      bar = document.createElement('div');
      bar.dataset.cairnRemoteFallback = 'true';
      bar.setAttribute('role', 'status');
      bar.style.position = 'fixed';
      bar.style.left = '0';
      bar.style.right = '0';
      bar.style.bottom = '0';
      bar.style.zIndex = '2147483000';
      bar.style.display = 'flex';
      bar.style.justifyContent = 'center';
      bar.style.padding = '8px 16px';
      bar.style.font = '13px -apple-system, BlinkMacSystemFont, sans-serif';
      bar.style.color = '#343633';
      bar.style.borderTop = '1px solid rgb(0 0 0 / 0.1)';
      document.body.append(bar);
    }
    bar.style.background = copy.quiet ? '#ecebe6' : '#f9e8e3';
    bar.textContent = copy.message;
    if (copy.action !== null) {
      const action = document.createElement('button');
      action.type = 'button';
      action.textContent = copy.action;
      action.style.marginLeft = '12px';
      action.style.minHeight = '24px';
      action.addEventListener('click', () => {
        void ipcRenderer.invoke('desktop-update:remote-retry');
      });
      bar.append(action);
    }
  };
  const sync = (): void => {
    void ipcRenderer
      .invoke('desktop-update:remote-state')
      .then((initial: RemoteVersionState | null) => {
        if (initial !== null) render(initial);
      })
      .catch(() => {});
  };
  ipcRenderer.on('desktop-update:remote-state', (_event, state: RemoteVersionState) =>
    render(state),
  );
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', sync, { once: true });
  } else {
    sync();
  }
}

let activeCompositions = 0;
window.addEventListener(
  'compositionstart',
  () => {
    activeCompositions += 1;
  },
  true,
);
window.addEventListener(
  'compositionend',
  () => {
    activeCompositions = Math.max(0, activeCompositions - 1);
  },
  true,
);
ipcRenderer.on('desktop-update:prepare-reload', (_event, token: number) => {
  window.dispatchEvent(new Event('cairn:prepare-reload'));
  const started = Date.now();
  const finish = (): void => {
    ipcRenderer.send('desktop-update:prepare-reload-done', token);
  };
  const wait = (): void => {
    if ((activeCompositions === 0 && Date.now() - started >= 150) || Date.now() - started >= 1000) {
      finish();
      return;
    }
    setTimeout(wait, 50);
  };
  wait();
});
startRemoteUpdateFallback();

function readShellDescriptor(): DesktopShellDescriptor | undefined {
  try {
    const raw = ipcRenderer.sendSync('desktop-shell:descriptor') as
      | DesktopShellDescriptor
      | null
      | undefined;
    if (raw == null || typeof raw !== 'object') return undefined;
    return Object.freeze({
      shellVersion: raw.shellVersion,
      bridgeVersion: raw.bridgeVersion,
      capabilities: Object.freeze({ ...raw.capabilities }),
    });
  } catch {
    return undefined;
  }
}

const shellDescriptor = readShellDescriptor();

contextBridge.exposeInMainWorld('cairnDesktop', {
  ...(shellDescriptor === undefined ? {} : { shell: shellDescriptor }),
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
    publish: (menu: NativeTrayMenu): void => ipcRenderer.send('desktop-tray:menu', menu),
    onOpened: (listener: () => void): (() => void) => {
      const relay = () => listener();
      ipcRenderer.on('desktop-tray:opened', relay);
      return () => {
        ipcRenderer.removeListener('desktop-tray:opened', relay);
      };
    },
  },
  localProviders: {
    scan: (): Promise<DesktopLocalProvider[]> => ipcRenderer.invoke('local-providers:scan'),
    import: (input: DesktopProviderImportInput): Promise<DesktopProviderImportResult[]> =>
      ipcRenderer.invoke('local-providers:import', input),
  },
  ownComputer: {
    guide: (): Promise<boolean | null> => ipcRenderer.invoke('own-computer:guide'),
    permissions: (): Promise<HostPermissions | null> =>
      ipcRenderer.invoke('own-computer:permissions'),
  },
  localRunner: {
    reconnect: (): Promise<void> => ipcRenderer.invoke('local-runner:reconnect'),
  },
  host: {
    status: (): Promise<unknown> => ipcRenderer.invoke('desktop-host:status'),
    addRemote: (input: { name: string; url: string }): Promise<unknown> =>
      ipcRenderer.invoke('desktop-host:add-remote', input),
    removeRemote: (id: string): Promise<unknown> =>
      ipcRenderer.invoke('desktop-host:remove-remote', id),
    switch: (id: string): Promise<unknown> => ipcRenderer.invoke('desktop-host:switch', id),
    retry: (): Promise<void> => ipcRenderer.invoke('desktop-host:retry'),
    setResident: (enabled: boolean): Promise<unknown> =>
      ipcRenderer.invoke('desktop-host:set-resident', enabled),
  },
  devin: {
    status: (): Promise<DevinLocalStatus> => ipcRenderer.invoke('devin:status'),
    import: (input: DesktopSubscriptionInput): Promise<DevinLoginOutcome> =>
      ipcRenderer.invoke('devin:import', input),
    login: (input: DesktopSubscriptionInput): Promise<DevinLoginOutcome> =>
      ipcRenderer.invoke('devin:login', input),
    cancelLogin: (): Promise<void> => ipcRenderer.invoke('devin:cancel-login'),
  },
  antigravity: {
    status: (): Promise<AntigravityLocalStatus> => ipcRenderer.invoke('antigravity:status'),
    import: (input: DesktopSubscriptionInput): Promise<AntigravityLoginOutcome> =>
      ipcRenderer.invoke('antigravity:import', input),
    signIn: (): Promise<AntigravitySignInOutcome> => ipcRenderer.invoke('antigravity:sign-in'),
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
  shell: {
    isFullScreen: (): Promise<boolean> => ipcRenderer.invoke('desktop-shell:fullscreen'),
    onFullScreenChange: (listener: (fullScreen: boolean) => void): (() => void) => {
      const relay = (_event: unknown, fullScreen: boolean) => listener(fullScreen === true);
      ipcRenderer.on('desktop-shell:fullscreen', relay);
      return () => {
        ipcRenderer.removeListener('desktop-shell:fullscreen', relay);
      };
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
    remoteState: (): Promise<RemoteVersionState | null> =>
      ipcRenderer.invoke('desktop-update:remote-state'),
    retryRemote: (): Promise<void> => ipcRenderer.invoke('desktop-update:remote-retry'),
    subscribeRemote: (listener: (state: RemoteVersionState) => void): (() => void) => {
      const relay = (_event: unknown, state: RemoteVersionState) => listener(state);
      ipcRenderer.on('desktop-update:remote-state', relay);
      return () => {
        ipcRenderer.removeListener('desktop-update:remote-state', relay);
      };
    },
  },
  activity: {
    report: (activity: DesktopActivity): void => ipcRenderer.send('desktop-activity', activity),
  },
});
