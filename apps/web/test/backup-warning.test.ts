import { describe, expect, test } from 'vitest';
import { formatBackupWarning } from '../src/backup-warning.js';

function t(key: string, params?: Record<string, string | number>): string {
  if (params == null) return key;
  return Object.entries(params).reduce(
    (out, [name, value]) => out.replaceAll(`{${name}}`, String(value)),
    key,
  );
}

const STATUS_HINT = '在该机器上运行 `systemctl --user status cairn-db-backup.service` 查看原因。';

describe('formatBackupWarning', () => {
  test('a failing run names the host, the systemd result and the last success', () => {
    expect(
      formatBackupWarning(
        { kind: 'failing', host: 'omarchy', detail: 'exit-code 255', hours: 3 },
        t,
      ),
    ).toBe(
      `omarchy 上的服务器数据库备份最近一次运行失败（exit-code 255），上次成功备份在 3 小时前。${STATUS_HINT}`,
    );
    expect(
      formatBackupWarning({ kind: 'failing', host: 'omarchy', detail: 'timeout', hours: 0 }, t),
    ).toBe(
      `omarchy 上的服务器数据库备份最近一次运行失败（timeout），上次成功备份在不到 1 小时前。${STATUS_HINT}`,
    );
    expect(
      formatBackupWarning({ kind: 'failing', host: 'omarchy', detail: 'signal', hours: null }, t),
    ).toBe(`omarchy 上的服务器数据库备份最近一次运行失败（signal），还没有成功过的备份。${STATUS_HINT}`);
  });

  test('a stale backup says how long and points at the timer', () => {
    expect(formatBackupWarning({ kind: 'stale', host: 'omarchy', hours: 5 }, t)).toBe(
      'omarchy 上的服务器数据库备份已有 5 小时没有成功，备份可能已停止。在该机器上运行 `systemctl --user list-timers cairn-db-backup.timer` 检查定时器。',
    );
  });

  test('an unreadable status says the backup cannot be confirmed', () => {
    expect(formatBackupWarning({ kind: 'unreadable' }, t)).toBe(
      '服务器数据库备份状态文件无法读取，无法确认备份是否在运行。',
    );
  });
});
