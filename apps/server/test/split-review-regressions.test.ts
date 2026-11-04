import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { agent, machine, team } from '../src/db/schema.js';
import { homeMachineRejectReason } from '../src/services/dispatch-eligibility.js';
import { createSplitTodo } from '../src/services/todo-split.js';
import { checkSplitPlan, type SplitCheckerInput } from '../src/services/todo-split-checker.js';
import { bootServer, postProject, req } from './helpers.js';

const checkerInput = (): SplitCheckerInput => ({
  subtodos: [
    { title: 'First', spec: 'ordinary implementation', agentId: 'worker' },
    { title: 'Second', spec: 'ordinary implementation', agentId: 'worker', blockedBy: [1] },
  ],
  agents: [
    {
      id: 'worker',
      status: 'active',
      provider: 'pi',
      modelId: null,
      requiredCapabilities: null,
      machine: {
        name: 'test',
        online: true,
        enabledRuntimes: ['pi'],
        capabilities: null,
        claudeCodeReport: null,
      },
    },
  ],
});

test('unquoted path containing whitespace falls back as unclear', () => {
  const input = checkerInput();
  input.subtodos[0]!.spec = 'edit apps/server/src/merge gate/x.ts';
  expect(checkSplitPlan(input).ok).toBe(false);
});

test('left join returns a null machine and the production split falls back without a runtime exception', async () => {
  const s = bootServer();
  try {
    s.db.insert(agent).values({ id: 'worker', teamId: s.team.id, displayName: 'Worker' }).run();
    const joined = s.db
      .select({
        id: agent.id,
        machine: {
          online: machine.online,
          enabledRuntimes: machine.enabledRuntimes,
          capabilities: machine.capabilities,
          claudeCodeReport: machine.claudeCodeReport,
        },
      })
      .from(agent)
      .leftJoin(machine, eq(agent.machineId, machine.id))
      .where(eq(agent.id, 'worker'))
      .get();
    expect(joined).toEqual({ id: 'worker', machine: null });
    const projectId = await postProject(s.app);
    expect(
      (await req(s.app, 'PATCH', `/api/projects/${projectId}`, { splitPolicy: 'auto' })).status,
    ).toBe(200);
    const created = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
      title: 'Split',
      spec: 'ordinary implementation',
    });
    const parent = (await created.json()) as { id: string };
    const result = createSplitTodo(s.svc, {
      parentId: parent.id,
      subtodos: checkerInput().subtodos,
      chiefAgentId: null,
      chiefId: 'chief-test',
      threadId: 'chief-thread-test',
      actorName: 'Chief',
    });
    expect(result.autoStart).toBe(false);
    expect(
      (await (await req(s.app, 'GET', `/api/todos/${parent.id}`)).json()) as unknown,
    ).toMatchObject({ phase: 'confirm' });
  } finally {
    s.dispose();
  }
});

test.each([
  null,
  { installed: false, hostname: 'test', models: [{ id: 'selected', name: 'Selected' }] },
  { installed: true, hostname: 'test', models: [] },
])('checker rejects unavailable selected Claude model with report %j', (report) => {
  const input = checkerInput();
  const home = {
    name: 'test',
    online: true,
    enabledRuntimes: ['claude-code'],
    capabilities: null,
    claudeCodeReport: report,
  };
  input.agents[0] = {
    ...input.agents[0]!,
    provider: 'claude-code',
    modelId: 'selected',
    machine: home,
  };
  expect(homeMachineRejectReason(home, input.agents[0]!)).not.toBeNull();
  expect(checkSplitPlan(input).ok).toBe(false);
});

test('pause-only PATCH preserves every first-PR field, including dismissal and recorded first PR', async () => {
  const s = bootServer();
  try {
    const fields = {
      firstPrReportPromptEnabled: true,
      firstPrReportPromptDismissedAt: 1234,
      firstPrReportPromptFirstPrAt: 2345,
      firstPrReportPromptFirstPrNumber: 7,
    };
    s.db.update(team).set(fields).where(eq(team.id, s.team.id)).run();
    const before = s.db.select().from(team).where(eq(team.id, s.team.id)).get()!;
    expect(
      (await req(s.app, 'PATCH', `/api/teams/${s.team.id}`, { autonomyPaused: true })).status,
    ).toBe(200);
    expect(s.db.select().from(team).where(eq(team.id, s.team.id)).get()).toEqual({
      ...before,
      autonomyPaused: true,
    });
  } finally {
    s.dispose();
  }
});

test('checker matches the existing home-machine selected-model liveness decision', () => {
  const catalog = [{ id: 'selected', liveness: 'dead' as const }];
  const input = { ...checkerInput(), modelCatalog: catalog };
  const home = {
    name: 'test',
    online: true,
    enabledRuntimes: ['claude-code'],
    capabilities: null,
    claudeCodeReport: {
      installed: true,
      hostname: 'test',
      models: [{ id: 'selected', name: 'Selected' }],
    },
  };
  input.agents[0] = {
    ...input.agents[0]!,
    provider: 'claude-code',
    modelId: 'selected',
    machine: home,
  };
  expect(homeMachineRejectReason(home, input.agents[0]!, catalog)).not.toBeNull();
  expect(checkSplitPlan(input).ok).toBe(false);
});

test('an available selected Claude model passes the existing home gate and checker', () => {
  const input = checkerInput();
  const home = {
    name: 'test',
    online: true,
    enabledRuntimes: ['claude-code'],
    capabilities: null,
    claudeCodeReport: {
      installed: true,
      hostname: 'test',
      models: [{ id: 'selected', name: 'Selected' }],
    },
  };
  input.agents[0] = {
    ...input.agents[0]!,
    provider: 'claude-code',
    modelId: 'selected',
    machine: home,
  };
  expect(homeMachineRejectReason(home, input.agents[0]!)).toBeNull();
  expect(checkSplitPlan(input).ok).toBe(true);
});

test('separate ordinary file references with connecting prose remain eligible', () => {
  const input = checkerInput();
  input.subtodos[0]!.spec = 'edit apps/web/src/view.ts and apps/web/src/other.ts';
  expect(checkSplitPlan(input).ok).toBe(true);
});
