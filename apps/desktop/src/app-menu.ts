import type { DesktopMenuCommand, DesktopUpdateState } from '@cairn/shared';
import type { MenuItemConstructorOptions } from 'electron';
import type { DesktopLocale } from './locale.js';

export interface UpdateMenuActions {
  check: () => void;
  install: () => void;
}

const LABELS = {
  zh: {
    checkingUpdates: '正在检查更新…',
    installUpdate: (version: string) => `安装更新 ${version}…`,
    restartUpdate: (version: string) => `立即更新到 ${version}`,
    downloadingUpdate: (version: string, percent: number) =>
      `正在下载更新 ${version} (${percent}%)`,
    installingUpdate: (version: string) => `正在安装更新 ${version}…`,
    checkUpdates: '检查更新…',
    switchHost: '切换主机',
    settings: '设置…',
    file: '文件',
    newTask: '新建任务',
    edit: '编辑',
    find: '查找…',
    view: '视图',
    reload: '重新加载',
    forceReload: '强制重新加载',
    history: '历史记录',
    back: '后退',
    forward: '前进',
  },
  en: {
    checkingUpdates: 'Checking for Updates…',
    installUpdate: (version: string) => `Install Update ${version}…`,
    restartUpdate: (version: string) => `Update to ${version} Now`,
    downloadingUpdate: (version: string, percent: number) =>
      `Downloading Update ${version} (${percent}%)`,
    installingUpdate: (version: string) => `Installing Update ${version}…`,
    checkUpdates: 'Check for Updates…',
    switchHost: 'Switch Host',
    settings: 'Settings…',
    file: 'File',
    newTask: 'New Task',
    edit: 'Edit',
    find: 'Find…',
    view: 'View',
    reload: 'Reload',
    forceReload: 'Force Reload',
    history: 'History',
    back: 'Back',
    forward: 'Forward',
  },
} as const;

function updateItem(
  state: DesktopUpdateState,
  actions: UpdateMenuActions,
  locale: DesktopLocale,
): MenuItemConstructorOptions {
  const copy = LABELS[locale];
  switch (state.status) {
    case 'checking':
      return { label: copy.checkingUpdates, enabled: false };
    case 'available':
      return { label: copy.installUpdate(state.version), click: actions.install };
    case 'ready':
      return { label: copy.restartUpdate(state.version), click: actions.install };
    case 'downloading':
      return { label: copy.downloadingUpdate(state.version, state.percent), enabled: false };
    case 'installing':
    case 'restarting':
      return { label: copy.installingUpdate(state.version), enabled: false };
    default:
      return { label: copy.checkUpdates, click: actions.check };
  }
}

export interface PageMenuActions {
  send: (command: DesktopMenuCommand) => void;
  back: () => void;
  forward: () => void;
  reload?: () => void;
  forceReload?: () => void;
}

export interface HostMenuEntry {
  id: string;
  label: string;
  active: boolean;
}

export interface HostMenuActions {
  entries: readonly HostMenuEntry[];
  switchHost: (id: string) => void;
}

export function appMenuTemplate(
  state: DesktopUpdateState,
  actions: UpdateMenuActions,
  page: PageMenuActions,
  locale: DesktopLocale = 'en',
  hosts?: HostMenuActions,
): MenuItemConstructorOptions[] {
  const copy = LABELS[locale];
  const hostSubmenu: MenuItemConstructorOptions[] =
    hosts !== undefined && hosts.entries.length > 1
      ? [
          {
            label: copy.switchHost,
            submenu: hosts.entries.map((entry) => ({
              label: entry.label,
              type: 'radio' as const,
              checked: entry.active,
              click: () => hosts.switchHost(entry.id),
            })),
          },
          { type: 'separator' },
        ]
      : [];
  return [
    {
      role: 'appMenu',
      submenu: [
        { role: 'about' },
        updateItem(state, actions, locale),
        { type: 'separator' },
        ...hostSubmenu,
        {
          label: copy.settings,
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
      label: copy.file,
      submenu: [
        {
          label: copy.newTask,
          accelerator: 'CommandOrControl+N',
          click: () => page.send('new-task'),
        },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    {
      label: copy.edit,
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
        { label: copy.find, accelerator: 'CommandOrControl+F', click: () => page.send('search') },
      ],
    },
    {
      label: copy.view,
      submenu: [
        page.reload !== undefined
          ? { label: copy.reload, accelerator: 'CommandOrControl+R', click: page.reload }
          : { role: 'reload' },
        page.forceReload !== undefined
          ? {
              label: copy.forceReload,
              accelerator: 'CommandOrControl+Shift+R',
              click: page.forceReload,
            }
          : { role: 'forceReload' },
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
      label: copy.history,
      submenu: [
        { label: copy.back, accelerator: 'CommandOrControl+[', click: page.back },
        { label: copy.forward, accelerator: 'CommandOrControl+]', click: page.forward },
      ],
    },
    { role: 'windowMenu' },
  ];
}
