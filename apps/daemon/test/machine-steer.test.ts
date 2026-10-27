import type { AgentBackend, DeliveredImage, StepEvent } from '@cairn/shared';
import { formatAttachmentToken } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { PI_CAPABILITIES } from '../src/backend/pi.js';
import { boot, CLAIMED, FakeMachineApi, waitFor } from './machine-loop-harness.js';

describe('steer delivery (W3 #279: event → fetch-ack → AgentSessionHandle.steer)', () => {
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

  test('steer event → fetch-ack → handle.steer(text) on the running session', async () => {
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

  test('failure mode: empty fetch (server gate rejected / old step dropped) → no steer, no crash', async () => {
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

  test('steer text carries full-line image tokens → parsed and downloaded → handle.steer(expanded text, images) (#730)', async () => {
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

  test('failure mode (#730 liveness checked before download): no running handle → dropped after fetch, no bytes wasted', async () => {
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
    await waitFor(() => api.doneBodies.length === 1);
    api.onStreamEvent?.({ type: 'steer', stepId: 's1' });
    await waitFor(() => lines.some((l) => l.includes('steer dropped (no live session)')));
    expect(api.attachmentCalls).toHaveLength(0);
    expect(steered).toHaveLength(0);
    await handle.stop();
    await handle.done;
  });

  test('failure mode (#730 step must not crash): image download 409 inside steer → annotated in the steer text, zero images, loop survives', async () => {
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
    expect(steered[0]!.text).toContain(token);
    expect(steered[0]!.text).toContain('不可用');
    expect(steered[0]!.images ?? []).toHaveLength(0);
    release();
    await handle.stop();
    await handle.done;
  });

  test.each([true, false])(
    'degraded step (#1671, initial image=%s): steering annotates unread images without downloading them',
    async (initialImage) => {
      const transcriptRows: { role: string; content: unknown }[] = [];
      const api = Object.assign(new FakeMachineApi(), {
        async transcriptRow(_stepId: string, row: { role: string; content: unknown }) {
          transcriptRows.push(row);
        },
      });
      const png = Buffer.from('89504e470d0a1a0a', 'hex');
      api.attachments.id1 = {
        fileName: 'shot.png',
        mimeType: 'image/png',
        sizeBytes: png.byteLength,
        contentBase64: png.toString('base64'),
      };
      const token = formatAttachmentToken('shot.png', 't1/id1.png');
      const claimed: typeof CLAIMED = {
        ...CLAIMED,
        todo: { ...CLAIMED.todo!, spec: initialImage ? `写一行探针\n\n${token}` : '写一行探针' },
      };
      api.steerResponse = `再看一眼这张图\n\n${token}`;
      const steered: { text: string; images?: readonly DeliveredImage[] }[] = [];
      let release: () => void = () => {};
      const gate = new Promise<void>((r) => {
        release = r;
      });
      let probes = 0;
      const backend: AgentBackend = {
        capabilities: PI_CAPABILITIES,
        async createSession() {
          return {
            sessionId: 'pi-sess-steer-novision',
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
        async modelSupportsImages() {
          probes += 1;
          return !initialImage && probes === 1 ? null : false;
        },
      };
      const { handle, lines } = await boot({ api, backend });
      await waitFor(() => api.parked !== null);
      api.parked?.(claimed);
      await waitFor(() => lines.some((l) => l.includes('new session conv-1')));
      if (initialImage)
        await waitFor(() => lines.some((l) => l.includes('image attachment skipped')));
      expect(api.attachmentCalls).toHaveLength(0);
      api.onStreamEvent?.({ type: 'steer', stepId: 's1' });
      await waitFor(() => steered.length === 1);
      expect(steered[0]!.text).toContain(token);
      expect(steered[0]!.text).toContain('[图片附件 t1/id1.png 未被模型读取 — 该图片未下载]');
      expect(steered[0]!.text).not.toContain('[image attached:');
      expect(steered[0]!.images ?? []).toHaveLength(0);
      expect(api.attachmentCalls).toHaveLength(0);
      expect(transcriptRows).toContainEqual(
        expect.objectContaining({
          role: 'system',
          content: expect.stringContaining('图片未被模型读取'),
        }),
      );
      release();
      await handle.stop();
      await handle.done;
      expect(api.uploads.flatMap(({ body }) => body.messages)).toContainEqual(
        expect.objectContaining({
          role: 'system',
          content: expect.stringContaining('追加消息中的'),
        }),
      );
    },
  );

  test('failure mode: no running handle after the step closed → dropped even on successful fetch, no crash (log line + loop survives)', async () => {
    const api = new FakeMachineApi();
    api.steerResponse = '晚到的补充';
    const steered: string[] = [];
    const { backend, release } = gatedBackend(steered);
    const { handle, lines } = await boot({ api, backend });
    await waitFor(() => api.parked !== null);
    api.parked?.(CLAIMED);
    await waitFor(() => lines.some((l) => l.includes('new session conv-1')));
    release();
    await waitFor(() => api.doneBodies.length === 1);
    api.onStreamEvent?.({ type: 'steer', stepId: 's1' });
    await waitFor(() => lines.some((l) => l.includes('steer dropped (no live session)')));
    expect(steered).toEqual([]);
    await handle.stop();
    await handle.done;
  });
});
