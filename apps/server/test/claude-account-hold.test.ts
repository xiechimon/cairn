import type { ClaudeCodeReport } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import {
  build as buildTable,
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  claudeSubscription as claudeSubscriptionTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { refreshClaudeRateParks } from '../src/services/claude-rate-limit.js';
import { claimStep } from '../src/services/machines.js';
import { stepQueueProjector } from '../src/services/step-queue.js';
import {
  bootServer,
  insertMachine,
  postProject,
  req,
  seedRoute,
  type TestServer,
} from './helpers.js';

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

let seq = 7_200;

const REPORT = {
  installed: true,
  hostname: 'omarchy',
  models: [{ id: 'stub-model', name: 'stub-model' }],
  auth: { state: 'logged-in', method: 'claude.ai', provider: 'firstParty' },
} as ClaudeCodeReport;

function claimAs(s: TestServer, machineId: string, authorized?: () => boolean) {
  return claimStep(
    {
      ...s.svc,
      box: s.secretBox,
      reposDir: s.reposDir,
      attachmentsDir: s.attachmentsDir,
      skillsDir: s.skillsDir,
    },
    machineId,
    s.team.id,
    10,
    'http://localhost',
    undefined,
    undefined,
    authorized,
  );
}

async function save(s: TestServer, label: string, letter: string): Promise<string> {
  const response = await req(s.app, 'POST', `/api/teams/${s.team.id}/claude-subscriptions`, {
    label,
    token: `sk-ant-oat01-${letter.repeat(64)}`,
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

function enableOnly(s: TestServer, id: string | null): void {
  s.db.update(claudeSubscriptionTable).set({ enabledAt: null }).run();
  if (id !== null) {
    s.db
      .update(claudeSubscriptionTable)
      .set({ enabledAt: Date.now() })
      .where(eq(claudeSubscriptionTable.id, id))
      .run();
  }
}

interface World {
  s: TestServer;
  machineId: string;
  first: string;
  second: string;
  projectId: string;
}

async function world(provider = 'claude-code'): Promise<World> {
  const s = bootServer({ githubFetch: async () => new Response('[]') });
  disposables.push(() => s.dispose());
  const projectId = await postProject(s.app, 'account-hold');
  const machineId = insertMachine(s, { name: 'hold', claudeCodeReport: REPORT });
  const first = await save(s, 'First', 'a');
  const second = await save(s, 'Second', 'b');
  seedRoute(s, 'session', {
    provider,
    modelId: 'stub-model',
    thinkingLevel: 'off',
    machineId,
  });
  return { s, machineId, first, second, projectId };
}

interface StepSeed {
  kind?: 'build' | 'review' | 'merge';
  byPerson?: boolean;
  claudeSubscriptionId?: string | null;
  sessionId?: string | null;
  status?: 'pending' | 'done' | 'waiting_quota';
  machineId?: string | null;
  quotaBlock?: typeof stepTable.$inferInsert.quotaBlock;
}

function newBuild(s: TestServer, projectId: string): { buildId: string } {
  seq += 1;
  const todoId = `todo-hold-${seq}`;
  const buildId = `build-hold-${seq}`;
  s.db
    .insert(todoTable)
    .values({
      id: todoId,
      teamId: s.team.id,
      projectId,
      seqNum: seq,
      title: `hold ${seq}`,
      spec: '',
      phase: 'queued',
      phaseAt: seq,
      latestBuildId: buildId,
    })
    .run();
  s.db
    .insert(buildTable)
    .values({
      id: buildId,
      todoId,
      withPlan: false,
      planDocId: null,
      triggerSource: 'user',
      createdAt: seq,
    })
    .run();
  return { buildId };
}

function addStep(s: TestServer, buildId: string, seed: StepSeed): string {
  seq += 1;
  const id = `step-hold-${seq}`;
  s.db
    .insert(stepTable)
    .values({
      id,
      buildId,
      kind: seed.kind ?? 'build',
      machineId: seed.machineId ?? null,
      status: seed.status ?? 'pending',
      sessionId: seed.sessionId ?? null,
      byPerson: seed.byPerson ?? false,
      claudeSubscriptionId: seed.claudeSubscriptionId ?? null,
      quotaBlock: seed.quotaBlock ?? null,
      freshSession: false,
      createdAt: seq,
    })
    .run();
  return id;
}

function stepRow(s: TestServer, id: string) {
  return s.db.select().from(stepTable).where(eq(stepTable.id, id)).get();
}

function blockedKind(s: TestServer, id: string, machineId: string): string | undefined {
  const row = stepRow(s, id);
  return stepQueueProjector(s.db, s.team.id).project({
    id,
    createdAt: row?.createdAt ?? 0,
    homeMachineId: machineId,
  })?.blocked?.kind;
}

describe('the account hold after a switch', () => {
  test('an automatic step bound to the old account is held, shown as account-switched, and runs again once that account is enabled', async () => {
    const { s, machineId, first, second, projectId } = await world();
    const { buildId } = newBuild(s, projectId);
    const stepId = addStep(s, buildId, { claudeSubscriptionId: first });
    enableOnly(s, second);
    expect(await claimAs(s, machineId)).toBeNull();
    expect(stepRow(s, stepId)).toMatchObject({ status: 'pending', claudeSubscriptionId: first });
    expect(blockedKind(s, stepId, machineId)).toBe('account-switched');
    enableOnly(s, first);
    expect(blockedKind(s, stepId, machineId)).toBeUndefined();
    expect((await claimAs(s, machineId))?.step.id).toBe(stepId);
    expect(stepRow(s, stepId)?.claudeSubscriptionId).toBe(first);
  });

  test('with no account enabled a stale binding is held instead of running on the machine login', async () => {
    const { s, machineId, first, projectId } = await world();
    const { buildId } = newBuild(s, projectId);
    const stepId = addStep(s, buildId, { claudeSubscriptionId: first });
    enableOnly(s, null);
    expect(await claimAs(s, machineId)).toBeNull();
    expect(blockedKind(s, stepId, machineId)).toBe('account-switched');
  });

  test('a step with no recorded account is still claimed and bound to the enabled one', async () => {
    const { s, machineId, second, projectId } = await world();
    const { buildId } = newBuild(s, projectId);
    const stepId = addStep(s, buildId, {});
    enableOnly(s, second);
    expect((await claimAs(s, machineId))?.step.id).toBe(stepId);
    expect(stepRow(s, stepId)?.claudeSubscriptionId).toBe(second);
  });

  test('a person-created step is never held and starts a new run on the new account', async () => {
    const { s, machineId, first, second, projectId } = await world();
    const { buildId } = newBuild(s, projectId);
    addStep(s, buildId, {
      status: 'done',
      machineId,
      sessionId: 'old-session',
      claudeSubscriptionId: first,
    });
    const stepId = addStep(s, buildId, { byPerson: true, claudeSubscriptionId: first });
    enableOnly(s, second);
    const claimed = await claimAs(s, machineId);
    expect(claimed?.step.id).toBe(stepId);
    expect(claimed?.session).toMatchObject({ action: 'new', sessionId: null });
    expect(stepRow(s, stepId)?.claudeSubscriptionId).toBe(second);
  });

  test('a continuation of a session started on the old account is held, and resumes when no switch happened', async () => {
    const { s, machineId, first, second, projectId } = await world();
    const { buildId } = newBuild(s, projectId);
    addStep(s, buildId, {
      status: 'done',
      machineId,
      sessionId: 'old-session',
      claudeSubscriptionId: first,
    });
    const stepId = addStep(s, buildId, {});
    enableOnly(s, second);
    expect(await claimAs(s, machineId)).toBeNull();
    expect(blockedKind(s, stepId, machineId)).toBe('account-switched');
    enableOnly(s, first);
    const claimed = await claimAs(s, machineId);
    expect(claimed?.step.id).toBe(stepId);
    expect(claimed?.session).toMatchObject({ action: 'continue', sessionId: 'old-session' });
  });

  test('a prior session with no recorded account stays resumable after a switch', async () => {
    const { s, machineId, second, projectId } = await world();
    const { buildId } = newBuild(s, projectId);
    addStep(s, buildId, { status: 'done', machineId, sessionId: 'login-session' });
    const stepId = addStep(s, buildId, {});
    enableOnly(s, second);
    const claimed = await claimAs(s, machineId);
    expect(claimed?.step.id).toBe(stepId);
    expect(claimed?.session).toMatchObject({ action: 'continue', sessionId: 'login-session' });
  });

  test('a review step is not held by the prior session of another account', async () => {
    const { s, machineId, first, second, projectId } = await world();
    const { buildId } = newBuild(s, projectId);
    addStep(s, buildId, {
      status: 'done',
      machineId,
      sessionId: 'old-session',
      claudeSubscriptionId: first,
    });
    seedRoute(s, 'review', {
      provider: 'claude-code',
      modelId: 'stub-model',
      thinkingLevel: 'off',
      machineId,
    });
    const stepId = addStep(s, buildId, { kind: 'review' });
    enableOnly(s, second);
    const claimed = await claimAs(s, machineId);
    expect(claimed?.step.id).toBe(stepId);
    expect(claimed?.session).toMatchObject({ action: 'new' });
  });

  test('a merge step is not held and starts a new session when the prior ran on another account', async () => {
    const { s, machineId, first, second, projectId } = await world();
    const { buildId } = newBuild(s, projectId);
    addStep(s, buildId, {
      status: 'done',
      machineId,
      sessionId: 'old-session',
      claudeSubscriptionId: first,
    });
    const stepId = addStep(s, buildId, { kind: 'merge' });
    s.db.update(todoTable).set({ phase: 'done' }).where(eq(todoTable.latestBuildId, buildId)).run();
    enableOnly(s, second);
    const claimed = await claimAs(s, machineId);
    expect(claimed?.step.id).toBe(stepId);
    expect(claimed?.session).toMatchObject({ action: 'new', sessionId: null });
  });

  test('a step now routed to another runtime ignores the stale binding', async () => {
    const { s, machineId, first, second, projectId } = await world('stub-gw');
    const { buildId } = newBuild(s, projectId);
    const stepId = addStep(s, buildId, { claudeSubscriptionId: first });
    enableOnly(s, second);
    expect((await claimAs(s, machineId))?.step.id).toBe(stepId);
    expect(stepRow(s, stepId)?.claudeSubscriptionId).toBeNull();
  });

  test('a quota-parked step stays parked while held and is released once the account matches', async () => {
    const { s, first, second, projectId } = await world();
    const { buildId } = newBuild(s, projectId);
    const stepId = addStep(s, buildId, {
      status: 'waiting_quota',
      claudeSubscriptionId: first,
      quotaBlock: {
        kind: 'quota',
        providerId: 'claude-subscription',
        label: 'max',
        reason: 'rejected',
        retryAfterMs: null,
        firstSeenAt: 1,
        lastAt: 1,
        attempts: 1,
        probeAt: 1,
        source: 'claude_rate_limit',
      },
    });
    const deps = {
      ...s.svc,
      box: s.secretBox,
      reposDir: s.reposDir,
      attachmentsDir: s.attachmentsDir,
    };
    enableOnly(s, second);
    refreshClaudeRateParks(deps, s.team.id);
    expect(stepRow(s, stepId)?.status).toBe('waiting_quota');
    enableOnly(s, first);
    refreshClaudeRateParks(deps, s.team.id);
    expect(stepRow(s, stepId)?.status).toBe('pending');
  });

  test('a switch landing between the gates and the claim transaction holds a step bound to the old account', async () => {
    const calibrate = await world();
    const calibrationBuild = newBuild(calibrate.s, calibrate.projectId);
    addStep(calibrate.s, calibrationBuild.buildId, {});
    enableOnly(calibrate.s, calibrate.first);
    let calls = 0;
    await claimAs(calibrate.s, calibrate.machineId, () => {
      calls += 1;
      return true;
    });
    expect(calls).toBeGreaterThan(0);

    const { s, machineId, first, second, projectId } = await world();
    const { buildId } = newBuild(s, projectId);
    const stepId = addStep(s, buildId, { claudeSubscriptionId: first });
    enableOnly(s, first);
    let seen = 0;
    const raced = await claimAs(s, machineId, () => {
      seen += 1;
      if (seen === calls) enableOnly(s, second);
      return true;
    });
    expect(raced).toBeNull();
    expect(stepRow(s, stepId)).toMatchObject({ status: 'pending', claudeSubscriptionId: first });
  });
});

describe('a Coordinator turn after a switch', () => {
  async function chiefWorld(priorAccount: 'first' | null) {
    const w = await world();
    const { s, machineId, first } = w;
    seedRoute(s, 'coordinator', {
      provider: 'claude-code',
      modelId: 'stub-model',
      thinkingLevel: 'off',
      machineId,
    });
    s.db
      .insert(chiefTable)
      .values({
        id: 'chief-hold',
        userId: s.svc.user.id,
        teamId: s.team.id,
        charter: '',
        createdAt: 1,
      })
      .run();
    s.db
      .insert(chiefThreadTable)
      .values({
        id: 'thread-hold',
        chiefId: 'chief-hold',
        userId: s.svc.user.id,
        teamId: s.team.id,
        title: 'hold',
        createdAt: 2,
        updatedAt: 2,
        sessionId: 'chief-session',
        sessionOpenedAt: 2,
      })
      .run();
    s.db
      .insert(stepTable)
      .values({
        id: 'chief-prior',
        buildId: 'thread-hold',
        kind: 'chief',
        status: 'done',
        machineId,
        claimedAt: 10,
        sessionId: 'chief-session',
        claudeSubscriptionId: priorAccount === 'first' ? first : null,
        createdAt: 3,
      })
      .run();
    s.db
      .insert(stepTable)
      .values({
        id: 'chief-next',
        buildId: 'thread-hold',
        kind: 'chief',
        status: 'pending',
        createdAt: 20,
      })
      .run();
    return w;
  }

  test('a thread whose last turn ran on another account starts a new session', async () => {
    const { s, machineId, second } = await chiefWorld('first');
    enableOnly(s, second);
    const claimed = await claimAs(s, machineId);
    expect(claimed?.step.id).toBe('chief-next');
    expect(claimed?.session).toMatchObject({ action: 'new', sessionId: null });
    expect(stepRow(s, 'chief-next')?.claudeSubscriptionId).toBe(second);
  });

  test('a failed turn on the new account that reported no session does not hide the old session', async () => {
    const { s, machineId, second } = await chiefWorld('first');
    s.db
      .insert(stepTable)
      .values({
        id: 'chief-failed',
        buildId: 'thread-hold',
        kind: 'chief',
        status: 'failed',
        machineId,
        claimedAt: 15,
        claudeSubscriptionId: second,
        createdAt: 15,
      })
      .run();
    enableOnly(s, second);
    const claimed = await claimAs(s, machineId);
    expect(claimed?.session).toMatchObject({ action: 'new', sessionId: null });
  });

  test('a thread from before turns recorded sessions falls back to the last claimed turn', async () => {
    const { s, machineId, second } = await chiefWorld('first');
    s.db.update(stepTable).set({ sessionId: null }).where(eq(stepTable.id, 'chief-prior')).run();
    enableOnly(s, second);
    const claimed = await claimAs(s, machineId);
    expect(claimed?.session).toMatchObject({ action: 'new', sessionId: null });
  });

  test('a parked turn bound to the old account is released after a switch, not held', async () => {
    const { s, first, second } = await chiefWorld('first');
    s.db
      .update(stepTable)
      .set({
        status: 'waiting_quota',
        claudeSubscriptionId: first,
        quotaBlock: {
          kind: 'quota',
          providerId: 'claude-subscription',
          label: 'max',
          reason: 'rejected',
          retryAfterMs: null,
          firstSeenAt: 1,
          lastAt: 1,
          attempts: 1,
          probeAt: 1,
          source: 'claude_rate_limit',
        },
      })
      .where(eq(stepTable.id, 'chief-next'))
      .run();
    enableOnly(s, second);
    refreshClaudeRateParks(
      {
        ...s.svc,
        box: s.secretBox,
        reposDir: s.reposDir,
        attachmentsDir: s.attachmentsDir,
      },
      s.team.id,
    );
    expect(stepRow(s, 'chief-next')?.status).toBe('pending');
  });

  test('the same account keeps the session', async () => {
    const { s, machineId, first } = await chiefWorld('first');
    enableOnly(s, first);
    const claimed = await claimAs(s, machineId);
    expect(claimed?.session).toMatchObject({ action: 'continue', sessionId: 'chief-session' });
  });

  test('a last turn with no recorded account keeps the session', async () => {
    const { s, machineId, second } = await chiefWorld(null);
    enableOnly(s, second);
    const claimed = await claimAs(s, machineId);
    expect(claimed?.session).toMatchObject({ action: 'continue', sessionId: 'chief-session' });
  });
});
