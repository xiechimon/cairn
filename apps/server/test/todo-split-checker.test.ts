import { describe, expect, test } from 'vitest';
import { checkSplitPlan, type SplitCheckerInput } from '../src/services/todo-split-checker.js';

const machine = {
  name: 'test',
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
    ).toEqual(expect.arrayContaining([expect.stringContaining('cycle')]));
    expect(
      checkSplitPlan(
        base({
          subtodos: [{ title: 'A', spec: 'a', agentId: 'agent-a', blockedBy: [2] }],
        }),
      ).reasons,
    ).toEqual(expect.arrayContaining([expect.stringContaining('range')]));
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
    ).toEqual(expect.arrayContaining([expect.stringContaining('offline')]));
  });

  test('rejects more than the configured child limit', () => {
    expect(
      checkSplitPlan(
        base({
          maxChildren: 1,
        }),
      ).reasons,
    ).toEqual(expect.arrayContaining([expect.stringContaining('limit')]));
  });

  test('rejects a spec that names a protected path', () => {
    expect(
      checkSplitPlan(
        base({
          subtodos: [
            {
              title: 'A',
              spec: 'edit .github/workflows/check.yml',
              agentId: 'agent-a',
              blockedBy: [],
            },
            { title: 'B', spec: 'b', agentId: 'agent-a', blockedBy: [1] },
          ],
        }),
      ).reasons,
    ).toEqual(expect.arrayContaining([expect.stringContaining('.github/')]));
  });

  test('falls back to human review while autonomy is paused', () => {
    expect(checkSplitPlan(base({ autonomyPaused: true }))).toEqual({
      ok: false,
      reasons: ['team autonomy is paused'],
    });
  });

  test.each([
    'AGENTS.md',
    'CLAUDE.md',
    'package.json',
    'pnpm-lock.yaml',
    'biome.json',
    '.github/',
    'docs/adr/',
    'apps/server/src/services/merge-gate/',
    'apps/web/src/unsafe:name.ts',
    'docs/ſpec/plan.md',
    'apps/server/src/merge gate/file.ts',
    'apps/server/src/unsafe file.ts',
  ])('falls back for protected or unclear path %s', (path) => {
    const result = checkSplitPlan(
      base({
        subtodos: [
          { title: 'A', spec: `Edit \`${path}\`.`, agentId: 'agent-a' },
          { title: 'B', spec: 'ordinary implementation', agentId: 'agent-a', blockedBy: [1] },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining('protected path')]),
    );
  });

  test('passes a valid plan', () => {
    expect(checkSplitPlan(base())).toEqual({ ok: true, reasons: [] });
  });
});
