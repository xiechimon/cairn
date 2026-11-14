import { describe, expect, test } from 'vitest';
import { isLiveNotice } from '../src/chief/live-notice.js';

describe('isLiveNotice', () => {
  test('ordinary activity and presence labels stay quiet', () => {
    expect(isLiveNotice('处理中...')).toBe(false);
    expect(isLiveNotice('正在读取 {file}')).toBe(false);
    expect(isLiveNotice('准备工作区...')).toBe(false);
  });

  test('queue, quota, connecting and stopping labels surface as a notice', () => {
    expect(isLiveNotice('排队中：等 Runner 上线（前面 {ahead} 个）')).toBe(true);
    expect(isLiveNotice('等额度：模型额度用尽，挂起等待恢复（下次尝试 {time}）')).toBe(true);
    expect(isLiveNotice('正在连接 {machine}...')).toBe(true);
    expect(isLiveNotice('正在停止…')).toBe(true);
  });

  test('a label with queue detail is a notice', () => {
    expect(isLiveNotice('处理中...', { label: '排队中：等空闲 Runner（前面 {ahead} 个）', vars: { ahead: 1 } })).toBe(true);
  });
});
