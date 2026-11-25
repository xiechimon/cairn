import type { BackupNotice } from '@cairn/shared';

type Translate = (key: string, params?: Record<string, string | number>) => string;

export function formatBackupWarning(notice: BackupNotice, t: Translate): string {
  if (notice.kind === 'unreadable') {
    return t('自动备份状态暂时无法读取，请打开设置查看或立即备份。');
  }
  if (notice.kind === 'stale') {
    return t('自动备份已有 {hours} 小时未完成，请打开设置检查并重试。', {
      hours: notice.hours,
    });
  }
  const params = { detail: notice.detail };
  if (notice.hours === null) {
    return t('最近一次自动备份失败（{detail}），尚无成功的备份。请打开设置重试。', params);
  }
  if (notice.hours === 0) {
    return t(
      '最近一次自动备份失败（{detail}），上次成功备份在不到 1 小时前。请打开设置查看或重试。',
      params,
    );
  }
  return t(
    '最近一次自动备份失败（{detail}），上次成功备份在 {hours} 小时前。请打开设置查看或重试。',
    {
      ...params,
      hours: notice.hours,
    },
  );
}
