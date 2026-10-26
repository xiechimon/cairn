import type { ClaudeCodeReport } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  machine as machineTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { claimStep } from '../src/services/machines.js';
import {
  bootServer,
  insertMachine,
  issueApiKey,
  postProject,
  req,
  type TestServer,
} from './helpers.js';

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

let seq = 9_400;

function claimAs(s: TestServer, machineId: string) {
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
  );
}

function report(login?: {
  state: 'ok' | 'expiring' | 'expired' | 'unknown';
  expiresAt?: number;
}): ClaudeCodeReport {
  return {
    installed: true,
    hostname: 'omarchy',
    models: [],
    ...(login !== undefined ? { login } : {}),
  } as ClaudeCodeReport;
}

async function world(): Promise<{ s: TestServer; projectId: string }> {
  const s = bootServer();
  disposables.push(() => s.dispose());
  const projectId = await postProject(s.app, 'claude-login');
  return { s, projectId };
}

function insertAgent(
  s: TestServer,
  opts: { id: string; machineId: string; provider: string },
): void {
  s.db
    .insert(agentTable)
    .values({
      id: opts.id,
      teamId: s.team.id,
      displayName: opts.id,
      provider: opts.provider,
      modelId: 'stub-model',
      thinkingLevel: 'off',
      machineId: opts.machineId,
    })
    .run();
}

