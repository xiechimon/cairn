// stop 投递（M7 #308：事件 → 拉取-确认 → handle.stop → done(stopped)）（#1128 自 machine-loop.test.ts 拆分；共享 harness 收编位
// = ./machine-loop-harness.ts，每个测试自 boot 自停）。

import type { AgentBackend, StepEvent } from '@pacman/shared';
import { describe, expect, test } from 'vitest';
import { PI_CAPABILITIES } from '../src/backend/pi.js';
import { StepJournal } from '../src/journal.js';
import {
  boot,
  CLAIMED,
  defer,
  FakeMachineApi,
  fakeBackend,
  waitFor,
} from './machine-loop-harness.js';

/** 门控 handle（pi abort 语义同形）：首事件后停住；stop() 结束事件流
 * （不产 done 事件——PiSessionHandle.stop = abort + queue.end 的对偶）；
 * release() = 自然完成（done 事件）。opened 在位时 createSession 挂到它。 */
function stoppableBackend(
  probe: { stopCalls: number; createCalls?: number },
  opened?: Promise<void>,
) {
  const natural = defer();
  let stopped = false;
  const backend: AgentBackend = {
    capabilities: PI_CAPABILITIES,
    async createSession() {
      probe.createCalls = (probe.createCalls ?? 0) + 1;
      await opened;
      return {
        sessionId: 'pi-sess-stop',
        events: (async function* () {
          yield { type: 'text_delta', text: '跑着' } as StepEvent;
          await natural.promise;
          if (!stopped) yield { type: 'done', usage: [] } as StepEvent;
        })(),
        async steer() {},
        async stop() {
          probe.stopCalls += 1;
          stopped = true;
          natural.resolve();
        },
        usage: () => [],
      };
    },
    async continueSession() {
      throw new Error('unused in stop tests');
    },
  };
  return { backend, release: natural.resolve };
}

