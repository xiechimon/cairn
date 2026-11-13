import type { StepJournalRow } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { build as buildTable, step, stepRoute, todo as todoTable } from '../src/db/schema.js';
import { nowMs } from '../src/lib/ids.js';
import { H, registerChiefHarness } from './chief-harness.js';
import { req } from './helpers.js';

registerChiefHarness();

function seedBuild(buildId: string, seqNum: number): number {
  const now = nowMs();
  const todoId = `todo-${buildId}`;
  H.s.db
    .insert(todoTable)
    .values({
      id: todoId,
      teamId: H.teamId,
      projectId: H.projectId,
      title: 'engine run on live data',
      spec: '',
      phase: 'building',
      phaseAt: now,
      seqNum,
    })
    .run();
  H.s.db
    .insert(buildTable)
    .values({ id: buildId, todoId, withPlan: false, triggerSource: 'user', createdAt: now })
    .run();
  return now;
}

async function journal(buildId: string): Promise<StepJournalRow[]> {
  const res = await req(H.s.app, 'GET', `/api/builds/${buildId}/steps`);
  expect(res.status).toBe(200);
  return (await res.json()) as StepJournalRow[];
}

describe('step journal carries the run window and the engine that ran it', () => {
  test('a routed, finished step sends its start, end, harness and model', async () => {
    const buildId = 'build-journal-routed';
    const now = seedBuild(buildId, 9501);
    H.s.db
      .insert(step)
      .values({
        id: 'step-journal-routed',
        buildId,
        kind: 'build',
        status: 'done',
        machineId: 'machine-a',
        createdAt: now,
        claimedAt: now + 1_000,
        finishedAt: now + 61_000,
      })
      .run();
    H.s.db
      .insert(stepRoute)
      .values({
        stepId: 'step-journal-routed',
        teamId: H.teamId,
        kind: 'build',
        difficulty: 'hard',
        harness: 'claude-code',
        provider: 'claude-code',
        modelId: 'claude-sonnet-5-5',
        machineId: 'machine-a',
        reason: 'not sent',
        rejected: [],
        decidedAt: now,
      })
      .run();
    const [row] = await journal(buildId);
    expect(row).toMatchObject({
      startedAt: now + 1_000,
      finishedAt: now + 61_000,
      route: { harness: 'claude-code', modelId: 'claude-sonnet-5-5' },
    });
    expect(JSON.stringify(row)).not.toContain('not sent');
  });

  test('a step without a route row sends a null route', async () => {
    const buildId = 'build-journal-unrouted';
    const now = seedBuild(buildId, 9502);
    H.s.db
      .insert(step)
      .values({
        id: 'step-journal-unrouted',
        buildId,
        kind: 'build',
        status: 'claimed',
        machineId: 'machine-a',
        createdAt: now,
        claimedAt: now + 500,
      })
      .run();
    const [row] = await journal(buildId);
    expect(row?.route).toBeNull();
    expect(row?.startedAt).toBe(now + 500);
    expect(row).not.toHaveProperty('finishedAt');
  });

  test('a step never claimed sends no start or end', async () => {
    const buildId = 'build-journal-pending';
    const now = seedBuild(buildId, 9503);
    H.s.db
      .insert(step)
      .values({
        id: 'step-journal-pending',
        buildId,
        kind: 'build',
        status: 'stopped',
        createdAt: now,
      })
      .run();
    const [row] = await journal(buildId);
    expect(row).not.toHaveProperty('startedAt');
    expect(row).not.toHaveProperty('finishedAt');
    expect(row?.route).toBeNull();
  });
});
