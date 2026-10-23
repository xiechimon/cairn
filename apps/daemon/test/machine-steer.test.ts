// steer 投递（W3 #279：事件 → 拉取-确认 → handle.steer）（#1128 自 machine-loop.test.ts 拆分；共享 harness 收编位
// = ./machine-loop-harness.ts，每个测试自 boot 自停）。

import type { AgentBackend, DeliveredImage, StepEvent } from '@cairn/shared';
import { formatAttachmentToken } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { PI_CAPABILITIES } from '../src/backend/pi.js';
import { boot, CLAIMED, FakeMachineApi, waitFor } from './machine-loop-harness.js';

describe('steer 投递（W3 #279：事件 → 拉取-确认 → AgentSessionHandle.steer）', () => {
  /** 门控 handle：首事件后停住（步「在跑」），release 后 done 收尾。 */
  function gatedBackend(steered: string[]) {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const backend: AgentBackend = {
      capabilities: PI_CAPABILITIES,
      async createSession() {
        return {
          sessionId: 'pi-sess-steer',
          events: (async function* () {
            yield { type: 'text_delta', text: '跑着' } as StepEvent;
            await gate;
            yield { type: 'done', usage: [] } as StepEvent;
          })(),
          async steer(text: string) {
            steered.push(text);
          },
          async stop() {},
          usage: () => [],
        };
      },
      async continueSession() {
        throw new Error('unused in steer tests');
      },
    };
    return { backend, release };
  }

  test('steer 事件 → 拉取-确认 → 在跑 session 的 handle.steer(text)', async () => {
    const api = new FakeMachineApi();
    api.steerResponse = '顺便把测试也补上';
    const steered: string[] = [];
    const { backend, release } = gatedBackend(steered);
    const { handle, lines } = await boot({ api, backend });
    await waitFor(() => api.parked !== null);
    api.parked?.(CLAIMED);
    await waitFor(() => lines.some((l) => l.includes('new session conv-1')));
    api.onStreamEvent?.({ type: 'steer', stepId: 's1' });
    await waitFor(() => steered.length === 1);
    expect(steered).toEqual(['顺便把测试也补上']);
    expect(api.calls).toContain('steer:s1');
    release();
    await handle.stop();
    await handle.done;
  });

  test('失败方式：拉取空（server 门拒/旧步丢弃）→ 不 steer 不炸', async () => {
    const api = new FakeMachineApi();
    api.steerResponse = null;
    const steered: string[] = [];
    const { backend, release } = gatedBackend(steered);
    const { handle, lines } = await boot({ api, backend });
    await waitFor(() => api.parked !== null);
    api.parked?.(CLAIMED);
    await waitFor(() => lines.some((l) => l.includes('new session conv-1')));
    api.onStreamEvent?.({ type: 'steer', stepId: 's1' });
    await waitFor(() => api.calls.includes('steer:s1'));
    await new Promise((r) => setTimeout(r, 50));
    expect(steered).toEqual([]);
    release();
    await handle.stop();
    await handle.done;
  });

  test('steer 文本携带整行图片 token → 解析下载 → handle.steer(展开文本, images)（#730）', async () => {
    const api = new FakeMachineApi();
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    api.attachments.id1 = {
      fileName: 'shot.png',
      mimeType: 'image/png',
      sizeBytes: png.byteLength,
      contentBase64: png.toString('base64'),
    };
    const token = formatAttachmentToken('shot.png', 't1/id1.png');
    api.steerResponse = `补一张图\n\n${token}`;
    const steered: { text: string; images?: readonly DeliveredImage[] }[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const backend: AgentBackend = {
      capabilities: PI_CAPABILITIES,
      async createSession() {
        return {
          sessionId: 'pi-sess-steer-img',
          events: (async function* () {
            yield { type: 'text_delta', text: '跑着' } as StepEvent;
            await gate;
            yield { type: 'done', usage: [] } as StepEvent;
          })(),
          async steer(text: string, images?: readonly DeliveredImage[]) {
            steered.push({ text, images });
          },
          async stop() {},
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
    api.onStreamEvent?.({ type: 'steer', stepId: 's1' });
    await waitFor(() => steered.length === 1);
    expect(steered[0]!.text).toContain('[image attached: shot.png]');
    expect(steered[0]!.text).not.toContain('attachment:t1/id1.png');
    expect(steered[0]!.images).toEqual([{ data: png.toString('base64'), mimeType: 'image/png' }]);
    expect(api.attachmentCalls).toEqual(['s1:id1']);
    release();
    await handle.stop();
    await handle.done;
  });

  test('失败方式（#730 先判活再下载）：无在跑 handle → 拉取后即丢，不白下字节', async () => {
    const api = new FakeMachineApi();
    const token = formatAttachmentToken('shot.png', 't1/id1.png');
    api.steerResponse = `补一张图\n\n${token}`;
    api.attachments.id1 = {
      fileName: 'shot.png',
      mimeType: 'image/png',
      sizeBytes: 4,
      contentBase64: 'AAAA',
    };
    const steered: { text: string; images?: readonly DeliveredImage[] }[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const backend: AgentBackend = {
      capabilities: PI_CAPABILITIES,
      async createSession() {
        return {
          sessionId: 'pi-sess-steer-dead',
          events: (async function* () {
            yield { type: 'text_delta', text: '跑着' } as StepEvent;
            await gate;
            yield { type: 'done', usage: [] } as StepEvent;
          })(),
          async steer(text: string, images?: readonly DeliveredImage[]) {
            steered.push({ text, images });
          },
          async stop() {},
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
    release();
    await waitFor(() => api.doneBodies.length === 1); // 步收尾，handle 已注销
    api.onStreamEvent?.({ type: 'steer', stepId: 's1' });
    await waitFor(() => lines.some((l) => l.includes('steer dropped (no live session)')));
    expect(api.attachmentCalls).toHaveLength(0); // 先判活：一字节都没下
    expect(steered).toHaveLength(0);
    await handle.stop();
    await handle.done;
  });

  test('失败方式（#730 步不崩）：steer 里的图片下载 409 → 注记入 steer 文本、零图片、循环存活', async () => {
    const api = new FakeMachineApi();
    const token = formatAttachmentToken('shot.png', 't1/id1.png');
    api.steerResponse = `补一张图\n\n${token}`;
    api.attachments.id1 = new Error('machine api 409: attachment id1 not ready (pending)');
    const steered: { text: string; images?: readonly DeliveredImage[] }[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const backend: AgentBackend = {
      capabilities: PI_CAPABILITIES,
      async createSession() {
        return {
          sessionId: 'pi-sess-steer-fail',
          events: (async function* () {
            yield { type: 'text_delta', text: '跑着' } as StepEvent;
            await gate;
            yield { type: 'done', usage: [] } as StepEvent;
          })(),
          async steer(text: string, images?: readonly DeliveredImage[]) {
            steered.push({ text, images });
          },
          async stop() {},
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
    api.onStreamEvent?.({ type: 'steer', stepId: 's1' });
    await waitFor(() => steered.length === 1);
    expect(steered[0]!.text).toContain(token); // token 原样保留
    expect(steered[0]!.text).toContain('不可用');
    expect(steered[0]!.images ?? []).toHaveLength(0);
    release();
    await handle.stop();
    await handle.done;
  });

  test('失败方式：步收尾后无在跑 handle → 拉取成功也丢弃不炸（日志行 + 循环存活）', async () => {
    const api = new FakeMachineApi();
    api.steerResponse = '晚到的补充';
    const steered: string[] = [];
    const { backend, release } = gatedBackend(steered);
    const { handle, lines } = await boot({ api, backend });
    await waitFor(() => api.parked !== null);
    api.parked?.(CLAIMED);
    await waitFor(() => lines.some((l) => l.includes('new session conv-1')));
    release();
    await waitFor(() => api.doneBodies.length === 1); // 步收尾，handle 已注销
    api.onStreamEvent?.({ type: 'steer', stepId: 's1' });
    await waitFor(() => lines.some((l) => l.includes('steer dropped (no live session)')));
    expect(steered).toEqual([]);
    await handle.stop();
    await handle.done;
  });
});
