import { join } from 'node:path';
import { DEFAULT_AUTONOMY_SETTINGS } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { createApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { openDbWithHandle } from '../src/db/client.js';
import {
  build,
  buildFeedback,
  plan,
  project,
  routingRule,
  step,
  todo,
  workPolicy,
} from '../src/db/schema.js';
import { seed } from '../src/db/seed.js';
import { createEphemeralSecretBox } from '../src/lib/secret-box.js';
import { applyBuildStepAction, sweepPlanAutoConfirm } from '../src/services/builds.js';
import { confirmBuild } from '../src/services/chief-tools.js';
import { ConversationStreamHub, TeamStreamHub } from '../src/services/events.js';
import { MachineWakeHub } from '../src/services/machine-wake-hub.js';
import { req } from './helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

const READY_AT = 1_800_000_000_000;
const DEADLINE = READY_AT;
const GOOD_PLAN = 'Kind: fix\n## Verification\n- `pnpm test` passes\n';

function world() {
  const dir = makeTestTempDir('d121-');
  cleanups.push(() => releaseTestTempDir(dir));
  let opened = openDbWithHandle(join(dir, 'server.db'));
  cleanups.push(() => opened.close());
  const { user, team } = seed(opened.db);
  const makeContext = (): AppContext => ({
    db: opened.db,
    user,
    team,
    hub: new TeamStreamHub(),
    machineHub: new MachineWakeHub(),
    convHub: new ConversationStreamHub(),
    secretBox: createEphemeralSecretBox(),
    vapidKeys: null,
    pingIntervalMs: 3_600_000,
    claimHoldMs: 1,
    uploads: new Map(),
    enrollments: new Map(),
    oauthStates: new Map(),
    xaiDeviceStates: new Map(),
    oauthClient: null,
    authToken: null,
    reposDir: dir,
    attachmentsDir: dir,
    skillsDir: dir,
    skillSourcesPath: join(dir, 'sources.json'),
    mcpConfigPath: join(dir, 'mcp.json'),
  });
  let ctx = makeContext();
  let app = createApp(ctx);
  const db = opened.db;
  db.insert(project)
    .values({
      id: 'project',
      name: 'D121',
      teamId: team.id,
      autonomy: { ...DEFAULT_AUTONOMY_SETTINGS, mergePolicy: 'autonomous' },
    })
    .run();
  db.insert(routingRule)
    .values({
      id: 'session-rule',
      teamId: team.id,
      use: 'session',
      provider: 'claude-code',
      modelId: 'claude-sonnet-5-5',
      createdAt: READY_AT,
      updatedAt: READY_AT,
    })
    .run();
  db.insert(workPolicy)
    .values({
      id: 'session-policy',
      teamId: team.id,
      use: 'session',
      seededFromAgentId: 'legacy-agent',
      tools: [],
      mcpServers: [],
      secrets: [],
      createdAt: READY_AT,
      updatedAt: READY_AT,
    })
    .run();
  db.insert(todo)
    .values({
      id: 'todo',
      projectId: 'project',
      teamId: team.id,
      title: 'Owner controls',
      createdBy: user.id,
      ownerId: user.id,
      phase: 'confirm',
      phaseAt: READY_AT,
      seqNum: 1,
    })
    .run();
  db.insert(build)
    .values({
      id: 'build',
      todoId: 'todo',
      withPlan: true,
      triggerSource: 'user',
      createdAt: READY_AT,
      prUrl: 'https://github.com/example/demo/pull/42',
      prNumber: 42,
    })
    .run();
  db.update(todo).set({ latestBuildId: 'build' }).where(eq(todo.id, 'todo')).run();
  db.insert(plan)
    .values({ id: 'plan', buildId: 'build', version: 1, content: GOOD_PLAN, createdAt: READY_AT })
    .run();
  return {
    get db() {
      return opened.db;
    },
    get app() {
      return app;
    },
    get deps() {
      return { ...ctx, box: ctx.secretBox };
    },
    restart() {
      opened.close();
      opened = openDbWithHandle(join(dir, 'server.db'));
      ctx = makeContext();
      app = createApp(ctx);
    },
    async plans() {
      const response = await req(app, 'GET', '/api/builds/build/plans');
      expect(response.status).toBe(200);
      return response.json() as Promise<
        { id: string; autoApproveAt: number | null; autoApprovePausedAt: number | null }[]
      >;
    },
    phase() {
      return opened.db.select().from(todo).where(eq(todo.id, 'todo')).get()!.phase;
    },
  };
}

test.each([null, 'github'] as const)(
  'review in %s can finish without merge permission and retain its PR',
  async (repoKind) => {
    const w = world();
    w.db
      .update(project)
      .set({ repoKind, githubRepo: repoKind === 'github' ? 'example/demo' : null })
      .run();
    w.db.update(todo).set({ phase: 'review', hasChanges: true }).where(eq(todo.id, 'todo')).run();
    const permission = await req(w.app, 'GET', '/api/builds/build/merge-permission');
    expect(permission.status).toBe(200);
    expect(await permission.json()).toEqual({
      permitted: false,
      missingTools: ['合并分支', '推送分支'],
      prUrl: 'https://github.com/example/demo/pull/42',
    });
    const merge = await req(w.app, 'POST', '/api/builds/build/merge', {});
    expect(merge.status).toBe(403);
    expect(w.phase()).toBe('review');
    const finish = await req(w.app, 'PATCH', '/api/todos/todo', { phase: 'done' });
    expect(finish.status).toBe(200);
    expect(w.phase()).toBe('done');
    expect(w.db.select().from(step).all()).toEqual([]);
    expect(w.db.select().from(build).get()?.prNumber).toBe(42);
    w.restart();
    expect(w.phase()).toBe('done');
  },
);

test('merge permission API follows both session policy switches', async () => {
  const w = world();
  w.db
    .update(workPolicy)
    .set({ tools: ['合并分支', '推送分支'] })
    .where(eq(workPolicy.id, 'session-policy'))
    .run();
  const response = await req(w.app, 'GET', '/api/builds/build/merge-permission');
  expect(await response.json()).toMatchObject({ permitted: true, missingTools: [] });
  expect((await req(w.app, 'GET', '/api/builds/missing/merge-permission')).status).toBe(404);
});

test('an eligible plan is confirmed by the first sweep after a restart, exactly once', async () => {
  const w = world();
  expect((await w.plans())[0]?.autoApproveAt).toBe(DEADLINE);
  w.restart();
  expect((await w.plans())[0]?.autoApproveAt).toBe(DEADLINE);
  sweepPlanAutoConfirm(w.deps);
  expect(w.phase()).toBe('building');
  sweepPlanAutoConfirm(w.deps);
  expect(w.db.select().from(step).all()).toHaveLength(1);
  expect((await w.plans())[0]?.autoApproveAt).toBeNull();
});

test('pause is idempotent, persists across restart, and manual approval still works', async () => {
  const w = world();
  const paused = await req(w.app, 'POST', '/api/builds/build/plans/plan/pause-auto-approve', {});
  expect(paused.status).toBe(200);
  const first = await paused.json();
  expect(first).toMatchObject({
    id: 'plan',
    autoApproveAt: null,
    autoApprovePausedAt: expect.any(Number),
  });
  const repeated = await req(w.app, 'POST', '/api/builds/build/plans/plan/pause-auto-approve', {});
  expect(await repeated.json()).toEqual(first);
  w.restart();
  expect((await w.plans())[0]).toEqual(first);
  sweepPlanAutoConfirm(w.deps);
  expect(w.phase()).toBe('confirm');
  expect((await req(w.app, 'POST', '/api/builds/build/steps', { action: 'confirm' })).status).toBe(
    202,
  );
  expect(w.phase()).toBe('building');
});

test('pause only targets the current plan of the current build at confirmation', async () => {
  const w = world();
  w.db
    .insert(plan)
    .values({
      id: 'new-plan',
      buildId: 'build',
      version: 2,
      content: GOOD_PLAN,
      createdAt: READY_AT + 1,
    })
    .run();
  expect(
    (await req(w.app, 'POST', '/api/builds/build/plans/plan/pause-auto-approve', {})).status,
  ).toBe(409);
  expect(
    (await req(w.app, 'POST', '/api/builds/build/plans/missing/pause-auto-approve', {})).status,
  ).toBe(404);
  expect((await w.plans()).map((p) => p.autoApproveAt)).toEqual([null, DEADLINE]);
  w.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, 'todo')).run();
  expect(
    (await req(w.app, 'POST', '/api/builds/build/plans/new-plan/pause-auto-approve', {})).status,
  ).toBe(409);
});

