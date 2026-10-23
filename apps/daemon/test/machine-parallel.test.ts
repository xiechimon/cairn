// #1108 并行执行循环（localCap 并发 + 空位交接 + 优雅停止）（#1128 自 machine-loop.test.ts 拆分；共享 harness 收编位
// = ./machine-loop-harness.ts，每个测试自 boot 自停）。

import type { AgentBackend, AgentSessionHandle, ClaimedStep, StepEvent } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { PI_CAPABILITIES } from '../src/backend/pi.js';
import { boot, CLAIMED, FakeMachineApi, waitFor } from './machine-loop-harness.js';

// —— #1108 并行执行循环（claim 到即发射 + localCap 自限 + 优雅停止等在飞）——
// 失败方式（先于实现固化）：
//   P1 该并行不并行：cap≥2 且两步在队 → 两步并发执行（canon 行
//      `(1 running)` / `(2 running)` 各一条）。
//   P2 本地闸停发（#1148 语义更新）：在飞数达 cap 且 gated server → 循环保
//      持恰一条挂起 claim（chief 可领），不叠发风暴。
//   P3 空位交接：一步收尾（done 落账）→ 槽释放 → 循环恢复领步（parked
//      回来）。
//   P4 优雅停止破约：stop 后 done 在在飞步收尾前 resolve。
//   P5 旧 server 无 maxConcurrent 字段 → localCap 回退 1（串行，混版本安全）。

/** 门闩 session：事件流挂起直到 release，然后 done 收尾——并行时序的受控面。 */
function gatedSession(sessionId: string, release: Promise<void>): AgentSessionHandle {
  return {
    sessionId,
    events: (async function* gen() {
      await release;
      yield { type: 'done', usage: [] } as StepEvent;
    })(),
    async steer() {},
    async stop() {},
    usage: () => [],
  };
}

/** 步载荷克隆（并行测试需要不同 conv / step id——journal 与 worktree 键）。 */
function claimedFor(stepId: string, convId: string): ClaimedStep {
  return {
    ...CLAIMED,
    step: { ...CLAIMED.step, id: stepId, buildId: convId },
    conversationId: convId,
  };
}

function defer<T = void>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('#1108 并行执行循环（localCap 并发 + 空位交接 + 优雅停止）', () => {
  test('P1+P2+P3：cap=2 两步并发、在飞满不发 claim、收尾即释放空位再领', async () => {
    const api = new FakeMachineApi();
    // GET me 带 maxConcurrent: 2（本地闸数据源）。
    api.mePatch = { maxConcurrent: 2 };
    const gate1 = defer<void>();
    const gate2 = defer<void>();
    let createdCount = 0;
    const backend: AgentBackend = {
      capabilities: PI_CAPABILITIES,
      async createSession() {
        // 第一个会话等 gate1、之后等 gate2（createSession 无 conv 参，按
        // 创建序配对门闩）。
        const n = createdCount++;
        return n === 0
          ? gatedSession('sess-1', gate1.promise)
          : gatedSession('sess-2', gate2.promise);
      },
      async continueSession(id) {
        return gatedSession(id, gate2.promise);
      },
    };
    const { handle, lines } = await boot({ api, backend });
    await waitFor(() => api.parked !== null);
    // P1：步 1 发射（不等待收尾）——循环立即回来再 claim（claimCalls 增）。
    api.parked?.(claimedFor('s1', 'conv-1'));
    const claimsAfter1 = api.claimCalls;
    await waitFor(() => api.claimCalls > claimsAfter1);
    // P1：步 2 发射，canon 行两条并行计数（1 running / 2 running）。
    api.parked?.(claimedFor('s2', 'conv-2'));
    await waitFor(() => lines.some((l) => l.includes('step s2 for conv conv-2 (2 running)')));
    expect(lines.some((l) => l.includes('step s1 for conv conv-1 (1 running)'))).toBe(true);
    // P2（#1148 语义更新）：在飞 2 = cap、gated server → 循环保持**恰一条**
    // 挂起 claim（chief 随时可领——poll 不再「必空手」，但也不叠发风暴；
    // 观察窗 80ms 内 claimCalls 至多 +1 且 parked 存活）。
    const claimsAtFull = api.claimCalls;
    await new Promise((r) => setTimeout(r, 80));
    expect(api.claimCalls).toBeLessThanOrEqual(claimsAtFull + 1);
    expect(api.parked).not.toBeNull();
    // P3：释放步 1 → done 落账 → 空位交接（挂起 claim 在位——server 侧闸开
    // 即经它领下一格；#1148 起空位交接的载体就是这条常开 claim）。
    gate1.resolve();
    await waitFor(() => api.doneBodies.some((d) => d.stepId === 's1'));
    await waitFor(() => api.parked !== null);
    api.parked?.(claimedFor('s3', 'conv-3'));
    await waitFor(() => lines.some((l) => l.includes('step s3 for conv conv-3 (2 running)')));
    // P4：优雅停止——s2/s3 未收尾前 done 不得 resolve。
    let settled = false;
    void handle.done.then(() => {
      settled = true;
    });
    await handle.stop();
    await new Promise((r) => setTimeout(r, 60));
    expect(settled).toBe(false); // 在飞未收尾，done 仍挂起
    gate2.resolve();
    await handle.done;
    expect(settled).toBe(true);
    expect(api.doneBodies.map((d) => d.stepId)).toContain('s2');
    expect(api.doneBodies.map((d) => d.stepId)).toContain('s3');
  });

  test('P5：me 无 maxConcurrent 字段（旧 server）→ localCap 回退 1，串行', async () => {
    const api = new FakeMachineApi(); // me 不带字段（现有 fake 缺省形态）
    const gate1 = defer<void>();
    const backend: AgentBackend = {
      capabilities: PI_CAPABILITIES,
      async createSession() {
        return gatedSession('sess-1', gate1.promise);
      },
      async continueSession(id) {
        return gatedSession(id, gate1.promise);
      },
    };
    const { handle, lines } = await boot({ api, backend });
    await waitFor(() => api.parked !== null);
    api.parked?.(claimedFor('s1', 'conv-1'));
    // 步 1 在飞未收尾 → 不再 claim（串行：等 gate1）。
    const claimsAfter1 = api.claimCalls;
    await new Promise((r) => setTimeout(r, 80));
    expect(api.claimCalls).toBe(claimsAfter1);
    expect(lines.some((l) => l.includes('step s1 for conv conv-1 (1 running)'))).toBe(true);
    gate1.resolve();
    await waitFor(() => api.doneBodies.length === 1);
    await waitFor(() => api.claimCalls > claimsAfter1); // 收尾后恢复领步
    await handle.stop();
    await handle.done;
  });
});
