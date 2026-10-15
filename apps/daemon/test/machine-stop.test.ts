// stop 投递（M7 #308：事件 → 拉取-确认 → handle.stop → done(stopped)）（#1128 自 machine-loop.test.ts 拆分；共享 harness 收编位
// = ./machine-loop-harness.ts，每个测试自 boot 自停）。

import type { AgentBackend, StepEvent } from '@pacman/shared';
import { describe, expect, test } from 'vitest';
import { PI_CAPABILITIES } from '../src/backend/pi.js';
import { boot, CLAIMED, FakeMachineApi, waitFor } from './machine-loop-harness.js';

describe('stop 投递（M7 #308：事件 → 拉取-确认 → AgentSessionHandle.stop → done(stopped)）', () => {
  /** 门控 handle（pi abort 语义同形）：首事件后停住；stop() 结束事件流
   * （不产 done 事件——PiSessionHandle.stop = abort + queue.end 的对偶）；
   * release() = 自然完成（done 事件）。 */
  function stoppableBackend(probe: { stopCalls: number }) {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let stopped = false;
    const backend: AgentBackend = {
      capabilities: PI_CAPABILITIES,
      async createSession() {
        return {
          sessionId: 'pi-sess-stop',
          events: (async function* () {
            yield { type: 'text_delta', text: '跑着' } as StepEvent;
            await gate;
            if (!stopped) yield { type: 'done', usage: [] } as StepEvent;
          })(),
          async steer() {},
          async stop() {
            probe.stopCalls += 1;
            stopped = true;
            release();
          },
          usage: () => [],
        };
      },
      async continueSession() {
        throw new Error('unused in stop tests');
      },
    };
    return { backend, release };
  }

  test('stop 事件 → 拉取-确认 → live.stop() → done(stopped) 回报 + transcript 上传保留', async () => {
    const api = new FakeMachineApi();
    api.stopResponse = true;
    const probe = { stopCalls: 0 };
    const { backend } = stoppableBackend(probe);
    const { handle, lines } = await boot({ api, backend });
    await waitFor(() => api.parked !== null);
    api.parked?.(CLAIMED);
    await waitFor(() => lines.some((l) => l.includes('new session conv-1')));
    api.onStreamEvent?.({ type: 'stop', stepId: 's1' });
    await waitFor(() => api.doneBodies.length === 1);
    expect(probe.stopCalls).toBe(1);
    expect(api.calls).toContain('stop:s1');
    expect(api.doneBodies[0]?.body.status).toBe('stopped');
    expect(lines.some((l) => l.includes('stop delivered step=s1'))).toBe(true);
    // 部分 transcript 保留（终稿上传照走——运行行「已取消」但过程行不丢）。
    expect(api.uploads.length).toBe(1);
    await handle.stop();
    await handle.done;
  });

  test('失败方式：拉取空（server 门拒/旧步丢弃）→ 不 stop，自然收尾 success', async () => {
    const api = new FakeMachineApi();
    api.stopResponse = null;
    const probe = { stopCalls: 0 };
    const { backend, release } = stoppableBackend(probe);
    const { handle, lines } = await boot({ api, backend });
    await waitFor(() => api.parked !== null);
    api.parked?.(CLAIMED);
    await waitFor(() => lines.some((l) => l.includes('new session conv-1')));
    api.onStreamEvent?.({ type: 'stop', stepId: 's1' });
    await waitFor(() => api.calls.includes('stop:s1'));
    expect(probe.stopCalls).toBe(0);
    release();
    await waitFor(() => api.doneBodies.length === 1);
    expect(api.doneBodies[0]?.body.status).toBe('success');
    expect(lines.some((l) => l.includes('stop delivered'))).toBe(false);
    await handle.stop();
    await handle.done;
  });

  test('失败方式：自然完成先于停止（sawDone 优先）→ success 不被改判 stopped', async () => {
    const api = new FakeMachineApi();
    api.stopResponse = true;
    // stop() 无门控效果的后端：拉取置位后流仍自然跑完（done 事件在位）。
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const backend: AgentBackend = {
      capabilities: PI_CAPABILITIES,
      async createSession() {
        return {
          sessionId: 'pi-sess-late',
          events: (async function* () {
            yield { type: 'text_delta', text: '收尾中' } as StepEvent;
            await gate;
            yield { type: 'done', usage: [] } as StepEvent;
          })(),
          async steer() {},
          async stop() {}, // 无操作——流不被中断（模拟 stop 与完成竞态）
          usage: () => [],
        };
      },
      async continueSession() {
        throw new Error('unused');
      },
    };
    const { handle, lines } = await boot({ api, backend });
    await waitFor(() => api.parked !== null);
    api.parked?.(CLAIMED);
    await waitFor(() => lines.some((l) => l.includes('new session conv-1')));
    api.onStreamEvent?.({ type: 'stop', stepId: 's1' });
    await waitFor(() => api.calls.includes('stop:s1'));
    release();
    await waitFor(() => api.doneBodies.length === 1);
    expect(api.doneBodies[0]?.body.status).toBe('success');
    expect(lines.some((l) => l.includes('stop arrived after completion'))).toBe(true);
    await handle.stop();
    await handle.done;
  });

  test('失败方式：步收尾后无在跑 handle → 拉取成功也丢弃不炸（日志行 + 循环存活）', async () => {
    const api = new FakeMachineApi();
    api.stopResponse = true;
    const probe = { stopCalls: 0 };
    const { backend, release } = stoppableBackend(probe);
    const { handle, lines } = await boot({ api, backend });
    await waitFor(() => api.parked !== null);
    api.parked?.(CLAIMED);
    await waitFor(() => lines.some((l) => l.includes('new session conv-1')));
    release();
    await waitFor(() => api.doneBodies.length === 1); // 步收尾，handle 已注销
    api.onStreamEvent?.({ type: 'stop', stepId: 's1' });
    await waitFor(() => lines.some((l) => l.includes('stop dropped (no live session)')));
    expect(probe.stopCalls).toBe(0);
    await handle.stop();
    await handle.done;
  });
});
