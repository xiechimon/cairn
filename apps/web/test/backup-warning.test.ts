import { describe, expect, test } from 'vitest';
import { formatBackupWarning } from '../src/backup-warning.js';

function t(key: string, params?: Record<string, string | number>): string {
  if (params == null) return key;
  return Object.entries(params).reduce(
    (out, [name, value]) => out.replaceAll(`{${name}}`, String(value)),
    key,
  );
}

describe('formatBackupWarning', () => {
  test('a failing run describes the failure and last success without ops commands', () => {
    expect(
      formatBackupWarning(
        { kind: 'failing', host: 'cloud', detail: 'disk full', hours: 3 },
        t,
      ),
    ).toBe('最近一次自动备份失败（disk full），上次成功备份在 3 小时前。请打开设置查看或重试。');
    expect(
      formatBackupWarning({ kind: 'failing', host: 'cloud', detail: 'timeout', hours: 0 }, t),
    ).toBe('最近一次自动备份失败（timeout），上次成功备份在不到 1 小时前。请打开设置查看或重试。');
    expect(
      formatBackupWarning({ kind: 'failing', host: 'cloud', detail: 'error', hours: null }, t),
    ).toBe('最近一次自动备份失败（error），尚无成功的备份。请打开设置重试。');
  });

  test('a stale backup says how many hours elapsed and directs to Settings', () => {
    const text = formatBackupWarning({ kind: 'stale', host: 'cloud', hours: 40 }, t);
    expect(text).toBe('自动备份已有 40 小时未完成，请打开设置检查并重试。');
    expect(text).not.toContain('systemctl');
    expect(text).not.toContain('`');
  });

  test('an unreadable status directs to Settings', () => {
    expect(formatBackupWarning({ kind: 'unreadable' }, t)).toBe(
      '自动备份状态暂时无法读取，请打开设置查看或立即备份。',
    );
  });
});
