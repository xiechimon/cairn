import { describe, expect, test } from 'vitest';
import { nextBackoffMs } from '../src/machine-loop.js';
import { boot, CLAIMED, FakeMachineApi, fakeBackend, waitFor } from './machine-loop-harness.js';

describe('claim loop and backoff (r3 §1.5: exponential backoff capped at 30s on outage, process does not exit)', () => {
  test('claim network failure → backoff log (base 10ms timestamps), keeps claiming after recovery', async () => {
    const api = new FakeMachineApi();
    api.failClaims = 2;
    const { handle, lines } = await boot({ api });
    await waitFor(() => lines.filter((l) => l.includes('claim failed')).length >= 2);
    expect(lines.some((l) => l.includes('backoff 10ms'))).toBe(true);
    expect(lines.some((l) => l.includes('backoff 20ms'))).toBe(true);
    await waitFor(() => api.parked !== null);
    await handle.stop();
    await handle.done;
  });

  test('backoff sequence capped at 30s (CLAIM_BACKOFF_CAP_MS = r3 §1.5 measured value)', () => {
    const seq: number[] = [];
    let b = 1_000;
    for (let i = 0; i < 8; i++) {
      seq.push(b);
      b = nextBackoffMs(b);
    }
    expect(seq).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
  });
});

describe('wake SSE vs in-flight claim (#482 ruling: client does not consume wake, low-latency dispatch is solved by the server-side hold)', () => {
  test('an in-flight claim is neither interrupted nor resent when a wake event arrives — the long poll holds, then claims as usual', async () => {
    const api = new FakeMachineApi();
    const { backend } = fakeBackend([{ type: 'done', usage: [] }]);
    const { handle, lines } = await boot({ api, backend });
    await waitFor(() => api.parked !== null);
    const callsBefore = api.claimCalls;

    api.onStreamEvent?.({ type: 'wake' });
    await new Promise((r) => setTimeout(r, 50));

    expect(api.parked).not.toBeNull();
    expect(api.claimCalls).toBe(callsBefore);
    expect(lines.some((l) => l.includes('claim failed'))).toBe(false);

    api.parked?.(CLAIMED);
    await waitFor(() => api.doneBodies.length === 1);
    expect(api.doneBodies[0]?.body.status).toBe('success');
    await handle.stop();
    await handle.done;
  });
});
