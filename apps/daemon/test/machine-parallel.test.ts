import type { AgentBackend, AgentSessionHandle, ClaimedStep, StepEvent } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { PI_CAPABILITIES } from '../src/backend/pi.js';
import { boot, CLAIMED, FakeMachineApi, waitFor } from './machine-loop-harness.js';

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

describe('#1108 parallel execution loop (localCap concurrency + free-slot handoff + graceful stop)', () => {
  test('P1+P2+P3: cap=2 runs two steps concurrently, no claim while in-flight is full, slot freed on close and re-claimed', async () => {
    const api = new FakeMachineApi();
    api.mePatch = { maxConcurrent: 2 };
    const gate1 = defer<void>();
    const gate2 = defer<void>();
    let createdCount = 0;
    const backend: AgentBackend = {
      capabilities: PI_CAPABILITIES,
      async createSession() {
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
    api.parked?.(claimedFor('s1', 'conv-1'));
    const claimsAfter1 = api.claimCalls;
    await waitFor(() => api.claimCalls > claimsAfter1);
    api.parked?.(claimedFor('s2', 'conv-2'));
    await waitFor(() => lines.some((l) => l.includes('step s2 for conv conv-2 (2 running)')));
    expect(lines.some((l) => l.includes('step s1 for conv conv-1 (1 running)'))).toBe(true);
    const claimsAtFull = api.claimCalls;
    await new Promise((r) => setTimeout(r, 80));
    expect(api.claimCalls).toBeLessThanOrEqual(claimsAtFull + 1);
    expect(api.parked).not.toBeNull();
    gate1.resolve();
    await waitFor(() => api.doneBodies.some((d) => d.stepId === 's1'));
    await waitFor(() => api.parked !== null);
    api.parked?.(claimedFor('s3', 'conv-3'));
    await waitFor(() => lines.some((l) => l.includes('step s3 for conv conv-3 (2 running)')));
    let settled = false;
    void handle.done.then(() => {
      settled = true;
    });
    await handle.stop();
    await new Promise((r) => setTimeout(r, 60));
    expect(settled).toBe(false);
    gate2.resolve();
    await handle.done;
    expect(settled).toBe(true);
    expect(api.doneBodies.map((d) => d.stepId)).toContain('s2');
    expect(api.doneBodies.map((d) => d.stepId)).toContain('s3');
  });

  test('P5: me lacks the maxConcurrent field (old server) → localCap falls back to 1, serial', async () => {
    const api = new FakeMachineApi();
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
    const claimsAfter1 = api.claimCalls;
    await new Promise((r) => setTimeout(r, 80));
    expect(api.claimCalls).toBe(claimsAfter1);
    expect(lines.some((l) => l.includes('step s1 for conv conv-1 (1 running)'))).toBe(true);
    gate1.resolve();
    await waitFor(() => api.doneBodies.length === 1);
    await waitFor(() => api.claimCalls > claimsAfter1);
    await handle.stop();
    await handle.done;
  });
});
