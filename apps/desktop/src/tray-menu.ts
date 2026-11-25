import type { MenuItemConstructorOptions } from 'electron';
import type { DesktopLocale } from './locale.js';

export interface TrayMenuActions {
  open: () => void;
  setKeepAwake: (on: boolean) => void;
  quit: () => void;
}

const LABELS = {
  zh: {
    status: (host: string | null) => (host === null ? '正在运行' : `已连接 ${host}`),
    open: '打开 Cairn',
    keepAwake: '保持屏幕常亮',
    quit: '退出 Cairn',
  },
  en: {
    status: (host: string | null) => (host === null ? 'Running' : `Running at ${host}`),
    open: 'Open Cairn',
    keepAwake: 'Keep the Screen On',
    quit: 'Quit Cairn',
  },
} as const;

export function trayMenuTemplate(
  host: string | null,
  keepAwake: boolean,
  actions: TrayMenuActions,
  locale: DesktopLocale = 'en',
): MenuItemConstructorOptions[] {
  const copy = LABELS[locale];
  return [
    { label: copy.status(host), enabled: false },
    { type: 'separator' },
    { label: copy.open, click: actions.open },
    {
      label: copy.keepAwake,
      type: 'checkbox',
      checked: keepAwake,
      click: () => actions.setKeepAwake(!keepAwake),
    },
    { type: 'separator' },
    { label: copy.quit, accelerator: 'CommandOrControl+Q', click: actions.quit },
  ];
}
