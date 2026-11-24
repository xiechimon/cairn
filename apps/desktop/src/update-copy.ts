import type { DesktopUpdateBlocker } from '@cairn/shared';
import type { DesktopLocale } from './locale.js';

export interface DialogText {
  title: string;
  detail: string;
  buttons?: string[];
}

const COPY = {
  zh: {
    installTitle: (version: string) => `Cairn ${version} 可以安装`,
    installDetail: (current: string) =>
      `当前版本是 ${current}。Cairn 会下载更新，然后重启完成安装。`,
    installBlockedDetail: (version: string) =>
      `${version} 上次在这台 Mac 上未能启动。你已选择安装，Cairn 会重新安装。`,
    installButtons: ['安装并重启', '稍后'],
    upToDateTitle: 'Cairn 已是最新',
    upToDateDetail: (version: string) => `当前版本 ${version} 已是最新。`,
    unsupportedTitle: 'Cairn 无法在此位置自动更新',
    unsupportedDetail: {
      'not-in-applications': '把 Cairn 移到「应用程序」文件夹后再检查。',
      'read-only': 'Cairn 在只读位置运行。把它拷贝到「应用程序」文件夹后再检查。',
      development: '这是开发版。',
    },
    checkFailedTitle: 'Cairn 未能检查更新',
    offlineTitle: '无法连接网络',
    offlineDetail: '当前无法连接更新服务器，下次检查时会自动重试。',
    serverStoppedTitle: 'Cairn 服务已停止',
    serverStoppedDetail: (code: number | null) => `Cairn 服务以代码 ${code} 退出。`,
    couldNotStartTitle: 'Cairn 未能启动',
  },
  en: {
    installTitle: (version: string) => `Cairn ${version} is available`,
    installDetail: (current: string) =>
      `You have ${current}. Cairn downloads the update and restarts to install it.`,
    installBlockedDetail: (version: string) =>
      `${version} did not start on this Mac last time. You chose to install, so Cairn installs it again.`,
    installButtons: ['Install and Restart', 'Later'],
    upToDateTitle: 'Cairn is up to date',
    upToDateDetail: (version: string) => `You have the latest version, ${version}.`,
    unsupportedTitle: 'Cairn cannot update itself here',
    unsupportedDetail: {
      'not-in-applications': 'Move Cairn to the Applications folder, then check again.',
      'read-only':
        'Cairn is running from a read-only location. Copy it to the Applications folder, then check again.',
      development: 'This is a development build.',
    },
    checkFailedTitle: 'Cairn could not check for updates',
    offlineTitle: 'Cannot connect to the network',
    offlineDetail:
      'Cairn cannot reach the update server right now. It will try again on the next check.',
    serverStoppedTitle: 'Cairn server stopped',
    serverStoppedDetail: (code: number | null) => `The Cairn server exited with code ${code}.`,
    couldNotStartTitle: 'Cairn could not start',
  },
} as const;

export function installUpdateCopy(
  locale: DesktopLocale,
  version: string,
  current: string,
  blocked: boolean,
): DialogText {
  const copy = COPY[locale];
  return {
    title: copy.installTitle(version),
    detail: blocked ? copy.installBlockedDetail(version) : copy.installDetail(current),
    buttons: [...copy.installButtons],
  };
}

export function upToDateCopy(locale: DesktopLocale, version: string): DialogText {
  const copy = COPY[locale];
  return { title: copy.upToDateTitle, detail: copy.upToDateDetail(version) };
}

export function unsupportedUpdateCopy(
  locale: DesktopLocale,
  blocker: DesktopUpdateBlocker,
): DialogText {
  const copy = COPY[locale];
  return { title: copy.unsupportedTitle, detail: copy.unsupportedDetail[blocker] };
}

export function updateCheckFailedCopy(locale: DesktopLocale, message: string): DialogText {
  return { title: COPY[locale].checkFailedTitle, detail: message };
}

export function updateOfflineCopy(locale: DesktopLocale): DialogText {
  const copy = COPY[locale];
  return { title: copy.offlineTitle, detail: copy.offlineDetail };
}

export function serverStoppedCopy(locale: DesktopLocale, code: number | null): DialogText {
  const copy = COPY[locale];
  return { title: copy.serverStoppedTitle, detail: copy.serverStoppedDetail(code) };
}

export function couldNotStartCopy(locale: DesktopLocale, detail: string): DialogText {
  return { title: COPY[locale].couldNotStartTitle, detail };
}
