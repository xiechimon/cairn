import type { DesktopUpdateState } from '@cairn/shared';
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

export function appMenuTemplate(
  state: DesktopUpdateState,
  actions: UpdateMenuActions,
): MenuItemConstructorOptions[] {
  return [
    {
      role: 'appMenu',
      submenu: [
        { role: 'about' },
        updateItem(state, actions),
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
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
}
