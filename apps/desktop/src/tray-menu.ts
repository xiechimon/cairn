import type { MenuItemConstructorOptions } from 'electron';
import type { DesktopLocale } from './locale.js';

export interface TrayHostOption {
  id: string;
  label: string;
  active: boolean;
}

export interface TrayMenuActions {
  open: () => void;
  setKeepAwake: (on: boolean) => void;
  switchHost?: (id: string) => void;
  hosts?: readonly TrayHostOption[];
  quit: () => void;
}

const LABELS = {
  zh: {
    status: (host: string | null) => (host === null ? '正在运行' : `已连接 ${host}`),
    open: '打开 Cairn',
    switchHost: '切换主机',
    keepAwake: '保持屏幕常亮',
    quit: '退出 Cairn',
  },
  en: {
    status: (host: string | null) => (host === null ? 'Running' : `Running at ${host}`),
    open: 'Open Cairn',
    switchHost: 'Switch Host',
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
  const switchHostItem: MenuItemConstructorOptions[] =
    actions.switchHost !== undefined && actions.hosts !== undefined && actions.hosts.length > 1
      ? [
          {
            label: copy.switchHost,
            submenu: actions.hosts.map((entry) => ({
              label: entry.label,
              type: 'radio' as const,
              checked: entry.active,
              click: () => actions.switchHost?.(entry.id),
            })),
          },
        ]
      : [];
  return [
    { label: copy.status(host), enabled: false },
    { type: 'separator' },
    { label: copy.open, click: actions.open },
    ...switchHostItem,
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
