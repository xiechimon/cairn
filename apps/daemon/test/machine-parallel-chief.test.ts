import type { AgentBackend, AgentSessionHandle, ClaimedStep, StepEvent } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { PI_CAPABILITIES } from '../src/backend/pi.js';
import { portBaseForSlot } from '../src/machine-loop.js';
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

describe('#1148 port base (CAIRN_PORT_BASE slot segmentation)', () => {
  test('C6: concurrent worker steps get different CAIRN_PORT_BASE segments; chief carries none; segments reused after release', async () => {
    const api = new FakeMachineApi();
    const gate1 = defer<void>();
    const gate2 = defer<void>();
    const gateChief = defer<void>();
    const backend = recordingBackend([gate1.promise, gate2.promise, gateChief.promise]);
    const { handle } = await boot({ api, backend });
    const created = (backend as unknown as { created: { env?: Record<string, string> }[] }).created;
    await waitFor(() => api.parked !== null);
    api.parked?.(claimedFor('s1', 'conv-1'));
    await waitFor(() => api.parked !== null);
    api.parked?.(claimedFor('s2', 'conv-2'));
    await waitFor(() => created.length >= 2);
    expect(created[0]?.env?.CAIRN_PORT_BASE).toBe('20000');
    expect(created[1]?.env?.CAIRN_PORT_BASE).toBe('20100');
    await waitFor(() => api.parked !== null);
    api.parked?.(claimedFor('c1', 'chief-t1', 'chief'));
    await waitFor(() => created.length >= 3);
    expect(created[2]?.env?.CAIRN_PORT_BASE).toBeUndefined();
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

  test('C7: segment formula portBaseForSlot (slot ×100, first segment 20000)', () => {
    expect(portBaseForSlot(1)).toBe(20_000);
    expect(portBaseForSlot(2)).toBe(20_100);
    expect(portBaseForSlot(3)).toBe(20_200);
    expect(portBaseForSlot(11)).toBe(21_000);
  });
});
