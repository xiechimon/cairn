import type { ClaimedStep } from '@cairn/shared';
import { claimedStepSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import {
  claudeSubscription,
  machine as machineTable,
  routingRule,
  step,
  stepRoute,
  todo as todoTable,
} from '../src/db/schema.js';
import { nowMs } from '../src/lib/ids.js';
import { profileForStep } from '../src/services/routing-rules.js';
import { decideStepRoute, recordStepRoute, routedModelRunsOn } from '../src/services/step-route.js';
import {
  bootServer,
  issueApiKey,
  pinSessionRoute,
  postProject,
  req,
  seedRoute,
  type TestServer,
} from './helpers.js';

const HOUR_MS = 3_600_000;

const servers: TestServer[] = [];
afterAll(() => {
  for (const s of servers) s.dispose();
});

interface World {
  s: TestServer;
  machineToken: string;
  machineId: string;
  projectId: string;
}

function equipMachine(
  w: World,
  options: {
    claude: boolean;
    codex: boolean;
    weeklyUtilization?: number;
    weeklyResetsAt?: number;
    fiveHourRejected?: boolean;
  },
): void {
  w.s.db
    .update(machineTable)
    .set({
      online: true,
      enabledRuntimes: [
        ...(options.claude ? ['claude-code'] : []),
        ...(options.codex ? ['pi'] : []),
      ],
      claudeCodeReport: options.claude
        ? {
            installed: true,
            hostname: 'route-box',
            models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'].map((id) => ({
              id,
              name: id,
            })),
            auth: { state: 'logged-in', method: 'claude.ai', provider: 'firstParty' },
          }
        : null,
      claudeRateLimits: [
        ...(options.weeklyUtilization === undefined
          ? []
          : [
              {
                subscription: 'seven_day' as const,
                status: 'allowed' as const,
                utilization: options.weeklyUtilization,
                resetsAt: options.weeklyResetsAt ?? nowMs() + 86_400_000,
                reportedAt: nowMs(),
              },
            ]),
        ...(options.fiveHourRejected === true
          ? [
              {
                subscription: 'five_hour' as const,
                status: 'rejected' as const,
                utilization: 1,
                resetsAt: nowMs() + HOUR_MS,
                reportedAt: nowMs(),
              },
            ]
          : []),
      ],
      capabilities: {
        mcpServers: [],
        skills: [],
        ...(options.codex ? { codexLogin: { state: 'ok', expiresAt: nowMs() + HOUR_MS } } : {}),
      },
    })
    .where(eq(machineTable.id, w.machineId))
    .run();
}

async function setupWorld(): Promise<World> {
  const s = bootServer({ claimHoldMs: 50 });
  servers.push(s);
  const key = await issueApiKey(s);
  const res = await s.app.request('/api/machine/enroll', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(
      readyMachine({ teamId: s.team.id, name: 'route-box', cliVersion: '0.1.0' }),
    ),
  });
  expect(res.status).toBe(200);
  const machineToken = ((await res.json()) as { token: string }).token;
  const machineId = s.db
    .select({ id: machineTable.id })
    .from(machineTable)
    .where(eq(machineTable.teamId, s.team.id))
    .get()!.id;
  const projectId = await postProject(s.app, 'capability-proj');
  seedRoute(s, 'session', {
    provider: 'claude-code',
    modelId: 'claude-sonnet-5-5',
    thinkingLevel: 'low',
  });
  seedRoute(s, 'review', {
    provider: 'claude-code',
    modelId: 'claude-sonnet-5-5',
    thinkingLevel: 'low',
  });
  return { s, machineToken, machineId, projectId };
}

async function buildTodo(w: World, spec: string): Promise<typeof todoTable.$inferSelect> {
  const todoRes = await req(w.s.app, 'POST', `/api/projects/${w.projectId}/todos`, {
    title: 'route probe',
    spec,
  });
  expect(todoRes.status).toBe(201);
  const todoId = ((await todoRes.json()) as { id: string }).id;
  const started = await req(w.s.app, 'POST', `/api/projects/${w.projectId}/builds`, {
    todoIds: [todoId],
    withPlan: false,
  });
  expect(started.status).toBe(201);
  return w.s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()!;
}