describe('stop 投递（M7 #308：事件 → 拉取-确认 → AgentSessionHandle.stop → done(stopped)）', () => {
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

// 已接收的停止送达本机这一步的 run（verify-step-claim F3 / P4）。失败方式：
//   1. 准备期（会话未开）拉到停止 → 停止被丢、会话照开照跑完 → 应不开会话、报 stopped
//   2. 会话开启途中（createSession 在途）拉到停止 → 同上被丢 → 应一开即中断、报 stopped
//   3. 两轮会话之间（流断续跑 / 协议回落重开）拉到停止 → 下一轮照跑 → 应一开即中断
//      （runner-network-retry.test.ts）
//   4. 同一步在本机有两次 run → 停止只到一次 → #1473 起领取循环不起第二次
//      （step-reclaim.test.ts），本机一步只有一个停止位
//   5. 接收停止后 daemon 重启、会话没跑完 → recover 重跑 → 应开会话前按 stopped 收尾
//      （machine-recover.test.ts）
//   6. 接收停止后重启、会话已跑完待补报 → 应补报原结果，完成优先（machine-recover.test.ts）
//   7. 本机没有这一步在跑，或 run 已过收尾判定 → 照旧丢弃，不落 journal（否则崩溃
//      重启会把跑完的会话报成 stopped）
//   8. 中断调用本身抛错 → 不按 stopped 判（会话没真停），journal 记录抹掉
describe('已接收的停止送达本机这一步的 run（F3）', () => {
  /** token 拉取挂到 tokenGate：runStep 停在准备期（会话未开）。 */
  class TokenGateApi extends FakeMachineApi {
    tokenCalls = 0;
    readonly tokenGate = defer();
    override async token(stepId: string) {
      this.tokenCalls += 1;
      await this.tokenGate.promise;
      return super.token(stepId);
    }
  }

  /** 终稿上传挂到 uploadGate：会话已跑完、收尾在途。 */
  class UploadGateApi extends FakeMachineApi {
    uploadCalls = 0;
    readonly uploadGate = defer();
    override async uploadUrls(stepId: string) {
      this.uploadCalls += 1;
      await this.uploadGate.promise;
      return super.uploadUrls(stepId);
    }
  }

  test('失败方式 1：准备期拉到的停止 → 落 journal、不开会话、报 stopped', async () => {
    const api = new TokenGateApi();
    api.stopResponse = true;
    const probe = { stopCalls: 0, createCalls: 0 };
    const { backend } = stoppableBackend(probe);
    const { handle, lines, paths } = await boot({ api, backend });
    await waitFor(() => api.parked !== null);
    api.parked?.(CLAIMED);
    await waitFor(() => api.tokenCalls === 1);
    api.onStreamEvent?.({ type: 'stop', stepId: 's1' });
    await waitFor(() => lines.some((l) => /stop (delivered|dropped)/.test(l)));
    expect(lines.some((l) => l.includes('stop dropped'))).toBe(false);
    expect(new StepJournal(paths.outboxDir).get('s1')?.stopRequest).toEqual({ discard: true });
    api.tokenGate.resolve();
    await waitFor(() => api.doneBodies.length === 1);
    expect(api.doneBodies[0]?.body.status).toBe('stopped');
    expect(probe.createCalls).toBe(0);
    expect(api.uploads[0]?.body.messages.some((m) => m.role === 'user')).toBe(true);
    expect(new StepJournal(paths.outboxDir).get('s1')).toBeNull();
    await handle.stop();
    await handle.done;
  });

  test('失败方式 2：会话开启途中拉到的停止 → 会话一开即中断、报 stopped', async () => {
    const api = new FakeMachineApi();
    api.stopResponse = true;
    const probe = { stopCalls: 0, createCalls: 0 };
    const opened = defer();
    const { backend } = stoppableBackend(probe, opened.promise);
    const { handle, lines } = await boot({ api, backend });
    await waitFor(() => api.parked !== null);
    api.parked?.(CLAIMED);
    await waitFor(() => probe.createCalls === 1);
    api.onStreamEvent?.({ type: 'stop', stepId: 's1' });
    await waitFor(() => lines.some((l) => /stop (delivered|dropped)/.test(l)));
    expect(lines.some((l) => l.includes('stop dropped'))).toBe(false);
    opened.resolve();
    await waitFor(() => api.doneBodies.length === 1);
    expect(api.doneBodies[0]?.body.status).toBe('stopped');
    expect(probe.stopCalls).toBe(1);
    await handle.stop();
    await handle.done;
  });

  test('失败方式 8：中断调用抛错 → 会话没真停，收尾不按 stopped 判', async () => {
    const api = new FakeMachineApi();
    api.stopResponse = false;
    const natural = defer();
    const backend: AgentBackend = {
      capabilities: PI_CAPABILITIES,
      async createSession() {
        return {
          sessionId: 'pi-sess-throw',
          events: (async function* () {
            yield { type: 'text_delta', text: '跑着' } as StepEvent;
            await natural.promise;
            yield { type: 'error', error: { message: 'boom', retryable: false } } as StepEvent;
          })(),
          async steer() {},
          async stop() {
            throw new Error('abort failed');
          },
          usage: () => [],
        };
      },
      async continueSession() {
        throw new Error('unused');
      },
    };
    const { handle, lines, paths } = await boot({ api, backend });
    await waitFor(() => api.parked !== null);
    api.parked?.(CLAIMED);
    await waitFor(() => lines.some((l) => l.includes('new session conv-1')));
    api.onStreamEvent?.({ type: 'stop', stepId: 's1' });
    await waitFor(() => lines.some((l) => l.includes('stop delivery failed')));
    expect(new StepJournal(paths.outboxDir).get('s1')?.stopRequest ?? null).toBeNull();
    natural.resolve();
    await waitFor(() => api.doneBodies.length === 1);
    expect(api.doneBodies[0]?.body.status).toBe('failed');
    await handle.stop();
    await handle.done;
  });

  test('失败方式 7：收尾中（会话已跑完、终稿上传在途）拉到的停止 → 丢弃、不落 journal、照报原结果', async () => {
    const api = new UploadGateApi();
    api.stopResponse = true;
    const { backend } = fakeBackend(
      [
        { type: 'text_delta', text: '写完了' },
        { type: 'done', usage: [] },
      ],
      'pi-sess-done',
    );
    const { handle, lines, paths } = await boot({ api, backend });
    await waitFor(() => api.parked !== null);
    api.parked?.(CLAIMED);
    await waitFor(() => api.uploadCalls === 1);
    api.onStreamEvent?.({ type: 'stop', stepId: 's1' });
    await waitFor(() => lines.some((l) => /stop (delivered|dropped)/.test(l)));
    expect(lines.some((l) => l.includes('stop dropped (no live session)'))).toBe(true);
    expect(new StepJournal(paths.outboxDir).get('s1')?.stopRequest ?? null).toBeNull();
    api.uploadGate.resolve();
    await waitFor(() => api.doneBodies.length === 1);
    expect(api.doneBodies[0]?.body.status).toBe('success');
    await handle.stop();
    await handle.done;
  });
});
