// #440（ADR 0003）POST /api/fs/pick：原生对话框面不可自动化（CI/playwright
// 都驱动不了系统模态），本文件钉**确定性降级面**——能力探测不过（非 darwin
// 或无 GUI 会话域）时 422 + reason unavailable + wire 形状 {error, reason}
// 恰等（#386 reason code 模式）。原生真路径（对话框回填/取消 -128/单飞 409）
// 走 verify-cairn 人工面；web 侧契约面 = apps/web/e2e/project-new-fs-pick.spec.ts。
//
// GUI 会话域（launchctl managername = Aqua）的开发机上自动跳过——不跳会真弹
// 系统对话框把测试挂在人机交互上（Background 域静默挂死实测见 #440 失败清单 S2）。

import { execFileSync } from 'node:child_process';
import { afterAll, describe, expect, test } from 'vitest';
import { bootServer, req } from './helpers.js';

function hasGuiSession(): boolean {
  if (process.platform !== 'darwin') return false;
  try {
    return execFileSync('launchctl', ['managername'], { encoding: 'utf8' }).trim() === 'Aqua';
  } catch {
    return false;
  }
}

const s = bootServer();
afterAll(() => s.dispose());

describe.skipIf(hasGuiSession())('POST /api/fs/pick——能力缺失降级面（S1/S2）', () => {
  test('探测不过 → 422 + reason unavailable，wire 形状 {error, reason} 恰等', async () => {
    const res = await req(s.app, 'POST', '/api/fs/pick');
    expect(res.status).toBe(422);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['error', 'reason']);
    expect(body.reason).toBe('unavailable');
    expect(typeof body.error).toBe('string');
  });
});