test('project disable survives restart, preserves other settings, and leaves manual approval available', async () => {
  const w = world();
  const response = await req(w.app, 'PATCH', '/api/projects/project/merge-policy', {
    planAutoApproveEnabled: false,
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    mergePolicy: 'autonomous',
    planAutoApproveEnabled: false,
  });
  w.restart();
  expect((await w.plans())[0]?.autoApproveAt).toBeNull();
  const config = await req(w.app, 'GET', '/api/projects/project/merge-policy');
  expect(await config.json()).toMatchObject({ planAutoApproveEnabled: false });
  sweepPlanAutoConfirm(w.deps);
  expect(w.phase()).toBe('confirm');
  expect((await req(w.app, 'POST', '/api/builds/build/steps', { action: 'confirm' })).status).toBe(
    202,
  );
});

test('project list reports the stored plan auto-approve toggle', async () => {
  const w = world();
  await req(w.app, 'PATCH', '/api/projects/project/merge-policy', {
    planAutoApproveEnabled: false,
  });
  const list = (await (await req(w.app, 'GET', '/api/projects')).json()) as {
    id: string;
    planAutoApproveEnabled?: boolean;
  }[];
  expect(list.find((item) => item.id === 'project')?.planAutoApproveEnabled).toBe(false);
});

test.each([
  'human',
  'questions',
  'invalid',
  'archived',
  'busy',
  'stale',
  'split',
  'revision',
] as const)('no deadline when blocked by %s', async (reason) => {
  const w = world();
  if (reason === 'human')
    w.db
      .update(project)
      .set({ autonomy: { ...DEFAULT_AUTONOMY_SETTINGS, mergePolicy: 'human' } })
      .run();
  if (reason === 'questions')
    w.db
      .update(plan)
      .set({ content: `${GOOD_PLAN}\n## Open questions\nChoose storage` })
      .run();
  if (reason === 'split') {
    const parent = w.db.select().from(todo).get()!;
    w.db
      .insert(todo)
      .values({ ...parent, id: 'child', seqNum: 2, sourceTodo: 'todo', latestBuildId: null })
      .run();
  }
  if (reason === 'revision')
    w.db
      .insert(buildFeedback)
      .values({
        id: 'revision',
        buildId: 'build',
        kind: 'revision',
        side: 'plan',
        feedback: 'Revise scope',
        actor: 'Owner',
        createdAt: READY_AT,
      })
      .run();
  if (reason === 'invalid') w.db.update(plan).set({ content: 'no verification' }).run();
  if (reason === 'archived') w.db.update(todo).set({ archivedAt: READY_AT }).run();
  if (reason === 'busy')
    w.db
      .insert(step)
      .values({
        id: 'busy',
        buildId: 'build',
        kind: 'plan',
        status: 'pending',
        createdAt: READY_AT,
      })
      .run();
  if (reason === 'stale') w.db.update(todo).set({ latestBuildId: null }).run();
  expect((await w.plans())[0]?.autoApproveAt).toBeNull();
  sweepPlanAutoConfirm(w.deps);
  expect(w.phase()).toBe('confirm');
});

