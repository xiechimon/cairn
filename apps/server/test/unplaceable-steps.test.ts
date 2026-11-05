import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  machine as machineTable,
  notification as notificationTable,
  routingRule,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { newRecordId } from '../src/lib/ids.js';
import { OVERFLOW_AFTER_MS } from '../src/services/machine-routing.js';
import { setRoutingRulesEnabled } from '../src/services/routing-rules.js';
import { NO_MACHINE_ALERT_MS, sweepUnplaceableSteps } from '../src/services/unplaceable-steps.js';
import { bootServer, issueApiKey, postProject, type TestServer } from './helpers.js';

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});
beforeEach(() => setRoutingRulesEnabled(true));
afterEach(() => setRoutingRulesEnabled(false));

let seq = 20_000;

interface World {
  s: TestServer;
  projectId: string;
}

async function world(): Promise<World> {
  const s = bootServer({ claimHoldMs: 50 });
  disposables.push(() => s.dispose());
  return { s, projectId: await postProject(s.app, 'pool-proj') };
}

async function machineOf(
  w: World,
  name: string,
  opts: {
    online?: boolean;
    executor?: 'orb' | 'host';
    runtimes?: string[];
    maxConcurrent?: number;
  } = {},
): Promise<string> {
  const apiKey = await issueApiKey(w.s);
  const res = await w.s.app.request('/api/machine/enroll', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      teamId: w.s.team.id,
      name,
      cliVersion: '0.1.0',
      capabilities: { mcpServers: [], skills: [], executor: opts.executor ?? 'host' },
    }),
  });
  expect(res.status).toBe(200);
  const { machineId } = (await res.json()) as { machineId: string };
  w.s.db
    .update(machineTable)
    .set({
      online: opts.online ?? true,
      enabledRuntimes: opts.runtimes ?? ['pi'],
      maxConcurrent: opts.maxConcurrent ?? 3,
    })
    .where(eq(machineTable.id, machineId))
    .run();
  return machineId;
}

