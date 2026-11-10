import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import {
  build as buildTable,
  step,
  stepRoute,
  todo as todoTable,
  tokenUsage,
} from '../src/db/schema.js';
import { nowMs } from '../src/lib/ids.js';
import { H, registerChiefHarness, relay } from './chief-harness.js';

registerChiefHarness();

describe('chief usage exposes step_route harness', () => {
  test('routes name pi for openai-codex and claude-code for Claude Code', async () => {
    const todoId = 'todo-usage-harness';
    const buildId = 'build-usage-harness';
    const now = nowMs();
    H.s.db
      .insert(todoTable)
      .values({
        id: todoId,
        teamId: H.teamId,
        projectId: H.projectId,
        title: 'harness visibility',
        spec: '',
        phase: 'todo',
        phaseAt: now,
        seqNum: 9401,
      })
      .run();
    H.s.db
      .insert(buildTable)
      .values({ id: buildId, todoId, withPlan: false, triggerSource: 'user', createdAt: now })
      .run();
    H.s.db
      .insert(tokenUsage)
      .values({ buildId, model: 'openai-codex/gpt-6.1-sol', input: 11 })
      .run();
    H.s.db
      .insert(step)
      .values([
        {
          id: 'step-codex-usage',
          buildId,
          kind: 'build',
          status: 'done',
          machineId: 'machine-a',
          createdAt: now,
          finishedAt: now,
        },
        {
          id: 'step-claude-usage',
          buildId,
          kind: 'build',
          status: 'done',
          machineId: 'machine-a',
          createdAt: now + 1,
          finishedAt: now + 1,
        },
      ])
      .run();
    H.s.db
      .insert(stepRoute)
      .values([
        {
          stepId: 'step-codex-usage',
          teamId: H.teamId,
          kind: 'build',
          difficulty: 'hard',
          harness: 'pi',
          provider: 'openai-codex',
          modelId: 'gpt-6.1-sol',
          machineId: 'machine-a',
          reason: 'test',
          rejected: [],
          decidedAt: now,
        },
        {
          stepId: 'step-claude-usage',
          teamId: H.teamId,
          kind: 'build',
          difficulty: 'easy',
          harness: 'claude-code',
          provider: 'claude-code',
          modelId: 'claude-haiku-5-5',
          machineId: 'machine-a',
          reason: 'test',
          rejected: [],
          decidedAt: now + 1,
        },
      ])
      .run();

    const body = (await relay('usage', { buildId })) as {
      usage: { buildId: string; model: string }[];
      routes: {
        buildId: string;
        stepId: string;
        harness: string | null;
        provider: string | null;
        modelId: string | null;
      }[];
    };
    expect(body.usage).toEqual([
      expect.objectContaining({ buildId, model: 'openai-codex/gpt-6.1-sol', input: 11 }),
    ]);
    expect(body.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          buildId,
          stepId: 'step-codex-usage',
          harness: 'pi',
          provider: 'openai-codex',
          modelId: 'gpt-6.1-sol',
        }),
        expect.objectContaining({
          buildId,
          stepId: 'step-claude-usage',
          harness: 'claude-code',
          provider: 'claude-code',
          modelId: 'claude-haiku-5-5',
        }),
      ]),
    );
    expect(
      H.s.db.select({ id: step.id }).from(step).where(eq(step.buildId, buildId)).all(),
    ).toHaveLength(2);
  });
});
