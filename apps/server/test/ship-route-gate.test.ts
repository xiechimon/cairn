import { CONTINUE_PROMPTS, type MergeBlocker, type MergeReadiness } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import {
  build as buildTable,
  project as projectTable,
  step as stepTable,
  team,
  todo as todoTable,
} from '../src/db/schema.js';
import { type BuildDeps, requestMerge, startBuilds } from '../src/services/builds.js';
import { parseShipGateInstruction, reverifyShip } from '../src/services/ship-gate.js';
import { setTodoPhase } from '../src/services/todos.js';
import { bootServer, postProject, req } from './helpers.js';

const s = bootServer();
afterAll(() => s.dispose());

const HEAD = 'a'.repeat(40);
const MOVED = 'c'.repeat(40);

const BLOCKER: MergeBlocker = {
  code: 'review-missing',
  class: 'transient',
  label: 'review missing',
  detail: [],
};

function readiness(headSha: string, blockers: MergeReadiness['blockers'] = []): MergeReadiness {
  return {
    ready: blockers.length === 0,
    headSha,
    patchDigest: 'd'.repeat(64),
    policy: 'autonomous',
    blockers,
  };
}

function depsWith(verdict: () => MergeReadiness): BuildDeps {
  return { ...s.svc, mergeVerdict: async () => verdict() };
}

async function reviewBuild(route: 'custom' | 'local-merge', withPr = true): Promise<string> {
  const projectId = await postProject(s.app);
  if (route === 'local-merge') {
    s.db
      .update(projectTable)
      .set({ repoKind: 'local' })
      .where(eq(projectTable.id, projectId))
      .run();
  }
  if (route === 'custom' && withPr) {
    s.db
      .update(projectTable)
      .set({ repoKind: 'github', githubRepo: 'octo/demo' })
      .where(eq(projectTable.id, projectId))
      .run();
  }
  await req(s.app, 'PUT', `/api/projects/${projectId}/ship-route`, { shipRoute: route });
  const created = (await (
    await req(s.app, 'POST', `/api/projects/${projectId}/todos`, { title: 'ship me', spec: '' })
  ).json()) as { id: string };
  startBuilds(s.svc, {
    projectId,
    todoIds: [created.id],
    assignment: { plan: null, build: null },
    withPlan: true,
  });
  setTodoPhase(s.svc, created.id, 'planning');
  setTodoPhase(s.svc, created.id, 'confirm');
  s.db
    .update(todoTable)
    .set({ phase: 'review', hasChanges: true })
    .where(eq(todoTable.id, created.id))
    .run();
  const buildId =
    s.db.select().from(todoTable).where(eq(todoTable.id, created.id)).get()?.latestBuildId ?? '';
  if (withPr) {
    s.db.update(buildTable).set({ prNumber: 7 }).where(eq(buildTable.id, buildId)).run();
  }
  return buildId;
}

function mergeSteps(buildId: string) {
  return s.db
    .select()
    .from(stepTable)
    .where(eq(stepTable.buildId, buildId))
    .all()
    .filter((r) => r.kind === 'merge');
}

function setPaused(paused: boolean): void {
  s.db.update(team).set({ autonomyPaused: paused }).where(eq(team.id, s.team.id)).run();
}