function insertBuildStep(s: TestServer, projectId: string, agentId: string): string {
  seq += 1;
  const suffix = `${seq}`;
  const todoId = `todo-login-${suffix}`;
  const buildId = `build-login-${suffix}`;
  const stepId = `step-login-${suffix}`;
  s.db
    .insert(todoTable)
    .values({
      id: todoId,
      teamId: s.team.id,
      projectId,
      seqNum: seq,
      title: `login probe ${suffix}`,
      spec: '',
      phase: 'queued',
      phaseAt: seq,
      assignment: { plan: null, build: { agentId } },
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
  s.db
    .insert(stepTable)
    .values({
      id: stepId,
      buildId,
      kind: 'build',
      machineId: null,
      status: 'pending',
      prompt: null,
      freshSession: false,
      createdAt: seq,
    })
    .run();
  return stepId;
}

function stepStatus(s: TestServer, stepId: string): string {
  return s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!.status;
}

function insertChief(s: TestServer, machineId: string, provider: string): string {
  const agentId = `agent-chief-${provider}-${machineId}`;
  insertAgent(s, { id: agentId, machineId, provider });
  const chiefId = `chief-login-${machineId}`;
  s.db
    .insert(chiefTable)
    .values({
      id: chiefId,
      userId: s.svc.user.id,
      teamId: s.team.id,
      agentId,
      charter: '',
      createdAt: 1,
    })
    .run();
  const threadId = `thread-login-${machineId}`;
  s.db
    .insert(chiefThreadTable)
    .values({
      id: threadId,
      chiefId,
      userId: s.svc.user.id,
      teamId: s.team.id,
      title: 'login probe',
      createdAt: 2,
      updatedAt: 2,
      sessionId: '',
      sessionOpenedAt: 2,
    })
    .run();
  const stepId = `step-chief-login-${machineId}`;
  s.db
    .insert(stepTable)
    .values({ id: stepId, buildId: threadId, kind: 'chief', status: 'pending', createdAt: 3 })
    .run();
  return stepId;
}

describe('claimStep and Claude Code login expiry', () => {
  test('an expired login is not given its pinned claude-code step; the step stays pending', async () => {
    const { s, projectId } = await world();
    const expiredId = insertMachine(s, {
      name: 'expired-host',
      claudeCodeReport: report({ state: 'expired', expiresAt: Date.now() - 3_600_000 }),
    });
    insertAgent(s, { id: 'agent-expired', machineId: expiredId, provider: 'claude-code' });
    const stepId = insertBuildStep(s, projectId, 'agent-expired');
    expect(await claimAs(s, expiredId)).toBeNull();
    expect(stepStatus(s, stepId)).toBe('pending');
  });

  test('a healthy machine still claims the claude-code step pinned to it', async () => {
    const { s, projectId } = await world();
    insertMachine(s, {
      name: 'expired-other',
      claudeCodeReport: report({ state: 'expired', expiresAt: Date.now() - 3_600_000 }),
    });
    const healthyId = insertMachine(s, {
      name: 'healthy-host',
      claudeCodeReport: report({ state: 'ok', expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 }),
    });
    insertAgent(s, { id: 'agent-healthy', machineId: healthyId, provider: 'claude-code' });
    const stepId = insertBuildStep(s, projectId, 'agent-healthy');
    const claimed = await claimAs(s, healthyId);
    expect(claimed?.step.id).toBe(stepId);
  });

  test('unknown, missing, and still-valid expiring logins do not block claude-code claim', async () => {
    const cases = [
      report({ state: 'unknown', expiresAt: Date.now() - 1 }),
      report(),
      report({ state: 'expiring', expiresAt: Date.now() + 2 * 24 * 60 * 60 * 1000 }),
    ];
    for (const [index, claudeCodeReport] of cases.entries()) {
      const { s, projectId } = await world();
      const machineId = insertMachine(s, { name: `open-${index}`, claudeCodeReport });
      const agentId = `agent-open-${index}`;
      insertAgent(s, { id: agentId, machineId, provider: 'claude-code' });
      const stepId = insertBuildStep(s, projectId, agentId);
      const claimed = await claimAs(s, machineId);
      expect(claimed?.step.id).toBe(stepId);
    }
  });

  test('a clock that has passed blocks even when the stored label is still expiring', async () => {
    const { s, projectId } = await world();
    const machineId = insertMachine(s, {
      name: 'stale-expiring',
      claudeCodeReport: report({ state: 'expiring', expiresAt: Date.now() - 1 }),
    });
    insertAgent(s, { id: 'agent-stale', machineId, provider: 'claude-code' });
    const stepId = insertBuildStep(s, projectId, 'agent-stale');
    expect(await claimAs(s, machineId)).toBeNull();
    expect(stepStatus(s, stepId)).toBe('pending');
  });

  test('pi steps on an expired claude-code machine are still claimed', async () => {
    const { s, projectId } = await world();
    const machineId = insertMachine(s, {
      name: 'expired-pi',
      claudeCodeReport: report({ state: 'expired', expiresAt: Date.now() - 3_600_000 }),
    });
    insertAgent(s, { id: 'agent-pi', machineId, provider: 'stub-gw' });
    const stepId = insertBuildStep(s, projectId, 'agent-pi');
    const claimed = await claimAs(s, machineId);
    expect(claimed?.step.id).toBe(stepId);
  });

  test('a chief claude-code step is not claimed by an expired login', async () => {
    const { s } = await world();
    const machineId = insertMachine(s, {
      name: 'expired-chief',
      claudeCodeReport: report({ state: 'expired', expiresAt: Date.now() - 3_600_000 }),
    });
    const stepId = insertChief(s, machineId, 'claude-code');
    expect(await claimAs(s, machineId)).toBeNull();
    expect(stepStatus(s, stepId)).toBe('pending');
  });

  test('a chief step with an unknown login is still claimed', async () => {
    const { s } = await world();
    const machineId = insertMachine(s, {
      name: 'unknown-chief',
      claudeCodeReport: report({ state: 'unknown', expiresAt: Date.now() - 1 }),
    });
    const stepId = insertChief(s, machineId, 'claude-code');
    const claimed = await claimAs(s, machineId);
    expect(claimed?.step.id).toBe(stepId);
  });
});

describe('presence stores Claude Code login and the machine record exposes it', () => {
  test('presence keeps login, and the team machine list returns claudeLogin', async () => {
    const { s } = await world();
    const apiKey = await issueApiKey(s);
    const enrolled = await s.app.request('/api/machine/enroll', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ teamId: s.team.id, name: 'omarchy', cliVersion: '0.1.0' }),
    });
    expect(enrolled.status).toBe(200);
    const { machineId, token } = (await enrolled.json()) as { machineId: string; token: string };
    const expiresAt = Date.now() + 2 * 24 * 60 * 60 * 1000;
    const presence = await s.app.request('/api/machine/presence', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        cliVersion: '0.1.0',
        claudeCode: {
          installed: true,
          hostname: 'omarchy',
          models: [],
          login: { state: 'expiring', expiresAt },
        },
      }),
    });
    expect(presence.status).toBe(200);
    const row = s.db.select().from(machineTable).where(eq(machineTable.id, machineId)).get();
    expect((row?.claudeCodeReport as { login?: unknown } | null)?.login).toEqual({
      state: 'expiring',
      expiresAt,
    });
    const list = await req(s.app, 'GET', `/api/teams/${s.team.id}/machines`);
    expect(list.status).toBe(200);
    const machines = (await list.json()) as { id: string; claudeLogin?: unknown }[];
    expect(machines.find((machine) => machine.id === machineId)?.claudeLogin).toEqual({
      state: 'expiring',
      expiresAt,
    });
  });
});
