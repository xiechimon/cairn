import { afterEach, describe, expect, test, vi } from 'vitest';
import { COORDINATOR_COMPACT_AT } from './agent-backend.js';
import { agentTurnKindOf, agentTurnPolicyFor, startTurnHeartbeat } from './agent-turn.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('agentTurnKindOf', () => {
  test('classifies chief steps on chief threads as coordinator and all others as task', () => {
    expect(agentTurnKindOf('chief', 'chief-thread-1')).toBe('coordinator');
    expect(agentTurnKindOf('chief', 'build-1')).toBe('task');
    expect(agentTurnKindOf('build', 'chief-thread-1')).toBe('task');
    expect(agentTurnKindOf('plan', 'build-1')).toBe('task');
    expect(agentTurnKindOf('review', 'build-1')).toBe('task');
  });
});

describe('agentTurnPolicyFor', () => {
  test('computes uniform coordinator vs task policy defaults', () => {
    expect(agentTurnPolicyFor({ stepKind: 'chief', conversationId: 'chief-1' })).toEqual({
      kind: 'coordinator',
      compactAt: COORDINATOR_COMPACT_AT,
      readOnly: false,
      lockedDown: true,
      remoteToolsOnly: false,
      allowSkillLists: false,
    });

    expect(agentTurnPolicyFor({ stepKind: 'build', conversationId: 'build-1' })).toEqual({
      kind: 'task',
      readOnly: false,
      lockedDown: false,
      remoteToolsOnly: false,
      allowSkillLists: true,
    });

    expect(
      agentTurnPolicyFor({
        stepKind: 'review',
        conversationId: 'build-1',
        isReview: true,
        remoteToolsOnly: true,
      }),
    ).toEqual({
      kind: 'task',
      readOnly: true,
      lockedDown: true,
      remoteToolsOnly: true,
      allowSkillLists: true,
    });
  });
});

describe('startTurnHeartbeat', () => {
  test('beats on interval without overlap, forwards errors, and stops cleanly', async () => {
    vi.useFakeTimers();
    let resolveSlow!: () => void;
    let calls = 0;
    const errors: unknown[] = [];

    const handle = startTurnHeartbeat({
      intervalMs: 1_000,
      beat: () => {
        calls += 1;
        if (calls === 1) {
          return new Promise<void>((resolve) => {
            resolveSlow = resolve;
          });
        }
        if (calls === 2) {
          return Promise.reject(new Error('lost claim'));
        }
      },
      onError: (err) => errors.push(err),
    });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toBe(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toBe(1);

    resolveSlow();
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toBe(2);
    expect(errors).toHaveLength(1);

    handle.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toBe(2);
  });
});
