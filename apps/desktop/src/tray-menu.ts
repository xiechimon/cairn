import type { KeepAwakeMode } from '@cairn/shared';
import type { MenuItemConstructorOptions } from 'electron';
import type { DesktopLocale } from './locale.js';

export interface TrayHostOption {
  id: string;
  label: string;
  active: boolean;
}

export interface TrayMenuActions {
  open: () => void;
  setKeepAwake: (mode: KeepAwakeMode) => void;
  switchHost?: (id: string) => void;
  hosts?: readonly TrayHostOption[];
  quit: () => void;
}

const LABELS = {
  zh: {
    status: (host: string | null) => (host === null ? '正在运行' : `已连接 ${host}`),
    open: '打开 Cairn',
    switchHost: '切换主机',
    keepAwakeHeading: '有任务运行时保持唤醒',
    screenOn: '屏幕常亮',
    system: '屏幕可熄灭',
    lidClosed: '合盖继续运行',
    quit: '退出 Cairn',
  },
  en: {
    status: (host: string | null) => (host === null ? 'Running' : `Running at ${host}`),
    open: 'Open Cairn',
    switchHost: 'Switch Host',
    keepAwakeHeading: 'Stay awake while tasks run',
    screenOn: 'Keep the screen on',
    system: 'Let the screen sleep',
    lidClosed: 'Keep running with the lid closed',
    quit: 'Quit Cairn',
  },
} as const;

export function trayMenuTemplate(
  host: string | null,
  keepAwake: KeepAwakeMode,
  lidClosedAvailable: boolean,
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
  const effective = keepAwake === 'lid-closed' && !lidClosedAvailable ? 'system' : keepAwake;
  const choice = (mode: KeepAwakeMode, label: string): MenuItemConstructorOptions => ({
    label,
    type: 'radio',
    checked: effective === mode,
    click: () => actions.setKeepAwake(mode),
  });
  return [
    { label: copy.status(host), enabled: false },
    { type: 'separator' },
    { label: copy.open, click: actions.open },
    ...switchHostItem,
    { label: copy.keepAwakeHeading, enabled: false },
    choice('screen-on', copy.screenOn),
    choice('system', copy.system),
    ...(lidClosedAvailable ? [choice('lid-closed', copy.lidClosed)] : []),
    { type: 'separator' },
    { label: copy.quit, accelerator: 'CommandOrControl+Q', click: actions.quit },
  ];
}
