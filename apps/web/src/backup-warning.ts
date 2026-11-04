import type { BackupNotice } from '@cairn/shared';

type Translate = (key: string, params?: Record<string, string | number>) => string;

export function formatBackupWarning(notice: BackupNotice, t: Translate): string {
  if (notice.kind === 'unreadable') {
    return t('服务器数据库备份状态文件无法读取，无法确认备份是否在运行。');
  }
  if (notice.kind === 'stale') {
    return t(
      '{host} 上的服务器数据库备份已有 {hours} 小时没有成功，备份可能已停止。在该机器上运行 `systemctl --user list-timers cairn-db-backup.timer` 检查定时器。',
      { host: notice.host, hours: notice.hours },
    );
  }
  const params = { host: notice.host, detail: notice.detail };
  if (notice.hours === null) {
    return t(
      '{host} 上的服务器数据库备份最近一次运行失败（{detail}），还没有成功过的备份。在该机器上运行 `systemctl --user status cairn-db-backup.service` 查看原因。',
      params,
    );
  }
  if (notice.hours === 0) {
    return t(
      '{host} 上的服务器数据库备份最近一次运行失败（{detail}），上次成功备份在不到 1 小时前。在该机器上运行 `systemctl --user status cairn-db-backup.service` 查看原因。',
      params,
    );
  }
  return t(
    '{host} 上的服务器数据库备份最近一次运行失败（{detail}），上次成功备份在 {hours} 小时前。在该机器上运行 `systemctl --user status cairn-db-backup.service` 查看原因。',
    { ...params, hours: notice.hours },
  );
}