async function claim(w: World): Promise<ClaimedStep | null> {
  const res = await w.s.app.request('/api/machine/tasks/claim', {
    method: 'POST',
    headers: { authorization: `Bearer ${w.machineToken}`, 'content-type': 'application/json' },
    body: '{}',
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { step: ClaimedStep | null };
  return body.step === null ? null : claimedStepSchema.parse(body.step);
}

describe('one path decides what a dispatched step runs on', () => {
  test('easy work goes to Haiku, hard work to Codex, on the same rule row', async () => {
    const w = await setupWorld();
    equipMachine(w, { claude: true, codex: true });
    const easy = await buildTodo(w, 'rename one label');
    expect(profileForStep(w.s.db, easy, 'build')).toMatchObject({
      provider: 'claude-code',
      modelId: 'claude-haiku-5-5',
    });
    const hard = await buildTodo(w, `difficulty:hard ${'migrate the queue '.repeat(10)}`);
    expect(profileForStep(w.s.db, hard, 'build')).toMatchObject({
      provider: 'openai-codex',
      modelId: 'gpt-6.1-sol',
    });
  });

  test('a machine reporting nothing leaves the rule row as the default', async () => {
    const w = await setupWorld();
    equipMachine(w, { claude: false, codex: false });
    const todoRow = await buildTodo(w, 'rename one label');
    expect(profileForStep(w.s.db, todoRow, 'build')).toMatchObject({
      provider: 'claude-code',
      modelId: 'claude-sonnet-5-5',
    });
  });

  test('review steps keep their own rule and are never routed', async () => {
    const w = await setupWorld();
    equipMachine(w, { claude: true, codex: true });
    const todoRow = await buildTodo(w, 'rename one label');
    expect(profileForStep(w.s.db, todoRow, 'review')).toMatchObject({
      provider: 'claude-code',
      modelId: 'claude-sonnet-5-5',
    });
  });

  test('quota exhausted on Codex: hard work routes to Opus and records the rejection', async () => {
    const w = await setupWorld();
    equipMachine(w, { claude: true, codex: true, weeklyUtilization: 0.1 });
    w.s.db
      .update(machineTable)
      .set({ capabilities: { mcpServers: [], skills: [] } })
      .where(eq(machineTable.id, w.machineId))
      .run();
    const hard = await buildTodo(w, `difficulty:hard ${'migrate the queue '.repeat(10)}`);
    expect(profileForStep(w.s.db, hard, 'build')).toMatchObject({ modelId: 'claude-opus-5-5' });
  });

  test('Claude quota at 70% weekly use moves standard work to Codex', async () => {
    const w = await setupWorld();
    equipMachine(w, { claude: true, codex: true, weeklyUtilization: 0.7 });
    const todoRow = await buildTodo(w, 'x'.repeat(800));
    expect(profileForStep(w.s.db, todoRow, 'build')).toMatchObject({ modelId: 'gpt-6.1-sol' });
  });

  test('harness missing on the machine: claude-code is rejected and the choice falls to Codex', async () => {
    const w = await setupWorld();
    equipMachine(w, { claude: false, codex: true });
    const todoRow = await buildTodo(w, 'x'.repeat(800));
    expect(profileForStep(w.s.db, todoRow, 'build')).toMatchObject({ modelId: 'gpt-6.1-sol' });
  });
});

describe('the router agrees with what dispatch can execute', () => {
  test('a team subscription makes a machine with an expired local login usable', async () => {
    const w = await setupWorld();
    equipMachine(w, { claude: true, codex: true });
    const row = w.s.db.select().from(machineTable).where(eq(machineTable.id, w.machineId)).get()!;
    w.s.db
      .update(machineTable)
      .set({
        claudeCodeReport: {
          ...row.claudeCodeReport!,
          login: { state: 'expired', expiresAt: nowMs() - HOUR_MS },
        },
      })
      .where(eq(machineTable.id, w.machineId))
      .run();
    const todoRow = await buildTodo(w, 'rename one label');
    expect(profileForStep(w.s.db, todoRow, 'build')).toMatchObject({ provider: 'openai-codex' });
    w.s.db
      .insert(claudeSubscription)
      .values({
        id: 'sub-1',
        teamId: w.s.team.id,
        label: 'team',
        tokenCipher: 'cipher',
        expiresAt: null,
        createdAt: nowMs(),
      })
      .run();
    expect(profileForStep(w.s.db, todoRow, 'build')).toMatchObject({
      provider: 'claude-code',
      modelId: 'claude-haiku-5-5',
    });
  });

  test('citation checkers keep their rule instead of being routed', async () => {
    const w = await setupWorld();
    equipMachine(w, { claude: true, codex: true });
    const todoRow = await buildTodo(w, `difficulty:hard ${'migrate the queue '.repeat(10)}`);
    w.s.db
      .update(todoTable)
      .set({ sourceKind: 'research-citation-check' })
      .where(eq(todoTable.id, todoRow.id))
      .run();
    const checker = w.s.db.select().from(todoTable).where(eq(todoTable.id, todoRow.id)).get()!;
    expect(profileForStep(w.s.db, checker, 'build')).toMatchObject({
      provider: 'claude-code',
      modelId: 'claude-sonnet-5-5',
    });
  });

  test('an expired weekly window no longer rejects Claude', async () => {
    const w = await setupWorld();
    equipMachine(w, {
      claude: true,
      codex: true,
      weeklyUtilization: 0.9,
      weeklyResetsAt: nowMs() - 60_000,
    });
    const todoRow = await buildTodo(w, 'x'.repeat(800));
    expect(profileForStep(w.s.db, todoRow, 'build')).toMatchObject({
      modelId: 'claude-sonnet-5-5',
    });
  });

  test('a rejected five-hour window moves work to Codex before ranking', async () => {
    const w = await setupWorld();
    equipMachine(w, { claude: true, codex: true, fiveHourRejected: true });
    const todoRow = await buildTodo(w, 'x'.repeat(800));
    expect(profileForStep(w.s.db, todoRow, 'build')).toMatchObject({ modelId: 'gpt-6.1-sol' });
  });

  test('the recorded route is the accepted one even if availability changed during the claim', async () => {
    const w = await setupWorld();
    equipMachine(w, { claude: true, codex: true });
    const todoRow = await buildTodo(w, 'rename one label');
    const stepRow = w.s.db.select().from(step).all().at(0)!;
    equipMachine(w, { claude: false, codex: true });
    w.s.db.update(step).set({ status: 'claimed' }).where(eq(step.id, stepRow.id)).run();
    const row = recordStepRoute(w.s.db, stepRow, todoRow, w.machineId, {
      provider: 'claude-code',
      modelId: 'claude-haiku-5-5',
      machineId: null,
      requiredCapabilities: null,
    });
    expect(row).toMatchObject({ provider: 'claude-code', modelId: 'claude-haiku-5-5' });
    expect(row.reason).toContain('availability changed during the claim');
  });
});

describe('a routed model only runs on a machine that can host it', () => {
  test('Codex needs a valid Codex login on the claiming machine', async () => {
    const w = await setupWorld();
    equipMachine(w, { claude: true, codex: false });
    w.s.db
      .update(machineTable)
      .set({ enabledRuntimes: ['claude-code', 'pi'] })
      .where(eq(machineTable.id, w.machineId))
      .run();
    const row = () =>
      w.s.db.select().from(machineTable).where(eq(machineTable.id, w.machineId)).get()!;
    const codex = { provider: 'openai-codex', modelId: 'gpt-6.1-sol' };
    expect(routedModelRunsOn(w.s.db, row(), codex)).toBe(false);
    equipMachine(w, { claude: true, codex: true });
    expect(routedModelRunsOn(w.s.db, row(), codex)).toBe(true);
  });

  test('a hard step is not claimed by a machine without the Codex login the router relied on', async () => {
    const w = await setupWorld();
    equipMachine(w, { claude: true, codex: true });
    const other = 'claude-only-box';
    w.s.db
      .insert(machineTable)
      .values(
        readyMachine({
          ...w.s.db.select().from(machineTable).where(eq(machineTable.id, w.machineId)).get()!,
          id: other,
          name: other,
          tokenHash: 'other-token-hash',
        }),
      )
      .run();
    w.s.db
      .update(machineTable)
      .set({ enabledRuntimes: ['claude-code', 'pi'], capabilities: { mcpServers: [], skills: [] } })
      .where(eq(machineTable.id, other))
      .run();
    pinSessionRoute(w.s, w.machineId);
    const hard = await buildTodo(w, `difficulty:hard ${'migrate the queue '.repeat(10)}`);
    expect(profileForStep(w.s.db, hard, 'build')).toMatchObject({
      provider: 'openai-codex',
      routed: true,
    });
    const otherRow = w.s.db.select().from(machineTable).where(eq(machineTable.id, other)).get()!;
    expect(
      routedModelRunsOn(w.s.db, otherRow, { provider: 'openai-codex', modelId: 'gpt-6.1-sol' }),
    ).toBe(false);
  });
});

describe('claim validation and recording follow the router rules', () => {
  test('a machine over the weekly cutoff cannot take a routed Claude step', async () => {
    const w = await setupWorld();
    equipMachine(w, { claude: true, codex: true, weeklyUtilization: 0.8 });
    const row = w.s.db.select().from(machineTable).where(eq(machineTable.id, w.machineId)).get()!;
    expect(
      routedModelRunsOn(w.s.db, row, { provider: 'claude-code', modelId: 'claude-sonnet-5-5' }),
    ).toBe(false);
  });

  test('a provider the router does not handle is recorded without a harness', async () => {
    const w = await setupWorld();
    equipMachine(w, { claude: true, codex: true });
    const todoRow = await buildTodo(w, 'rename one label');
    const stepRow = w.s.db.select().from(step).all().at(0)!;
    w.s.db.update(step).set({ status: 'claimed' }).where(eq(step.id, stepRow.id)).run();
    const row = recordStepRoute(w.s.db, stepRow, todoRow, w.machineId, {
      provider: 'gemini',
      modelId: 'gemini-pro',
      machineId: null,
      requiredCapabilities: null,
    });
    expect(row.harness).toBeNull();
  });
});

describe('the router leaves the execution constraints of the rule alone', () => {
  test('the chosen worker does not become the machine pin of an unpinned rule', async () => {
    const w = await setupWorld();
    equipMachine(w, { claude: true, codex: true });
    const todoRow = await buildTodo(w, 'rename one label');
    expect(profileForStep(w.s.db, todoRow, 'build')).toMatchObject({ machineId: w.machineId });
    expect(
      w.s.db
        .select()
        .from(routingRule)
        .where(eq(routingRule.teamId, w.s.team.id))
        .all()
        .every((rule) => rule.machineId === null),
    ).toBe(true);
  });
});

describe('the router respects where the step can actually run', () => {
  test('a machine that lists only Sonnet is never given Haiku', async () => {
    const w = await setupWorld();
    equipMachine(w, { claude: true, codex: false });
    const row = w.s.db.select().from(machineTable).where(eq(machineTable.id, w.machineId)).get()!;
    w.s.db
      .update(machineTable)
      .set({
        claudeCodeReport: {
          ...row.claudeCodeReport!,
          models: [{ id: 'claude-sonnet-5-5', name: 'Sonnet' }],
        },
      })
      .where(eq(machineTable.id, w.machineId))
      .run();
    const easy = await buildTodo(w, 'rename one label');
    expect(profileForStep(w.s.db, easy, 'build')).toMatchObject({ modelId: 'claude-sonnet-5-5' });
  });

  test('a rule pinned to a Claude-only machine never picks Codex found on another machine', async () => {
    const w = await setupWorld();
    equipMachine(w, { claude: true, codex: false });
    const other = 'other-machine';
    w.s.db
      .insert(machineTable)
      .values(
        readyMachine({
          ...w.s.db.select().from(machineTable).where(eq(machineTable.id, w.machineId)).get()!,
          id: other,
          name: 'codex-box',
        }),
      )
      .run();
    w.s.db
      .update(machineTable)
      .set({
        enabledRuntimes: ['pi'],
        claudeCodeReport: null,
        capabilities: {
          mcpServers: [],
          skills: [],
          codexLogin: { state: 'ok', expiresAt: nowMs() + HOUR_MS },
        },
      })
      .where(eq(machineTable.id, other))
      .run();
    seedRoute(w.s, 'session', {
      provider: 'claude-code',
      modelId: 'claude-sonnet-5-5',
      machineId: w.machineId,
    });
    const hard = await buildTodo(w, `difficulty:hard ${'migrate the queue '.repeat(10)}`);
    expect(profileForStep(w.s.db, hard, 'build')).toMatchObject({
      provider: 'claude-code',
      modelId: 'claude-opus-5-5',
      machineId: w.machineId,
    });
  });

  test('a required MCP server only the Claude machine has rules out Codex machines', async () => {
    const w = await setupWorld();
    equipMachine(w, { claude: true, codex: true });
    w.s.db
      .update(machineTable)
      .set({
        enabledRuntimes: ['claude-code'],
        capabilities: { mcpServers: ['linear'], skills: [] },
      })
      .where(eq(machineTable.id, w.machineId))
      .run();
    seedRoute(w.s, 'session', {
      provider: 'claude-code',
      modelId: 'claude-sonnet-5-5',
      requiredCapabilities: { mcpServers: ['linear'] },
    });
    const hard = await buildTodo(w, `difficulty:hard ${'migrate the queue '.repeat(10)}`);
    expect(profileForStep(w.s.db, hard, 'build')).toMatchObject({ provider: 'claude-code' });
  });
});

describe('the decision is recorded at claim and never changes in flight', () => {
  test('claiming writes a step_route row with harness, model, difficulty and reason', async () => {
    const w = await setupWorld();
    equipMachine(w, { claude: true, codex: true });
    await buildTodo(w, 'rename one label');
    const claimed = await claim(w);
    expect(claimed).not.toBeNull();
    const row = w.s.db.select().from(stepRoute).where(eq(stepRoute.stepId, claimed!.step.id)).get();
    expect(row).toMatchObject({
      harness: 'claude-code',
      provider: 'claude-code',
      modelId: 'claude-haiku-5-5',
      difficulty: 'easy',
      machineId: w.machineId,
      reason: 'easy: claude-haiku-5-5 ranked first',
    });
  });

  test('a recorded session keeps its model after the machine loses the harness', async () => {
    const w = await setupWorld();
    equipMachine(w, { claude: true, codex: true });
    const todoRow = await buildTodo(w, 'rename one label');
    const stepRow = w.s.db.select().from(step).all().at(0)!;
    w.s.db.update(step).set({ status: 'claimed' }).where(eq(step.id, stepRow.id)).run();
    recordStepRoute(w.s.db, stepRow, todoRow, w.machineId, {
      provider: 'claude-code',
      modelId: 'claude-haiku-5-5',
      machineId: null,
      requiredCapabilities: null,
    });
    w.s.db.update(step).set({ sessionId: 'started-session' }).where(eq(step.id, stepRow.id)).run();
    equipMachine(w, { claude: false, codex: true });
    expect(profileForStep(w.s.db, todoRow, 'build', stepRow.id)).toMatchObject({
      provider: 'claude-code',
      modelId: 'claude-haiku-5-5',
    });
    expect(profileForStep(w.s.db, todoRow, 'build')).toMatchObject({ modelId: 'gpt-6.1-sol' });
  });

  test('recording the same accepted model on a claimed step leaves the row unchanged', async () => {
    const w = await setupWorld();
    equipMachine(w, { claude: true, codex: true });
    const todoRow = await buildTodo(w, 'rename one label');
    const stepRow = w.s.db.select().from(step).all().at(0)!;
    w.s.db.update(step).set({ status: 'claimed' }).where(eq(step.id, stepRow.id)).run();
    const first = recordStepRoute(w.s.db, stepRow, todoRow, w.machineId, {
      provider: 'claude-code',
      modelId: 'claude-haiku-5-5',
      machineId: null,
      requiredCapabilities: null,
    });
    equipMachine(w, { claude: false, codex: true });
    const second = recordStepRoute(w.s.db, stepRow, todoRow, w.machineId, {
      provider: 'claude-code',
      modelId: 'claude-haiku-5-5',
      machineId: null,
      requiredCapabilities: null,
    });
    expect(second).toEqual(first);
  });
});

describe('claim-time routes are reconsidered only while pending without continuity', () => {
  test('a claimed step without a session keeps its recorded over-quota Claude route', async () => {
    const w = await setupWorld();
    equipMachine(w, { claude: true, codex: true });
    const todoRow = await buildTodo(w, 'difficulty:standard');
    const claimed = await claim(w);
    expect(claimed?.agent?.modelId).toBe('claude-sonnet-5-5');
    const stepRow = w.s.db.select().from(step).where(eq(step.id, claimed!.step.id)).get()!;
    expect(stepRow).toMatchObject({ status: 'claimed', sessionId: null, checkpointCommit: null });
    const recorded = w.s.db.select().from(stepRoute).where(eq(stepRoute.stepId, stepRow.id)).get()!;
    equipMachine(w, { claude: true, codex: true, weeklyUtilization: 0.98 });
    expect
      .soft(
        decideStepRoute(w.s.db, todoRow, stepRow.kind, stepRow.id, {
          machineId: null,
          required: null,
        }),
      )
      .toMatchObject({
        chosen: { provider: 'claude-code', modelId: 'claude-sonnet-5-5' },
        reason: 'in-flight: keeps recorded model',
        rejected: [],
      });
    expect.soft(profileForStep(w.s.db, todoRow, stepRow.kind, stepRow.id)).toMatchObject({
      provider: 'claude-code',
      modelId: 'claude-sonnet-5-5',
    });
    expect(w.s.db.select().from(stepRoute).where(eq(stepRoute.stepId, stepRow.id)).get()).toEqual(
      recorded,
    );
  });

  test('a pending step without a session re-routes from over-quota Claude to Codex', async () => {
    const w = await setupWorld();
    equipMachine(w, { claude: false, codex: false });
    const todoRow = await buildTodo(w, 'difficulty:standard');
    const stepRow = w.s.db.select().from(step).all().at(0)!;
    expect(stepRow).toMatchObject({ status: 'pending', sessionId: null, checkpointCommit: null });
    w.s.db.update(step).set({ status: 'claimed' }).where(eq(step.id, stepRow.id)).run();
    const recorded = recordStepRoute(w.s.db, stepRow, todoRow, w.machineId, {
      provider: 'claude-code',
      modelId: 'claude-sonnet-5-5',
      machineId: null,
      requiredCapabilities: null,
    });
    expect(recorded.reason).toBe('rule default (standard: no available candidate)');
    w.s.db.update(step).set({ status: 'pending' }).where(eq(step.id, stepRow.id)).run();
    equipMachine(w, { claude: true, codex: true, weeklyUtilization: 0.98 });
    const decision = decideStepRoute(w.s.db, todoRow, stepRow.kind, stepRow.id, {
      machineId: null,
      required: null,
    });
    expect(decision.chosen).toMatchObject({ provider: 'openai-codex', modelId: 'gpt-6.1-sol' });
    expect(decision.rejected).toContainEqual({
      modelId: 'claude-sonnet-5-5',
      machineId: w.machineId,
      why: 'quota',
    });
    expect(profileForStep(w.s.db, todoRow, stepRow.kind, stepRow.id)).toMatchObject({
      provider: 'openai-codex',
      modelId: 'gpt-6.1-sol',
      routed: true,
    });
  });

  test('reclaiming updates the route to Codex and repeating the same model leaves it unchanged', async () => {
    const w = await setupWorld();
    equipMachine(w, { claude: true, codex: true });
    const todoRow = await buildTodo(w, 'difficulty:standard');
    const first = await claim(w);
    expect(first?.agent?.modelId).toBe('claude-sonnet-5-5');
    const stepId = first!.step.id;
    w.s.db
      .update(step)
      .set({ status: 'pending', machineId: null, claimedAt: null })
      .where(eq(step.id, stepId))
      .run();
    w.s.db.update(stepRoute).set({ decidedAt: 1 }).where(eq(stepRoute.stepId, stepId)).run();
    equipMachine(w, { claude: true, codex: true, weeklyUtilization: 0.98 });
    const second = await claim(w);
    expect(second?.agent?.modelId).toBe('gpt-6.1-sol');
    expect(second?.step.id).toBe(stepId);
    expect(w.s.db.select().from(step).where(eq(step.id, stepId)).get()?.status).toBe('claimed');
    const recorded = w.s.db.select().from(stepRoute).where(eq(stepRoute.stepId, stepId)).get()!;
    expect(recorded).toMatchObject({
      provider: 'openai-codex',
      modelId: 'gpt-6.1-sol',
      harness: 'pi',
      machineId: w.machineId,
      difficulty: 'standard',
      reason:
        're-routed: claude-sonnet-5-5 no longer runnable (quota); standard: gpt-6.1-sol ranked 2, higher ranks unavailable',
      rejected: [{ modelId: 'claude-sonnet-5-5', machineId: w.machineId, why: 'quota' }],
    });
    expect(recorded.decidedAt).toBeGreaterThan(1);
    w.s.db
      .update(step)
      .set({ status: 'pending', machineId: null, claimedAt: null })
      .where(eq(step.id, stepId))
      .run();
    expect((await claim(w))?.agent?.modelId).toBe('gpt-6.1-sol');
    expect(w.s.db.select().from(stepRoute).where(eq(stepRoute.stepId, stepId)).get()).toEqual(
      recorded,
    );
    expect(todoRow.id).toBe(first!.todo?.id);
  });

  test.each([
    { sessionId: 'started-session', checkpointCommit: null },
    { sessionId: null, checkpointCommit: 'checkpoint-commit' },
  ])('a started step keeps over-quota Claude with %j', async (continuity) => {
    const w = await setupWorld();
    equipMachine(w, { claude: true, codex: true });
    const todoRow = await buildTodo(w, 'difficulty:standard');
    const stepRow = w.s.db.select().from(step).all().at(0)!;
    w.s.db.update(step).set({ status: 'claimed' }).where(eq(step.id, stepRow.id)).run();
    recordStepRoute(w.s.db, stepRow, todoRow, w.machineId, {
      provider: 'claude-code',
      modelId: 'claude-sonnet-5-5',
      machineId: null,
      requiredCapabilities: null,
    });
    w.s.db
      .update(step)
      .set({ status: 'pending', ...continuity })
      .where(eq(step.id, stepRow.id))
      .run();
    equipMachine(w, { claude: true, codex: true, weeklyUtilization: 0.98 });
    expect(
      decideStepRoute(w.s.db, todoRow, stepRow.kind, stepRow.id, {
        machineId: null,
        required: null,
      }),
    ).toMatchObject({
      chosen: { provider: 'claude-code', modelId: 'claude-sonnet-5-5' },
      reason: 'in-flight: keeps recorded model',
      rejected: [],
    });
    expect(profileForStep(w.s.db, todoRow, stepRow.kind, stepRow.id)).toMatchObject({
      provider: 'claude-code',
      modelId: 'claude-sonnet-5-5',
    });
  });

  test('a runnable recorded model without a session is chosen again without rewriting the row', async () => {
    const w = await setupWorld();
    equipMachine(w, { claude: true, codex: true });
    const todoRow = await buildTodo(w, 'difficulty:standard');
    const stepRow = w.s.db.select().from(step).all().at(0)!;
    w.s.db.update(step).set({ status: 'claimed' }).where(eq(step.id, stepRow.id)).run();
    recordStepRoute(w.s.db, stepRow, todoRow, w.machineId, {
      provider: 'claude-code',
      modelId: 'claude-sonnet-5-5',
      machineId: null,
      requiredCapabilities: null,
    });
    w.s.db.update(stepRoute).set({ decidedAt: 1 }).where(eq(stepRoute.stepId, stepRow.id)).run();
    const recorded = w.s.db.select().from(stepRoute).where(eq(stepRoute.stepId, stepRow.id)).get()!;
    w.s.db.update(step).set({ status: 'pending' }).where(eq(step.id, stepRow.id)).run();
    expect(
      decideStepRoute(w.s.db, todoRow, stepRow.kind, stepRow.id, {
        machineId: null,
        required: null,
      }),
    ).toMatchObject({
      chosen: { provider: 'claude-code', modelId: 'claude-sonnet-5-5' },
      reason: 'standard: claude-sonnet-5-5 ranked first',
    });
    expect((await claim(w))?.agent?.modelId).toBe('claude-sonnet-5-5');
    expect(w.s.db.select().from(stepRoute).where(eq(stepRoute.stepId, stepRow.id)).get()).toEqual(
      recorded,
    );
  });
});
