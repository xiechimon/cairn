// #1148 chief 步不占并发槽 + 端口基座 + env 兜底（daemon 面）。失败方式（先
// 于实现固化）：
//   C1 chief 饿死回归（daemon 本地闸面）：gated server（me 带 maxConcurrent）
//      worker 在飞达上限 → claim 循环不停发（挂起 claim 保持——chief 随时可
//      领）；worker 在飞时 chief 步立即发射。
//   C2 chief 在飞不占本地闸：仅 chief 在跑（ungated server）→ 循环照常 claim
//      （本地 park 只数 worker）。
//   C3 env 兜底（ungated server）：CAIRN_DAEMON_MAX_CONCURRENT=2 → me 缺
//      maxConcurrent（旧 server）也并行 2；未设 → 串行（P5 现行为）。
//   C4 取值序 env > DB > 默认（resolveLocalCap 单源）。
//   C5 claim body maxWorkers：daemon 每次自报当前 effective cap。
//   C6 端口基座：并发 worker 步 CAIRN_PORT_BASE 不同段（槽位 ×100）；chief
//      步不携带；槽释放后重用低位段。
//   C7 段公式：portBaseForSlot 1→20000、2→20100、3→20200。

import type { AgentBackend, AgentSessionHandle, ClaimedStep, StepEvent } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { PI_CAPABILITIES } from '../src/backend/pi.js';
import {
  DAEMON_MAX_CONCURRENT_ENV,
  portBaseForSlot,
  resolveLocalCap,
} from '../src/machine-loop.js';
import { boot, CLAIMED, FakeMachineApi, waitFor } from './machine-loop-harness.js';

/** 门闩 session：事件流挂起直到 release，然后 done 收尾。 */
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

function claimedFor(stepId: string, convId: string, kind: 'plan' | 'chief' = 'plan'): ClaimedStep {
  const chief = kind === 'chief';
  return {
    ...CLAIMED,
    step: { ...CLAIMED.step, id: stepId, buildId: convId, kind },
    conversationId: convId,
    ...(chief
      ? {
          chief: {
            threadId: convId.replace(/^chief-/, ''),
            systemPrompt: '总管',
            trigger: 'user' as const,
          },
        }
      : {}),
  };
}

function defer<T = void>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** 记录型后端：createSession 记 opts（env 断言面），会话挂起直到 gate。 */
function recordingBackend(gates: Promise<void>[]): AgentBackend {
  const created: unknown[] = [];
  let n = 0;
  const backend: AgentBackend = {
    capabilities: PI_CAPABILITIES,
    async createSession(opts) {
      created.push(opts);
      const gate = gates[n % gates.length] ?? Promise.resolve();
      n += 1;
      return gatedSession(`sess-${n}`, gate);
    },
    async continueSession(id) {
      const gate = gates[n % gates.length] ?? Promise.resolve();
      n += 1;
      return gatedSession(id, gate);
    },
  };
  return Object.assign(backend, { created });
}

describe('#1148 chief 步不占并发槽（daemon 本地闸）', () => {
  test('C1：gated server、worker 满载 → 挂起 claim 保持 + chief 立即发射', async () => {
    const api = new FakeMachineApi();
    api.mePatch = { maxConcurrent: 1 }; // cap 1（gated server 形）
    const gate = defer<void>();
    const backend = recordingBackend([gate.promise]);
    const { handle, lines } = await boot({ api, backend });
    await waitFor(() => api.parked !== null);
    // worker s1 发射 → 本地 worker 数达 cap 1——循环不得停发（gated server 的
    // 容量过滤在 server 侧；chief 随时可领）。
    api.parked?.(claimedFor('s1', 'conv-1'));
    await waitFor(() => lines.some((l) => l.includes('step s1 for conv conv-1 (1 running)')));
    await waitFor(() => api.parked !== null); // 挂起 claim 保持（不停发）
    // chief 在 worker 满载时推送 → 立即发射（不被本地闸卡）。
    api.parked?.(claimedFor('c1', 'chief-t1', 'chief'));
    await waitFor(() => lines.some((l) => l.includes('step c1 for conv chief-t1 (2 running)')));
    // 收尾。
    gate.resolve();
    await waitFor(() => api.doneBodies.length === 2);
    await handle.stop();
    await handle.done;
  });

  test('C2：ungated server、仅 chief 在飞 → 本地 park 不触发（照常 claim）', async () => {
    const api = new FakeMachineApi(); // me 不带 maxConcurrent（旧 server，localCap 1）
    const gate = defer<void>();
    const backend = recordingBackend([gate.promise]);
    const { handle, lines } = await boot({ api, backend });
    await waitFor(() => api.parked !== null);
    api.parked?.(claimedFor('c1', 'chief-t1', 'chief'));
    await waitFor(() => lines.some((l) => l.includes('step c1 for conv chief-t1 (1 running)')));
    // chief 在飞不占 worker 位（本地 park 只数 worker）→ 循环继续 claim。
    await waitFor(() => api.parked !== null);
    api.parked?.(claimedFor('s1', 'conv-1'));
    await waitFor(() => lines.some((l) => l.includes('step s1 for conv conv-1 (2 running)')));
    // worker 1 = localCap 1（ungated）→ 此后才 park。
    const claimsAtFull = api.claimCalls;
    await new Promise((r) => setTimeout(r, 80));
    expect(api.claimCalls).toBe(claimsAtFull);
    gate.resolve();
    await waitFor(() => api.doneBodies.length === 2);
    await handle.stop();
    await handle.done;
  });
});