test('pausing one version does not pause its replacement or another build', async () => {
  const w = world();
  expect(
    (await req(w.app, 'POST', '/api/builds/build/plans/plan/pause-auto-approve', {})).status,
  ).toBe(200);
  w.db
    .insert(plan)
    .values({
      id: 'replacement',
      buildId: 'build',
      version: 2,
      content: GOOD_PLAN,
      createdAt: READY_AT + 1,
    })
    .run();
  expect((await w.plans()).map((p) => p.autoApproveAt)).toEqual([null, DEADLINE]);
  w.db
    .insert(build)
    .values({
      id: 'other',
      todoId: 'todo',
      withPlan: true,
      triggerSource: 'user',
      createdAt: READY_AT + 1,
    })
    .run();
  expect(
    (await req(w.app, 'POST', '/api/builds/other/plans/replacement/pause-auto-approve', {})).status,
  ).toBe(404);
  w.db.update(todo).set({ latestBuildId: 'other' }).run();
  expect(
    (await req(w.app, 'POST', '/api/builds/build/plans/replacement/pause-auto-approve', {})).status,
  ).toBe(409);
  expect((await w.plans()).every((p) => p.autoApproveAt === null)).toBe(true);
});

test('project toggle rejects non-booleans and re-enabling does not clear a plan pause', async () => {
  const w = world();
  const path = '/api/projects/project/merge-policy';
  expect((await req(w.app, 'PATCH', path, { planAutoApproveEnabled: 'false' })).status).toBe(400);
  expect(
    (await req(w.app, 'POST', '/api/builds/build/plans/plan/pause-auto-approve', {})).status,
  ).toBe(200);
  expect((await req(w.app, 'PATCH', path, { planAutoApproveEnabled: false })).status).toBe(200);
  expect((await req(w.app, 'PATCH', path, { planAutoApproveEnabled: true })).status).toBe(200);
  expect((await w.plans())[0]?.autoApproveAt).toBeNull();
});

test.each(['pause', 'disabled'] as const)(
  'automatic confirmation respects %s while user approval proceeds',
  async (reason) => {
    const w = world();
    if (reason === 'pause')
      expect(
        (await req(w.app, 'POST', '/api/builds/build/plans/plan/pause-auto-approve', {})).status,
      ).toBe(200);
    else
      expect(
        (
          await req(w.app, 'PATCH', '/api/projects/project/merge-policy', {
            planAutoApproveEnabled: false,
          })
        ).status,
      ).toBe(200);
    const message =
      reason === 'pause'
        ? /paused.*explicit user approval/i
        : /disabled.*project.*explicit user approval/i;
    await expect(confirmBuild(w.deps, 'build')).rejects.toThrow(message);
    await expect(
      applyBuildStepAction(w.deps, 'build', { action: 'confirm' }, 'Agent', 'automatic'),
    ).rejects.toThrow(message);
    expect(w.phase()).toBe('confirm');
    expect(w.db.select().from(step).all()).toHaveLength(0);
    expect(
      (await req(w.app, 'POST', '/api/builds/build/steps', { action: 'confirm' })).status,
    ).toBe(202);
    expect(w.phase()).toBe('building');
  },
);
