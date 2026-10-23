// per-step 后端解析（spec 17 A3：backendFor 唯一分叉）（#1128 自 machine-loop.test.ts 拆分；共享 harness 收编位
// = ./machine-loop-harness.ts，每个测试自 boot 自停）。

import type { ClaimedStep } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { boot, CLAIMED, FakeMachineApi, fakeBackend, waitFor } from './machine-loop-harness.js';

describe('per-step 后端解析（spec 17 A3：backendFor 唯一分叉）', () => {
  /** runtime 步 claim fixture（provider = claude-code 身份）。 */
  function claudeClaimed(): ClaimedStep {
    return { ...CLAIMED, agent: { ...CLAIMED.agent!, provider: 'claude-code' } };
  }

  test('失败方式 1：claude-code 步 → claude 后端执行，pi 后端零会话 + 惰性行恰好一条', async () => {
    const api = new FakeMachineApi();
    const { backend: pi, created: piCreated } = fakeBackend([{ type: 'done', usage: [] }]);
    const { backend: claude, created: claudeCreated } = fakeBackend([{ type: 'done', usage: [] }]);
    const { handle, lines } = await boot({ api, backend: pi, claudeCodeBackend: claude });
    await waitFor(() => api.parked !== null);
    api.parked?.(claudeClaimed());
    await waitFor(() => api.doneBodies.length === 1);
    expect(api.doneBodies[0]?.body.status).toBe('success');
    // 路由：claude 步只进 claude 后端。
    expect(claudeCreated).toHaveLength(1);
    expect(piCreated).toHaveLength(0);
    // canon：pi 行常驻（启动序列），claude 行惰性（首个 runtime 步）且恰好一条。
    expect(lines[0]).toBe('Loading pi runtime…');
    const claudeLines = lines.filter((l) => l === 'Loading claude-code runtime…');
    expect(claudeLines).toHaveLength(1);
    // A4 零凭据：FakeMachineApi.token 返回 http stub-gw（mixed-version 面），
    // runtime 分支权威短路照跑——canon 行落 claude-code。
    expect(lines).toContain('using model claude-code/stub-model');
    await handle.stop();
    await handle.done;
  });

  test('失败方式 2：pi-only 步流 → 不初始化 claude 后端、无惰性行', async () => {
    const api = new FakeMachineApi();
    const { backend: pi, created: piCreated } = fakeBackend([{ type: 'done', usage: [] }]);
    const { backend: claude, created: claudeCreated } = fakeBackend([{ type: 'done', usage: [] }]);
    const { handle, lines } = await boot({ api, backend: pi, claudeCodeBackend: claude });
    await waitFor(() => api.parked !== null);
    api.parked?.(CLAIMED); // provider='stub-gw'（custom id，非 runtime 身份）
    await waitFor(() => api.doneBodies.length === 1);
    expect(piCreated).toHaveLength(1);
    expect(claudeCreated).toHaveLength(0);
    expect(lines.some((l) => l === 'Loading claude-code runtime…')).toBe(false);
    await handle.stop();
    await handle.done;
  });

  test('失败方式 4：runtime 步 + 本机无 claude 凭据 → 步前失败，文案点名本机机器名（#867 T6）', async () => {
    const api = new FakeMachineApi();
    const { backend: pi, created: piCreated } = fakeBackend([]);
    const { backend: claude, created: claudeCreated } = fakeBackend([]);
    const { handle, lines } = await boot({
      api,
      backend: pi,
      claudeCodeBackend: claude,
      claudeCodeAuthProbe: async () => ({ state: 'not-logged-in', provider: 'firstParty' }),
    });
    await waitFor(() => api.parked !== null);
    api.parked?.(claudeClaimed());
    await waitFor(() => api.doneBodies.length === 1);
    expect(api.doneBodies[0]?.body.status).toBe('failed');
    // 机器名走 config.name（上线序列那个值，与 machines 页同源）。
    const msg = api.doneBodies[0]?.body.errorMessage ?? '';
    expect(msg).toContain('test-mbp');
    expect(msg).toContain('ANTHROPIC_API_KEY');
    // 预检在 backendFor 之前：连 claude 后端都没构造，模型回合零消耗。
    expect(claudeCreated).toHaveLength(0);
    expect(piCreated).toHaveLength(0);
    expect(lines.some((l) => l === 'Loading claude-code runtime…')).toBe(false);
    await handle.stop();
    await handle.done;
  });

  test('失败方式 3：混合步流（claude 步 + pi 步）→ 各归各后端，惰性行仍恰一条', async () => {
    const api = new FakeMachineApi();
    const { backend: pi, created: piCreated } = fakeBackend([{ type: 'done', usage: [] }]);
    const { backend: claude, created: claudeCreated } = fakeBackend([{ type: 'done', usage: [] }]);
    const { handle, lines } = await boot({ api, backend: pi, claudeCodeBackend: claude });
    await waitFor(() => api.parked !== null);
    api.parked?.(claudeClaimed());
    await waitFor(() => api.doneBodies.length === 1);
    await waitFor(() => api.parked !== null);
    api.parked?.(CLAIMED); // 第二步回归 pi
    await waitFor(() => api.doneBodies.length === 2);
    expect(claudeCreated).toHaveLength(1);
    expect(piCreated).toHaveLength(1);
    expect(lines.filter((l) => l === 'Loading claude-code runtime…')).toHaveLength(1);
    await handle.stop();
    await handle.done;
  });
});
