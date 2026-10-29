import type { ClaimedStep } from '@cairn/shared';
import { claimedStepSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  machine as machineTable,
  step as stepTable,
} from '../src/db/schema.js';
import { bootServer, postProject } from './helpers.js';

const HOUR = 60 * 60 * 1000;

async function call(
  app: Hono,
  method: string,
  path: string,
  opts: { cred?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.cred) headers.authorization = `Bearer ${opts.cred}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return Promise.resolve(
    app.request(path, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }),
  );
}

async function issueKey(s: ReturnType<typeof bootServer>, name: string): Promise<string> {
  const res = await call(s.app, 'POST', `/api/teams/${s.team.id}/api-keys`, {
    body: {
      name,
      gitAccess: false,
      mcpAccess: false,
      machineAccess: true,
      toolGrants: { read: [], write: [] },
    },
  });
  expect(res.status === 200 || res.status === 201).toBe(true);
  const body = (await res.json()) as { plaintext?: string; apiKey?: string; key?: string };
  const plain = body.plaintext ?? body.apiKey ?? body.key;
  if (!plain) throw new Error(`missing api key plaintext for ${name}`);
  return plain;
}

async function enroll(s: ReturnType<typeof bootServer>, key: string, name: string) {
  const res = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: { teamId: s.team.id, name, cliVersion: '0.1.0' },
  });
  expect(res.status).toBe(200);
  const { token } = (await res.json()) as { token: string };
  const row = s.db.select().from(machineTable).where(eq(machineTable.name, name)).get();
  if (!row) throw new Error(`enroll did not create ${name}`);
  s.db
    .update(machineTable)
    .set({ online: true, enabledRuntimes: ['pi', 'claude-code'] })
    .where(eq(machineTable.id, row.id))
    .run();
  return { token, machineId: row.id };
}

function insertAgent(
  s: ReturnType<typeof bootServer>,
  id: string,
  machineId: string,
  provider: string,
) {
  s.db
    .insert(agentTable)
    .values({
      id,
      teamId: s.team.id,
      displayName: id,
      provider,
      modelId: provider === 'claude-code' ? 'claude-sonnet' : 'stub-model',
      machineId,
    })
    .run();
}

async function startBuild(s: ReturnType<typeof bootServer>, agentId: string): Promise<string> {
  const projectId = await postProject(s.app);
  const todoRes = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    body: { title: `Rate limit task ${agentId}`, spec: 'Touch README.md' },
  });
  expect(todoRes.status).toBe(201);
  const { id: todoId } = (await todoRes.json()) as { id: string };
  const res = await call(s.app, 'POST', `/api/projects/${projectId}/builds`, {
    body: {
      todoIds: [todoId],
      assignment: { plan: null, build: { agentId } },
      withPlan: false,
    },
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { builds: { id: string }[] };
  return body.builds[0]!.id;
}

async function claim(s: ReturnType<typeof bootServer>, token: string): Promise<ClaimedStep | null> {
  const res = await call(s.app, 'POST', '/api/machine/tasks/claim', { cred: token, body: {} });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { step: unknown };
  if (!body.step) return null;
  return claimedStepSchema.parse(body.step);
}

function stepOfBuild(s: ReturnType<typeof bootServer>, buildId: string) {
  const row = s.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).get();
  if (!row) throw new Error(`no step for ${buildId}`);
  return row;
}

async function report(
  s: ReturnType<typeof bootServer>,
  token: string,
  machineId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return call(s.app, 'POST', '/api/machine/rate-limit', {
    cred: token,
    body: { machineId, ...body },
  });
}

describe('claude rate limit (#1852)', () => {
  test('records the latest window per machine and subscription', async () => {
    const s = bootServer({ claimHoldMs: 50 });
    const a = await enroll(s, await issueKey(s, 'omarchy-key'), 'omarchy');
    const b = await enroll(s, await issueKey(s, 'other-key'), 'other');
    const seconds = 1_800_000_000;
    const first = await report(s, a.token, a.machineId, {
      status: 'rejected',
      rateLimitType: 'five_hour',
      utilization: 1,
      resetsAt: seconds,
    });
    expect(first.status).toBe(200);
    const unnamed = await report(s, a.token, a.machineId, { status: 'allowed_warning' });
    expect(unnamed.status).toBe(200);
    const mismatch = await report(s, a.token, b.machineId, {
      status: 'rejected',
      rateLimitType: 'seven_day',
    });
    expect(mismatch.status).toBe(403);
    const rowA = s.db.select().from(machineTable).where(eq(machineTable.id, a.machineId)).get()!;
    const rowB = s.db.select().from(machineTable).where(eq(machineTable.id, b.machineId)).get()!;
    expect(rowA.claudeRateLimits).toEqual([
      {
        subscription: 'five_hour',
        status: 'rejected',
        utilization: 1,
        resetsAt: seconds * 1000,
        reportedAt: expect.any(Number),
      },
      {
        subscription: 'unspecified',
        status: 'allowed_warning',
        utilization: null,
        resetsAt: null,
        reportedAt: expect.any(Number),
      },
    ]);
    expect(rowB.claudeRateLimits ?? null).toBeNull();
    s.dispose();
  });

  test('a rejected machine is skipped until resetsAt, then claims again', async () => {
    const s = bootServer({ claimHoldMs: 50 });
    const machine = await enroll(s, await issueKey(s, 'omarchy-key'), 'omarchy');
    insertAgent(s, 'agent-cc', machine.machineId, 'claude-code');
    const buildId = await startBuild(s, 'agent-cc');
    const resetsAt = Date.now() + 2 * HOUR;
    expect(
      (
        await report(s, machine.token, machine.machineId, {
          status: 'rejected',
          rateLimitType: 'five_hour',
          resetsAt,
        })
      ).status,
    ).toBe(200);
    expect(await claim(s, machine.token)).toBeNull();
    const parked = stepOfBuild(s, buildId);
    expect(parked.status).toBe('waiting_quota');
    expect(parked.quotaBlock?.providerId).toBe('claude-code');
    expect(parked.quotaBlock?.source).toBe('claude_rate_limit');
    expect(parked.quotaBlock?.probeAt).toBeGreaterThan(Date.now() + 31 * 60 * 1000);
    s.db
      .update(machineTable)
      .set({
        claudeRateLimits: [
          {
            subscription: 'five_hour',
            status: 'rejected',
            utilization: 1,
            resetsAt: Date.now() - 1000,
            reportedAt: Date.now(),
          },
        ],
      })
      .where(eq(machineTable.id, machine.machineId))
      .run();
    const claimed = await claim(s, machine.token);
    expect(claimed?.step.buildId).toBe(buildId);
    expect(claimed?.step.machineId).toBe(machine.machineId);
    expect(stepOfBuild(s, buildId).status).toBe('claimed');
    s.dispose();
  });

  test('allowed and allowed_warning do not block a claim', async () => {
    const s = bootServer({ claimHoldMs: 50 });
    const machine = await enroll(s, await issueKey(s, 'omarchy-key'), 'omarchy');
    insertAgent(s, 'agent-cc', machine.machineId, 'claude-code');
    const warningBuild = await startBuild(s, 'agent-cc');
    expect(
      (
        await report(s, machine.token, machine.machineId, {
          status: 'allowed_warning',
          rateLimitType: 'five_hour',
          utilization: 0.9,
          resetsAt: Date.now() + HOUR,
        })
      ).status,
    ).toBe(200);
    expect((await claim(s, machine.token))?.step.buildId).toBe(warningBuild);
    const allowedBuild = await startBuild(s, 'agent-cc');
    expect(
      (
        await report(s, machine.token, machine.machineId, {
          status: 'allowed',
          rateLimitType: 'five_hour',
          utilization: 0.1,
        })
      ).status,
    ).toBe(200);
    expect((await claim(s, machine.token))?.step.buildId).toBe(allowedBuild);
    s.dispose();
  });

  test('a later allowed report clears the same window and a different window stays rejected', async () => {
    const s = bootServer({ claimHoldMs: 50 });
    const machine = await enroll(s, await issueKey(s, 'omarchy-key'), 'omarchy');
    insertAgent(s, 'agent-cc', machine.machineId, 'claude-code');
    const buildId = await startBuild(s, 'agent-cc');
    await report(s, machine.token, machine.machineId, {
      status: 'rejected',
      rateLimitType: 'seven_day',
      resetsAt: Date.now() + 7 * 24 * HOUR,
    });
    await report(s, machine.token, machine.machineId, {
      status: 'allowed',
      rateLimitType: 'five_hour',
      utilization: 0.2,
    });
    expect(await claim(s, machine.token)).toBeNull();
    expect(stepOfBuild(s, buildId).status).toBe('waiting_quota');
    await report(s, machine.token, machine.machineId, {
      status: 'allowed',
      rateLimitType: 'seven_day',
    });
    expect((await claim(s, machine.token))?.step.buildId).toBe(buildId);
    s.dispose();
  });

  test('another online machine takes the step and the agent stays bound to its owner', async () => {
    const s = bootServer({ claimHoldMs: 50 });
    const owner = await enroll(s, await issueKey(s, 'owner-key'), 'omarchy');
    const other = await enroll(s, await issueKey(s, 'spare-key'), 'spare');
    insertAgent(s, 'agent-cc', owner.machineId, 'claude-code');
    const buildId = await startBuild(s, 'agent-cc');
    await report(s, owner.token, owner.machineId, {
      status: 'rejected',
      rateLimitType: 'five_hour',
      resetsAt: Date.now() + 2 * HOUR,
    });
    expect(stepOfBuild(s, buildId).status).toBe('pending');
    const claimed = await claim(s, other.token);
    expect(claimed?.step.buildId).toBe(buildId);
    expect(claimed?.step.machineId).toBe(other.machineId);
    expect(
      s.db.select().from(agentTable).where(eq(agentTable.id, 'agent-cc')).get()?.machineId,
    ).toBe(owner.machineId);
    expect(await claim(s, owner.token)).toBeNull();
    s.dispose();
  });

  test('the only rejected machine parks the step and a failed done does not fail it', async () => {
    const s = bootServer({ claimHoldMs: 50 });
    const machine = await enroll(s, await issueKey(s, 'omarchy-key'), 'omarchy');
    insertAgent(s, 'agent-cc', machine.machineId, 'claude-code');
    const buildId = await startBuild(s, 'agent-cc');
    const claimed = await claim(s, machine.token);
    expect(claimed?.step.buildId).toBe(buildId);
    await report(s, machine.token, machine.machineId, {
      status: 'rejected',
      rateLimitType: 'five_hour',
      resetsAt: Date.now() + 2 * HOUR,
    });
    expect(stepOfBuild(s, buildId).status).toBe('claimed');
    const done = await call(s.app, 'POST', `/api/machine/done/${claimed!.step.id}`, {
      cred: machine.token,
      body: { status: 'failed', errorMessage: 'Claude subscription rejected' },
    });
    expect(done.status).toBe(200);
    const row = stepOfBuild(s, buildId);
    expect(row.status).toBe('waiting_quota');
    expect(row.quotaBlock?.providerId).toBe('claude-code');
    expect(row.quotaBlock?.source).toBe('claude_rate_limit');
    s.dispose();
  });

  test('a quota block for claude-code parks even when the rate-limit row was not stored', async () => {
    const s = bootServer({ claimHoldMs: 50 });
    const machine = await enroll(s, await issueKey(s, 'omarchy-key'), 'omarchy');
    insertAgent(s, 'agent-cc', machine.machineId, 'claude-code');
    const buildId = await startBuild(s, 'agent-cc');
    const claimed = await claim(s, machine.token);
    const done = await call(s.app, 'POST', `/api/machine/done/${claimed!.step.id}`, {
      cred: machine.token,
      body: {
        status: 'failed',
        errorMessage: 'rate limit',
        quotaBlock: {
          kind: 'quota',
          providerId: 'claude-code',
          reason: 'Claude subscription five_hour rejected',
          retryAfterMs: 2 * HOUR,
        },
      },
    });
    expect(done.status).toBe(200);
    const row = stepOfBuild(s, buildId);
    expect(row.status).toBe('waiting_quota');
    expect(row.quotaBlock?.probeAt).toBeGreaterThan(Date.now() + 31 * 60 * 1000);
    s.dispose();
  });

  test('a pi step on the rejected machine still claims and a pi failure stays a failure', async () => {
    const s = bootServer({ claimHoldMs: 50 });
    const machine = await enroll(s, await issueKey(s, 'omarchy-key'), 'omarchy');
    insertAgent(s, 'agent-cc', machine.machineId, 'claude-code');
    insertAgent(s, 'agent-pi', machine.machineId, 'stub-gw');
    const claudeBuild = await startBuild(s, 'agent-cc');
    const piBuild = await startBuild(s, 'agent-pi');
    await report(s, machine.token, machine.machineId, {
      status: 'rejected',
      rateLimitType: 'five_hour',
      resetsAt: Date.now() + 2 * HOUR,
    });
    expect(stepOfBuild(s, claudeBuild).status).toBe('waiting_quota');
    const claimed = await claim(s, machine.token);
    expect(claimed?.step.buildId).toBe(piBuild);
    const done = await call(s.app, 'POST', `/api/machine/done/${claimed!.step.id}`, {
      cred: machine.token,
      body: { status: 'failed', errorMessage: 'disk full' },
    });
    expect(done.status).toBe(200);
    expect(stepOfBuild(s, piBuild).status).toBe('failed');
    s.dispose();
  });
});
