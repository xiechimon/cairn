import type { MenuItemConstructorOptions } from 'electron';

export interface TrayMenuActions {
  open: () => void;
  setKeepAwake: (on: boolean) => void;
  quit: () => void;
}

export function trayMenuTemplate(
  host: string,
  keepAwake: boolean,
  actions: TrayMenuActions,
): MenuItemConstructorOptions[] {
  return [
    { label: `Running at ${host}`, enabled: false },
    { type: 'separator' },
    { label: 'Open Cairn', click: actions.open },
    {
      label: 'Keep the Screen On',
      type: 'checkbox',
      checked: keepAwake,
      click: () => actions.setKeepAwake(!keepAwake),
    },
    { type: 'separator' },
    { label: 'Quit Cairn', accelerator: 'CommandOrControl+Q', click: actions.quit },
  ];
}
