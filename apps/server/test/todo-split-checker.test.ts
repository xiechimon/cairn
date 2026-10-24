import { describe, expect, test } from 'vitest';
import { checkSplitPlan, type SplitCheckerInput } from '../src/services/todo-split-checker.js';

const machine = {
  online: true,
  enabledRuntimes: ['pi'],
  capabilities: null,
  claudeCodeReport: null,
} as const;

const base = (overrides: Partial<SplitCheckerInput> = {}): SplitCheckerInput => ({
  subtodos: [
    { title: 'A', spec: 'a', agentId: 'agent-a', blockedBy: [] },
    { title: 'B', spec: 'b', agentId: 'agent-a', blockedBy: [1] },
  ],
  agents: [
    {
      id: 'agent-a',
      status: 'active',
      provider: 'pi',
      modelId: null,
      requiredCapabilities: null,
      machine,
    },
  ],
  ...overrides,
});

describe('split_todo checker', () => {
  test('rejects a dependency cycle and an out-of-range edge', () => {
    expect(
      checkSplitPlan(
        base({
          subtodos: [
            { title: 'A', spec: 'a', agentId: 'agent-a', blockedBy: [2] },
            { title: 'B', spec: 'b', agentId: 'agent-a', blockedBy: [1] },
          ],
        }),
      ).reasons,
    ).toEqual(expect.arrayContaining([expect.stringContaining('成环')]));
    expect(
      checkSplitPlan(
        base({
          subtodos: [{ title: 'A', spec: 'a', agentId: 'agent-a', blockedBy: [2] }],
        }),
      ).reasons,
    ).toEqual(expect.arrayContaining([expect.stringContaining('范围')]));
  });

  test('rejects a missing or offline agent', () => {
    expect(
      checkSplitPlan(
        base({ subtodos: [{ title: 'A', spec: 'a', agentId: 'ghost', blockedBy: [] }] }),
      ).reasons,
    ).toEqual(expect.arrayContaining([expect.stringContaining('agent ghost')]));
    expect(
      checkSplitPlan(
        base({
          agents: [
            {
              ...base().agents[0]!,
              machine: { ...machine, online: false },
            },
          ],
        }),
      ).reasons,
    ).toEqual(expect.arrayContaining([expect.stringContaining('离线')]));
  });

  test('rejects more than the configured child limit', () => {
    expect(
      checkSplitPlan(
        base({
          maxChildren: 1,
        }),
      ).reasons,
    ).toEqual(expect.arrayContaining([expect.stringContaining('上限')]));
  });

  test('rejects a spec that names a protected path', () => {
    expect(
      checkSplitPlan(
        base({
          subtodos: [
            {
              title: 'A',
              spec: '改动 .github/workflows/check.yml',
              agentId: 'agent-a',
              blockedBy: [],
            },
            { title: 'B', spec: 'b', agentId: 'agent-a', blockedBy: [1] },
          ],
        }),
      ).reasons,
    ).toEqual(expect.arrayContaining([expect.stringContaining('.github/')]));
  });

  test('passes a valid plan', () => {
    expect(checkSplitPlan(base())).toEqual({ ok: true, reasons: [] });
  });
});