describe('every ship route needs a mergeable gate verdict for the current head', () => {
  test('custom route with a blocked verdict enqueues no merge step', async () => {
    const buildId = await reviewBuild('custom');
    await expect(
      requestMerge(
        depsWith(() => readiness(HEAD, [BLOCKER])),
        buildId,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(mergeSteps(buildId)).toHaveLength(0);
  });

  test('custom route on a local or PR-less build is refused and enqueues no step', async () => {
    const localBuild = await reviewBuild('custom', false);
    await expect(
      requestMerge(
        depsWith(() => readiness(HEAD)),
        localBuild,
      ),
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('GitHub pull request'),
    });
    expect(mergeSteps(localBuild)).toHaveLength(0);
  });

  test('custom route on a local project is refused and enqueues no step', async () => {
    const buildId = await reviewBuild('custom');
    const projectId = s.db
      .select({ projectId: todoTable.projectId })
      .from(todoTable)
      .innerJoin(buildTable, eq(buildTable.todoId, todoTable.id))
      .where(eq(buildTable.id, buildId))
      .get()?.projectId;
    s.db
      .update(projectTable)
      .set({ repoKind: 'local', githubRepo: null })
      .where(eq(projectTable.id, projectId ?? ''))
      .run();
    await expect(
      requestMerge(
        depsWith(() => readiness(HEAD)),
        buildId,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(mergeSteps(buildId)).toHaveLength(0);
  });

  test('custom route without any verdict source fails closed', async () => {
    const buildId = await reviewBuild('custom');
    await expect(requestMerge(s.svc, buildId)).rejects.toMatchObject({ status: 409 });
    expect(mergeSteps(buildId)).toHaveLength(0);
  });

  test('an open autonomy brake blocks the custom route even for a mergeable verdict', async () => {
    const buildId = await reviewBuild('custom');
    setPaused(true);
    try {
      await expect(
        requestMerge(
          depsWith(() => readiness(HEAD)),
          buildId,
        ),
      ).rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining('autonomy-paused'),
      });
      expect(mergeSteps(buildId)).toHaveLength(0);
    } finally {
      setPaused(false);
    }
  });

  test('an open autonomy brake blocks the local-merge route', async () => {
    const buildId = await reviewBuild('local-merge');
    setPaused(true);
    try {
      await expect(
        requestMerge(
          depsWith(() => readiness(HEAD)),
          buildId,
        ),
      ).rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining('autonomy-paused'),
      });
      expect(mergeSteps(buildId)).toHaveLength(0);
    } finally {
      setPaused(false);
    }
  });

  test('local-merge route with a blocked verdict enqueues no merge step', async () => {
    const buildId = await reviewBuild('local-merge');
    await expect(
      requestMerge(
        depsWith(() => readiness(HEAD, [BLOCKER])),
        buildId,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(mergeSteps(buildId)).toHaveLength(0);
  });

  test('a mergeable verdict enqueues the custom step with the Ship prompt bound to the judged head', async () => {
    const buildId = await reviewBuild('custom');
    await req(s.app, 'PUT', '/api/prompts/ship', { text: 'Squash and push to main.' });
    try {
      await requestMerge(
        depsWith(() => readiness(HEAD)),
        buildId,
      );
      const [merge] = mergeSteps(buildId);
      expect(merge?.prompt?.startsWith('Squash and push to main.')).toBe(true);
      expect(merge?.prompt).toContain(`--match-head-commit ${HEAD}`);
      expect(parseShipGateInstruction(merge?.prompt ?? null)).toEqual({
        buildId,
        judgedHead: HEAD,
      });
    } finally {
      await req(s.app, 'DELETE', '/api/prompts/ship');
    }
  });

  test('without an edit the custom step carries the default Ship text', async () => {
    const buildId = await reviewBuild('custom');
    await requestMerge(
      depsWith(() => readiness(HEAD)),
      buildId,
    );
    expect(mergeSteps(buildId)[0]?.prompt?.startsWith(CONTINUE_PROMPTS.merge)).toBe(true);
  });
});

describe('the merge step re-checks the verdict for the head it lands', () => {
  async function enqueued() {
    const buildId = await reviewBuild('custom');
    await requestMerge(
      depsWith(() => readiness(HEAD)),
      buildId,
    );
    const row = mergeSteps(buildId)[0];
    if (row === undefined) throw new Error('merge step missing');
    return row;
  }

  test('same head and a mergeable verdict passes, ignoring the step own work-in-flight blocker', async () => {
    const row = await enqueued();
    const inFlight: MergeBlocker = { ...BLOCKER, code: 'work-in-flight' };
    expect(
      await reverifyShip(
        depsWith(() => readiness(HEAD, [inFlight])),
        row,
      ),
    ).toBeNull();
  });

  test('a head that moved after the verdict is refused', async () => {
    const row = await enqueued();
    expect(
      await reverifyShip(
        depsWith(() => readiness(MOVED)),
        row,
      ),
    ).toMatch(/head/);
  });

  test('a verdict that became blocked is refused', async () => {
    const row = await enqueued();
    expect(
      await reverifyShip(
        depsWith(() => readiness(HEAD, [BLOCKER])),
        row,
      ),
    ).toMatch(/review missing/);
  });

  test('an autonomy brake opened after enqueue is refused', async () => {
    const row = await enqueued();
    setPaused(true);
    try {
      expect(
        await reverifyShip(
          depsWith(() => readiness(HEAD)),
          row,
        ),
      ).toMatch(/autonomy-paused/);
    } finally {
      setPaused(false);
    }
  });

  test('a build without a GitHub PR is refused at claim time', async () => {
    const row = await enqueued();
    s.db.update(buildTable).set({ prNumber: null }).where(eq(buildTable.id, row.buildId)).run();
    expect(
      await reverifyShip(
        depsWith(() => readiness(HEAD)),
        row,
      ),
    ).toMatch(/GitHub pull request/);
  });

  test('steps without a ship instruction are not touched', async () => {
    const row = await enqueued();
    expect(
      await reverifyShip(
        depsWith(() => readiness(MOVED)),
        { ...row, prompt: 'plain' },
      ),
    ).toBeNull();
  });
});
