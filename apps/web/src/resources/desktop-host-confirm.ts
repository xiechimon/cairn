import type { TFunc } from '../i18n/translate.js';

export interface HostConfirmCopy {
  title: string;
  summary: string;
  confirmLabel: string;
}

export function hostSwitchConfirmCopy(targetName: string, t: TFunc): HostConfirmCopy {
  return {
    title: t('切换到「{name}」？', { name: targetName }),
    summary: t(
      '每台主机的项目、对话和任务彼此独立。切换后应用会重启并连接到「{name}」，原主机的数据均保留。',
      { name: targetName },
    ),
    confirmLabel: t('切换并重启'),
  };
}

export function hostRemoveConfirmCopy(
  targetName: string,
  isActive: boolean,
  t: TFunc,
): HostConfirmCopy {
  if (isActive) {
    return {
      title: t('移除「{name}」并切回本机？', { name: targetName }),
      summary: t(
        '「{name}」是当前连接的主机。移除后应用会重启并切回本机服务器，远程主机上的数据均保留。',
        { name: targetName },
      ),
      confirmLabel: t('移除并切回本机'),
    };
  }
  return {
    title: t('移除「{name}」？', { name: targetName }),
    summary: t('移除后仅删除这条连接记录，远程主机上的数据均保留。'),
    confirmLabel: t('移除'),
  };
}
