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

describe('a host Runner has no concurrency cap (docs/design/no-machine-concurrency-cap.md)', () => {
  test('three steps run at once, the Runner keeps claiming and sends no maxWorkers; graceful stop waits for them', async () => {
    const api = new FakeMachineApi();
    const gates = [defer<void>(), defer<void>(), defer<void>()];
    let createdCount = 0;
    const backend: AgentBackend = {
      capabilities: PI_CAPABILITIES,
      async createSession() {
        const n = createdCount++;
        return gatedSession(`sess-${n + 1}`, gates[n]!.promise);
      },
      async continueSession(id) {
        return gatedSession(id, gates[2]!.promise);
      },
    };
    const { handle, lines } = await boot({ api, backend });
    for (const n of [1, 2, 3]) {
      await waitFor(() => api.parked !== null);
      api.parked?.(claimedFor(`s${n}`, `conv-${n}`));
      await waitFor(() =>
        lines.some((l) => l.includes(`step s${n} for conv conv-${n} (${n} running)`)),
      );
    }
    await waitFor(() => api.parked !== null);
    expect(
      api.claimBodies.every((b) => !(b as object | undefined) || !('maxWorkers' in (b as object))),
    ).toBe(true);
    let settled = false;
    void handle.done.then(() => {
      settled = true;
    });
    await handle.stop();
    await new Promise((r) => setTimeout(r, 60));
    expect(settled).toBe(false);
    for (const g of gates) g.resolve();
    await handle.done;
    expect(api.doneBodies.map((d) => d.stepId).sort()).toEqual(['s1', 's2', 's3']);
  });
});
