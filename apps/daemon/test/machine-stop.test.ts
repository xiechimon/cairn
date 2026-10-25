import type { AgentBackend, StepEvent } from '@cairn/shared';
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

describe('stop delivery (M7 #308: event → fetch-ack → AgentSessionHandle.stop → done(stopped))', () => {
  test('stop event → fetch-ack → live.stop() → done(stopped) report + transcript upload kept', async () => {
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
    expect(api.uploads.length).toBe(1);
    await handle.stop();
    await handle.done;
  });

  test('failure mode: empty fetch (server gate rejected / old step dropped) → no stop, natural success close', async () => {
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

  test('failure mode: natural completion before stop (sawDone wins) → success not re-judged as stopped', async () => {
    const api = new FakeMachineApi();
    api.stopResponse = true;
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
    api.onStreamEvent?.({ type: 'stop', stepId: 's1' });
    await waitFor(() => api.calls.includes('stop:s1'));
    release();
    await waitFor(() => api.doneBodies.length === 1);
    expect(api.doneBodies[0]?.body.status).toBe('success');
    expect(lines.some((l) => l.includes('stop arrived after completion'))).toBe(true);
    await handle.stop();
    await handle.done;
  });

  test('failure mode: no running handle after the step closed → dropped even on successful fetch, no crash (log line + loop survives)', async () => {
    const api = new FakeMachineApi();
    api.stopResponse = true;
    const probe = { stopCalls: 0 };
    const { backend, release } = stoppableBackend(probe);
    const { handle, lines } = await boot({ api, backend });
    await waitFor(() => api.parked !== null);
    api.parked?.(CLAIMED);
    await waitFor(() => lines.some((l) => l.includes('new session conv-1')));
    release();
    await waitFor(() => api.doneBodies.length === 1);
    api.onStreamEvent?.({ type: 'stop', stepId: 's1' });
    await waitFor(() => lines.some((l) => l.includes('stop dropped (no live session)')));
    expect(probe.stopCalls).toBe(0);
    await handle.stop();
    await handle.done;
  });
});

describe('an already-accepted stop reaches the run of this step on this machine (F3)', () => {
  class TokenGateApi extends FakeMachineApi {
    tokenCalls = 0;
    readonly tokenGate = defer();
    override async token(stepId: string) {
      this.tokenCalls += 1;
      await this.tokenGate.promise;
      return super.token(stepId);
    }
  }

  class UploadGateApi extends FakeMachineApi {
    uploadCalls = 0;
    readonly uploadGate = defer();
    override async uploadUrls(stepId: string) {
      this.uploadCalls += 1;
      await this.uploadGate.promise;
      return super.uploadUrls(stepId);
    }
  }

  test('failure mode 1: stop fetched during preparation → lands in journal, no session opened, reports stopped', async () => {
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

  test('failure mode 2: stop fetched while the session is opening → interrupted as soon as the session opens, reports stopped', async () => {
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

  test('failure mode 8: interrupt call throws → session not really stopped, close not judged as stopped', async () => {
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

  test('failure mode 7: stop fetched while closing (session finished, final upload in flight) → dropped, not journaled, original result reported as-is', async () => {
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
