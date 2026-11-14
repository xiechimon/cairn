import { describe, expect, it, vi } from 'vitest';
import type { MachineApi } from '../src/machine-client.js';
import { createStepReporters } from '../src/step-reporters.js';

function fakeClient(activity: MachineApi['activity'], agentTodo: MachineApi['agentTodo']) {
  return { activity, agentTodo } as unknown as MachineApi;
}

describe('createStepReporters', () => {
  it('reports the preparing phase at creation', () => {
    const activity = vi.fn(async () => {});
    createStepReporters({
      stepId: 's1',
      client: () => fakeClient(activity, undefined),
      log: () => {},
      now: () => 0,
    });
    expect(activity).toHaveBeenCalledWith('s1', expect.objectContaining({ phase: 'preparing' }));
  });

  it('sends through the client current at send time', () => {
    const first = vi.fn(async () => {});
    const second = vi.fn(async () => {});
    let client = fakeClient(first, first);
    const { agentTodo } = createStepReporters({
      stepId: 's1',
      client: () => client,
      log: () => {},
      now: () => 0,
    });
    client = fakeClient(second, second);
    agentTodo.report([{ text: 'a', state: 'todo' }]);
    expect(second).toHaveBeenCalledWith('s1', { items: [{ text: 'a', state: 'todo' }] });
  });

  it('logs an activity relay failure once', async () => {
    let t = 0;
    const lines: string[] = [];
    const activity = vi.fn(async () => {
      throw new Error('down');
    });
    const reporters = createStepReporters({
      stepId: 's1',
      client: () => fakeClient(activity, undefined),
      log: (line) => lines.push(line),
      now: () => t,
    });
    t = 10_000;
    reporters.activity.setPhase('thinking');
    await new Promise((resolve) => setImmediate(resolve));
    expect(activity.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(lines).toEqual(['activity relay failed (suppressed until next step): down']);
  });
});