describe('#1148 env 兜底（CAIRN_DAEMON_MAX_CONCURRENT）', () => {
  test('C3：ungated server + env=2 → 并行 2（串行兜底被 env 放宽）', async () => {
    const api = new FakeMachineApi(); // me 缺 maxConcurrent → DB 侧无值（默认 1）
    const gate1 = defer<void>();
    const gate2 = defer<void>();
    const backend = recordingBackend([gate1.promise, gate2.promise]);
    const { handle, lines } = await boot({
      api,
      backend,
      // #1148 capEnv 注入面（proxyEnv 同律）：env 源与真 process.env 隔离。
      capEnv: { [DAEMON_MAX_CONCURRENT_ENV]: '2' },
    });
    await waitFor(() => api.parked !== null);
    api.parked?.(claimedFor('s1', 'conv-1'));
    await waitFor(() => api.parked !== null); // env=2 → 1 worker 在飞仍继续 claim
    api.parked?.(claimedFor('s2', 'conv-2'));
    await waitFor(() => lines.some((l) => l.includes('step s2 for conv conv-2 (2 running)')));
    // 2 worker 在飞 = env cap → park（ungated 停发）。
    const claimsAtFull = api.claimCalls;
    await new Promise((r) => setTimeout(r, 80));
    expect(api.claimCalls).toBe(claimsAtFull);
    gate1.resolve();
    gate2.resolve();
    await waitFor(() => api.doneBodies.length === 2);
    await handle.stop();
    await handle.done;
  });

  test('C4：取值序 env > DB > 默认（resolveLocalCap 单源）', () => {
    expect(resolveLocalCap({ [DAEMON_MAX_CONCURRENT_ENV]: '2' }, 3)).toBe(2); // env 压 DB
    expect(resolveLocalCap({ [DAEMON_MAX_CONCURRENT_ENV]: '4' }, undefined)).toBe(4); // env 兜默认
    expect(resolveLocalCap({}, 3)).toBe(3); // 缺省回落 machine 行
    expect(resolveLocalCap({}, undefined)).toBe(1); // 双缺 → 默认 1（混版本串行）
    expect(resolveLocalCap({ [DAEMON_MAX_CONCURRENT_ENV]: 'abc' }, 3)).toBe(3); // 非法 env 忽略
    expect(resolveLocalCap({ [DAEMON_MAX_CONCURRENT_ENV]: '0' }, 3)).toBe(3); // 0 非法忽略
  });
});

describe('#1148 端口基座（CAIRN_PORT_BASE 槽位分段）', () => {
  test('C5：claim body 自报 maxWorkers（effective cap）', async () => {
    const api = new FakeMachineApi();
    api.mePatch = { maxConcurrent: 2 };
    const gate = defer<void>();
    const backend = recordingBackend([gate.promise]);
    const { handle } = await boot({ api, backend });
    await waitFor(() => api.claimBodies.length >= 1);
    expect(api.claimBodies[0]).toEqual({ maxWorkers: 2 });
    gate.resolve();
    await waitFor(() => api.doneBodies.length >= 0);
    await handle.stop();
    await handle.done;
  });

  test('C6：并发 worker 步 CAIRN_PORT_BASE 不同段；chief 不携带；槽释放后重用', async () => {
    const api = new FakeMachineApi();
    api.mePatch = { maxConcurrent: 3 };
    const gate1 = defer<void>();
    const gate2 = defer<void>();
    const gateChief = defer<void>();
    const backend = recordingBackend([gate1.promise, gate2.promise, gateChief.promise]);
    const { handle } = await boot({ api, backend });
    const created = (backend as unknown as { created: { env?: Record<string, string> }[] }).created;
    await waitFor(() => api.parked !== null);
    // s1 / s2 并发发射 → env 不同段。
    api.parked?.(claimedFor('s1', 'conv-1'));
    await waitFor(() => api.parked !== null);
    api.parked?.(claimedFor('s2', 'conv-2'));
    await waitFor(() => created.length >= 2);
    expect(created[0]?.env?.CAIRN_PORT_BASE).toBe('20000');
    expect(created[1]?.env?.CAIRN_PORT_BASE).toBe('20100');
    // chief 步：无端口基座（不占槽自然无段）。
    await waitFor(() => api.parked !== null);
    api.parked?.(claimedFor('c1', 'chief-t1', 'chief'));
    await waitFor(() => created.length >= 3);
    expect(created[2]?.env).toBeUndefined();
    // s1 收尾释放槽 1 → s3 重用 20000 段（无串槽：并发期不同段即可）。
    gate1.resolve();
    await waitFor(() => api.doneBodies.some((d) => d.stepId === 's1'));
    await waitFor(() => api.parked !== null);
    api.parked?.(claimedFor('s3', 'conv-3'));
    await waitFor(() => created.length >= 4);
    expect(created[3]?.env?.CAIRN_PORT_BASE).toBe('20000');
    gate2.resolve();
    gateChief.resolve();
    await waitFor(() => api.doneBodies.length === 4);
    await handle.stop();
    await handle.done;
  });

  test('C7：段公式 portBaseForSlot（槽位 ×100，首段 20000）', () => {
    expect(portBaseForSlot(1)).toBe(20_000);
    expect(portBaseForSlot(2)).toBe(20_100);
    expect(portBaseForSlot(3)).toBe(20_200);
    expect(portBaseForSlot(11)).toBe(21_000);
  });
});