function agentOf(
  w: World,
  id: string,
  preferred: string | null,
  requiredCapabilities: { executor?: 'orb'; mcpServers?: string[] } | null = null,
): void {
  w.s.db
    .insert(agentTable)
    .values({
      id,
      teamId: w.s.team.id,
      displayName: id,
      status: 'active',
      avatarUrl: null,
      provider: 'stub-gw',
      modelId: 'stub-model',
      thinkingLevel: null,
      tools: [],
      secrets: [],
      defaultSkill: null,
      skillsAllowlist: null,
      mcpServers: [],
      maxConcurrentTasks: null,
      requiredCapabilities: null,
      machineId: null,
    })
    .run();
  w.s.db.delete(routingRule).where(eq(routingRule.teamId, w.s.team.id)).run();
  w.s.db
    .insert(routingRule)
    .values({
      id: newRecordId(),
      teamId: w.s.team.id,
      use: 'session',
      provider: 'stub-gw',
      modelId: 'stub-model',
      thinkingLevel: null,
      machineId: preferred,
      requiredCapabilities,
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
}

function pendingStep(
  w: World,
  agentId: string,
  opts: { ageMs?: number; priorSession?: { machineId: string; sessionId: string } } = {},
): string {
  seq += 1;
  const id = `pool-${seq}`;
  const now = Date.now();
  const createdAt = now - (opts.ageMs ?? 0);
  w.s.db
    .insert(todoTable)
    .values({
      id: `todo-${id}`,
      teamId: w.s.team.id,
      projectId: w.projectId,
      seqNum: seq,
      title: `pool ${id}`,
      spec: 'probe',
      phase: 'queued',
      phaseAt: createdAt,
      assignment: { plan: null, build: { agentId } },
    })
    .run();
  w.s.db
    .insert(buildTable)
    .values({
      id: `build-${id}`,
      todoId: `todo-${id}`,
      withPlan: false,
      planDocId: null,
      triggerSource: 'user',
      createdAt: createdAt - 10,
    })
    .run();
  if (opts.priorSession !== undefined) {
    w.s.db
      .insert(stepTable)
      .values({
        id: `prior-${id}`,
        buildId: `build-${id}`,
        kind: 'build',
        machineId: opts.priorSession.machineId,
        status: 'done',
        prompt: null,
        freshSession: false,
        sessionId: opts.priorSession.sessionId,
        createdAt: createdAt - 5,
      })
      .run();
  }
  w.s.db
    .insert(stepTable)
    .values({
      id: `step-${id}`,
      buildId: `build-${id}`,
      kind: 'build',
      machineId: null,
      status: 'pending',
      prompt: null,
      freshSession: false,
      createdAt,
    })
    .run();
  return `step-${id}`;
}

function alerts(w: World) {
  return w.s.db
    .select()
    .from(notificationTable)
    .all()
    .filter((n) => n.type === 'no_machine');
}

describe('D71 a pending step that no online machine can run raises one inbox item', () => {
  test('an Orb-required step with only a host online alerts after the wait, naming the missing executor', async () => {
    const w = await world();
    const orb = await machineOf(w, 'omarchy-orb', { online: false, executor: 'orb' });
    await machineOf(w, 'mac');
    agentOf(w, 'implementer', orb, { executor: 'orb' });
    pendingStep(w, 'implementer', { ageMs: NO_MACHINE_ALERT_MS + 1_000 });
    sweepUnplaceableSteps(w.s.svc, Date.now());
    const [item] = alerts(w);
    expect(item?.snippet).toContain('omarchy-orb');
  });

  test('no alert before the wait has passed', async () => {
    const w = await world();
    const orb = await machineOf(w, 'omarchy-orb', { online: false, executor: 'orb' });
    await machineOf(w, 'mac');
    agentOf(w, 'implementer', orb, { executor: 'orb' });
    pendingStep(w, 'implementer', { ageMs: NO_MACHINE_ALERT_MS - 60_000 });
    sweepUnplaceableSteps(w.s.svc, Date.now());
    expect(alerts(w)).toHaveLength(0);
  });

  test('no alert while some online machine could take the step', async () => {
    const w = await world();
    const omarchy = await machineOf(w, 'omarchy', { online: false });
    await machineOf(w, 'mac');
    agentOf(w, 'reviewer', omarchy);
    pendingStep(w, 'reviewer', { ageMs: OVERFLOW_AFTER_MS * 3 });
    sweepUnplaceableSteps(w.s.svc, Date.now());
    expect(alerts(w)).toHaveLength(0);
  });

  test('a missing capability on the online machines is named', async () => {
    const w = await world();
    const mac = await machineOf(w, 'mac');
    agentOf(w, 'designer', mac, { mcpServers: ['figma'] });
    pendingStep(w, 'designer', { ageMs: NO_MACHINE_ALERT_MS + 1_000 });
    sweepUnplaceableSteps(w.s.svc, Date.now());
    expect(alerts(w)[0]?.snippet).toContain('MCP server "figma"');
  });

  test('a read alert is not raised again for the same wait', async () => {
    const w = await world();
    const orb = await machineOf(w, 'omarchy-orb', { online: false, executor: 'orb' });
    agentOf(w, 'implementer', orb, { executor: 'orb' });
    pendingStep(w, 'implementer', { ageMs: NO_MACHINE_ALERT_MS + 1_000 });
    sweepUnplaceableSteps(w.s.svc, Date.now());
    w.s.db.update(notificationTable).set({ readAt: Date.now() }).run();
    sweepUnplaceableSteps(w.s.svc, Date.now() + 60_000);
    expect(alerts(w)).toHaveLength(1);
    expect(alerts(w)[0]?.readAt).not.toBeNull();
  });

  test('routing rules off: a pinned step whose machine is offline alerts and names that machine', async () => {
    const w = await world();
    setRoutingRulesEnabled(false);
    const omarchy = await machineOf(w, 'omarchy', { online: false });
    await machineOf(w, 'mac');
    agentOf(w, 'pinned', null);
    w.s.db.update(agentTable).set({ machineId: omarchy }).where(eq(agentTable.id, 'pinned')).run();
    pendingStep(w, 'pinned', { ageMs: NO_MACHINE_ALERT_MS + 1_000 });
    sweepUnplaceableSteps(w.s.svc, Date.now());
    expect(alerts(w)[0]?.snippet).toContain('omarchy');
  });
});
