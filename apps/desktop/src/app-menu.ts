import type { DesktopMenuCommand, DesktopUpdateState } from '@cairn/shared';
import type { MenuItemConstructorOptions } from 'electron';

export interface UpdateMenuActions {
  check: () => void;
  install: () => void;
}

function updateItem(
  state: DesktopUpdateState,
  actions: UpdateMenuActions,
): MenuItemConstructorOptions {
  switch (state.status) {
    case 'checking':
      return { label: 'Checking for Updates…', enabled: false };
    case 'available':
      return { label: `Install Update ${state.version}…`, click: actions.install };
    case 'downloading':
      return { label: `Downloading Update ${state.version} (${state.percent}%)`, enabled: false };
    case 'installing':
    case 'restarting':
      return { label: `Installing Update ${state.version}…`, enabled: false };
    default:
      return { label: 'Check for Updates…', click: actions.check };
  }
}

export interface PageMenuActions {
  send: (command: DesktopMenuCommand) => void;
  back: () => void;
  forward: () => void;
}

export function appMenuTemplate(
  state: DesktopUpdateState,
  actions: UpdateMenuActions,
  page: PageMenuActions,
): MenuItemConstructorOptions[] {
  return [
    {
      role: 'appMenu',
      submenu: [
        { role: 'about' },
        updateItem(state, actions),
        { type: 'separator' },
        {
          label: 'Settings…',
          accelerator: 'CommandOrControl+,',
          click: () => page.send('settings'),
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'New Task',
          accelerator: 'CommandOrControl+N',
          click: () => page.send('new-task'),
        },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Find…', accelerator: 'CommandOrControl+F', click: () => page.send('search') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn', accelerator: 'CommandOrControl+=' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'History',
      submenu: [
        { label: 'Back', accelerator: 'CommandOrControl+[', click: page.back },
        { label: 'Forward', accelerator: 'CommandOrControl+]', click: page.forward },
      ],
    },
    { role: 'windowMenu' },
  ];
}
