import type { MachineOfflineBody, MachineOfflineResponse } from '@cairn/shared';
import { expect, test } from 'vitest';
import { GOODBYE_TIMEOUT_MS } from '../src/machine-loop.js';
import { boot, FakeMachineApi, waitFor } from './machine-loop-harness.js';

class GoodbyeApi extends FakeMachineApi {
  goodbyes: MachineOfflineBody[] = [];
  hang = false;
  fail = false;

  override async presence(body?: { cliVersion?: string; claudeCode?: unknown }) {
    this.calls.push('presence-start');
    await new Promise((r) => setTimeout(r, 30));
    await super.presence(body);
  }

  async offline(body: MachineOfflineBody, signal?: AbortSignal): Promise<MachineOfflineResponse> {
    this.calls.push('offline');
    this.goodbyes.push(body);
    if (this.fail) throw new Error('network down');
    if (this.hang) {
      await new Promise<void>((_, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason));
      });
    }
    return { applied: true };
  }
}

async function bootConnected(api: GoodbyeApi) {
  const booted = await boot({ api, presenceIntervalMs: 20 });
  await waitFor(() => api.onStreamEvent !== null);
  return booted;
}

test('presence carries null before hello and the last connection id after it', async () => {
  const api = new GoodbyeApi();
  await boot({ api, presenceIntervalMs: 40 });
  await waitFor(() => api.onStreamEvent !== null);
  expect((api.presenceBodies[0] as { connectionId?: unknown }).connectionId).toBeNull();
  api.onStreamEvent?.({ type: 'hello', connectionId: 'conn-1' });
  api.onStreamEvent?.({ type: 'hello', connectionId: 'conn-2' });
  await waitFor(() =>
    api.presenceBodies.some((b) => (b as { connectionId?: unknown }).connectionId === 'conn-2'),
  );
  expect(
    api.presenceBodies.some((b) => (b as { connectionId?: unknown }).connectionId === 'conn-1'),
  ).toBe(false);
});

test('stop sends goodbye with the last connection id and starts no presence after it', async () => {
  const api = new GoodbyeApi();
  const { handle } = await bootConnected(api);
  api.onStreamEvent?.({ type: 'hello', connectionId: 'conn-7' });
  await new Promise((r) => setTimeout(r, 60));
  await handle.stop();
  await new Promise((r) => setTimeout(r, 100));
  expect(api.goodbyes).toEqual([{ connectionId: 'conn-7' }]);
  expect(api.calls.slice(api.calls.indexOf('offline')).includes('presence-start')).toBe(false);
});

test('a goodbye that hangs is cut off at the timeout and does not block shutdown', async () => {
  const api = new GoodbyeApi();
  api.hang = true;
  const { handle } = await bootConnected(api);
  api.onStreamEvent?.({ type: 'hello', connectionId: 'conn-h' });
  const started = Date.now();
  await handle.stop();
  expect(api.goodbyes).toHaveLength(1);
  expect(Date.now() - started).toBeLessThan(GOODBYE_TIMEOUT_MS + 1_500);
  expect(GOODBYE_TIMEOUT_MS).toBe(2_000);
});

test('a failed goodbye does not block shutdown', async () => {
  const api = new GoodbyeApi();
  api.fail = true;
  const { handle, lines } = await bootConnected(api);
  api.onStreamEvent?.({ type: 'hello', connectionId: 'conn-f' });
  await handle.stop();
  expect(api.goodbyes).toHaveLength(1);
  expect(lines.some((l) => l.includes('goodbye failed'))).toBe(true);
});

test('a daemon that never received hello sends no goodbye', async () => {
  const api = new GoodbyeApi();
  const { handle } = await bootConnected(api);
  await handle.stop();
  expect(api.goodbyes).toEqual([]);
});
