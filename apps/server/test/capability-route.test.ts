import type { ClaimedStep } from '@cairn/shared';
import { claimedStepSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  machine as machineTable,
  routingRule,
  step,
  stepRoute,
  todo as todoTable,
} from '../src/db/schema.js';
import { newRecordId, nowMs } from '../src/lib/ids.js';
import { agentForStep } from '../src/services/dispatch-eligibility.js';
import { setRoutingRulesEnabled } from '../src/services/routing-rules.js';
import { recordStepRoute } from '../src/services/step-route.js';
import {
  bindAllAgents,
  bootServer,
  issueApiKey,
  postProject,
  req,
  type TestServer,
} from './helpers.js';

const AGENT_BUILD = 'capability-route-agent';
const HOUR_MS = 3_600_000;

const servers: TestServer[] = [];
afterAll(() => {
  for (const s of servers) s.dispose();
});
beforeEach(() => setRoutingRulesEnabled(true));
afterEach(() => setRoutingRulesEnabled(false));

interface World {
  s: TestServer;
  machineToken: string;
  machineId: string;
  projectId: string;
}

function equipMachine(
  w: World,
  options: { claude: boolean; codex: boolean; weeklyUtilization?: number },
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
            models: [],
            auth: { state: 'logged-in', method: 'claude.ai', provider: 'firstParty' },
          }
        : null,
      claudeRateLimits:
        options.weeklyUtilization === undefined
          ? null
          : [
              {
                subscription: 'seven_day',
                status: 'allowed',
                utilization: options.weeklyUtilization,
                resetsAt: Math.floor(nowMs() / 1000) + 86_400,
                reportedAt: nowMs(),
              },
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
    body: JSON.stringify({ teamId: s.team.id, name: 'route-box', cliVersion: '0.1.0' }),
  });
  expect(res.status).toBe(200);
  const machineToken = ((await res.json()) as { token: string }).token;
  s.db
    .insert(agentTable)
    .values({
      id: AGENT_BUILD,
      teamId: s.team.id,
      displayName: AGENT_BUILD,
      provider: 'agent-provider',
      modelId: 'agent-model',
      thinkingLevel: 'low',
    })
    .run();
  bindAllAgents(s);
  const machineId = s.db
    .select({ id: machineTable.id })
    .from(machineTable)
    .where(eq(machineTable.teamId, s.team.id))
    .get()!.id;
  const projectId = await postProject(s.app, 'capability-proj');
  for (const use of ['session', 'review'] as const) {
    s.db
      .insert(routingRule)
      .values({
        id: newRecordId(),
        teamId: s.team.id,
        use,
        provider: 'claude-code',
        modelId: 'claude-sonnet-5-5',
        thinkingLevel: 'low',
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
  }
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
    assignment: { plan: null, build: { agentId: AGENT_BUILD } },
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
    expect(agentForStep(w.s.db, easy, 'build')).toMatchObject({
      provider: 'claude-code',
      modelId: 'claude-haiku-5-5',
    });
    const hard = await buildTodo(w, `difficulty:hard ${'migrate the queue '.repeat(10)}`);
    expect(agentForStep(w.s.db, hard, 'build')).toMatchObject({
      provider: 'openai-codex',
      modelId: 'gpt-6.1-sol',
    });
  });

  test('a machine reporting nothing leaves the rule row as the default', async () => {
    const w = await setupWorld();
    equipMachine(w, { claude: false, codex: false });
    const todoRow = await buildTodo(w, 'rename one label');
    expect(agentForStep(w.s.db, todoRow, 'build')).toMatchObject({
      provider: 'claude-code',
      modelId: 'claude-sonnet-5-5',
    });
  });

  test('no Codex connection: review stays pinned to Codex and cannot run on Claude', async () => {
    const w = await setupWorld();
    equipMachine(w, { claude: true, codex: false });
    const todoRow = await buildTodo(w, 'rename one label');
    expect(agentForStep(w.s.db, todoRow, 'review')).toMatchObject({
      provider: 'openai-codex',
      modelId: 'gpt-6.1-sol',
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
    expect(agentForStep(w.s.db, hard, 'build')).toMatchObject({ modelId: 'claude-opus-5-5' });
  });

  test('Claude quota at 70% weekly use moves standard work to Codex', async () => {
    const w = await setupWorld();
    equipMachine(w, { claude: true, codex: true, weeklyUtilization: 0.7 });
    const todoRow = await buildTodo(w, 'x'.repeat(800));
    expect(agentForStep(w.s.db, todoRow, 'build')).toMatchObject({ modelId: 'gpt-6.1-sol' });
  });

  test('harness missing on the machine: claude-code is rejected and the choice falls to Codex', async () => {
    const w = await setupWorld();
    equipMachine(w, { claude: false, codex: true });
    const todoRow = await buildTodo(w, 'x'.repeat(800));
    expect(agentForStep(w.s.db, todoRow, 'build')).toMatchObject({ modelId: 'gpt-6.1-sol' });
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

  test('a recorded step keeps its model after the machine loses the harness', async () => {
    const w = await setupWorld();
    equipMachine(w, { claude: true, codex: true });
    const todoRow = await buildTodo(w, 'rename one label');
    const stepRow = w.s.db.select().from(step).all().at(0)!;
    recordStepRoute(w.s.db, stepRow, todoRow, w.machineId, {
      provider: 'claude-code',
      modelId: 'claude-haiku-5-5',
    });
    equipMachine(w, { claude: false, codex: true });
    expect(agentForStep(w.s.db, todoRow, 'build', stepRow.prompt, stepRow.id)).toMatchObject({
      provider: 'claude-code',
      modelId: 'claude-haiku-5-5',
    });
    expect(agentForStep(w.s.db, todoRow, 'build')).toMatchObject({ modelId: 'gpt-6.1-sol' });
  });

  test('recording twice keeps the first decision', async () => {
    const w = await setupWorld();
    equipMachine(w, { claude: true, codex: true });
    const todoRow = await buildTodo(w, 'rename one label');
    const stepRow = w.s.db.select().from(step).all().at(0)!;
    const first = recordStepRoute(w.s.db, stepRow, todoRow, w.machineId, {
      provider: 'claude-code',
      modelId: 'claude-haiku-5-5',
    });
    equipMachine(w, { claude: false, codex: true });
    const second = recordStepRoute(w.s.db, stepRow, todoRow, w.machineId, {
      provider: 'openai-codex',
      modelId: 'gpt-6.1-sol',
    });
    expect(second).toEqual(first);
  });
});
