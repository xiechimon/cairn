import type { ClaimedStep } from '@cairn/shared';
import { claimedStepSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import {
  claudeSubscription as claudeSubscriptionTable,
  machine as machineTable,
  routingRule,
  step as stepTable,
} from '../src/db/schema.js';
import {
  bootServer,
  insertClaudeSubscription,
  postProject,
  seedRoute,
  seedSessionRoute,
} from './helpers.js';

const HOUR = 60 * 60 * 1000;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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
      name: name.toUpperCase().replaceAll('-', '_'),
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
    body: readyMachine({ teamId: s.team.id, name, cliVersion: '0.1.0' }),
  });
  expect(res.status).toBe(200);
  const { token } = (await res.json()) as { token: string };
  const row = s.db.select().from(machineTable).where(eq(machineTable.name, name)).get();
  if (!row) throw new Error(`enroll did not create ${name}`);
  s.db
    .update(machineTable)
    .set({
      online: true,
      claudeCodeReport: {
        installed: true,
        hostname: name,
        models: [{ id: 'claude-sonnet', name: 'Sonnet' }],
        auth: { state: 'logged-in', method: 'claude.ai', provider: 'firstParty' },
      },
    })
    .where(eq(machineTable.id, row.id))
    .run();
  return { token, machineId: row.id };
}

function useSessionRoute(s: ReturnType<typeof bootServer>, machineId: string, provider: string) {
  seedSessionRoute(s, {
    provider,
    modelId: provider === 'claude-code' ? 'claude-sonnet' : 'stub-model',
    machineId,
  });
}

async function startBuild(s: ReturnType<typeof bootServer>): Promise<string> {
  const projectId = await postProject(s.app);
  const todoRes = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    body: { title: 'Rate limit task', spec: 'Touch README.md' },
  });
  expect(todoRes.status).toBe(201);
  const { id: todoId } = (await todoRes.json()) as { id: string };
  const res = await call(s.app, 'POST', `/api/projects/${projectId}/builds`, {
    body: { todoIds: [todoId] },
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
    insertClaudeSubscription(s);
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
    insertClaudeSubscription(s);
    const machine = await enroll(s, await issueKey(s, 'omarchy-key'), 'omarchy');
    useSessionRoute(s, machine.machineId, 'claude-code');
    const buildId = await startBuild(s);
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
    insertClaudeSubscription(s);
    const machine = await enroll(s, await issueKey(s, 'omarchy-key'), 'omarchy');
    useSessionRoute(s, machine.machineId, 'claude-code');
    const warningBuild = await startBuild(s);
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
    const allowedBuild = await startBuild(s);
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

  test('a local merge already parked by the rate limiter resumes after an allowed report', async () => {
    const s = bootServer({ claimHoldMs: 50 });
    insertClaudeSubscription(s);
    const machine = await enroll(s, await issueKey(s, 'owner-key'), 'owner');
    useSessionRoute(s, machine.machineId, 'claude-code');
    const buildId = await startBuild(s);
    await report(s, machine.token, machine.machineId, {
      status: 'rejected',
      rateLimitType: 'five_hour',
      resetsAt: Date.now() + 2 * HOUR,
    });
    expect(stepOfBuild(s, buildId)).toMatchObject({
      status: 'waiting_quota',
      quotaBlock: { source: 'claude_rate_limit' },
    });
    s.db
      .update(stepTable)
      .set({
        kind: 'merge',
        prompt: JSON.stringify({
          kind: 'local-merge',
          command: {
            projectId: 'project',
            buildId,
            defaultBranch: 'main',
            workBranch: 'work',
            judgedBase: 'a'.repeat(40),
            judgedHead: 'b'.repeat(40),
            judgedPatchDigest: `pd2:${'c'.repeat(64)}`,
            localChecks: ['pnpm test'],
            message: 'Merge work',
            identity: { name: 'Test', email: 'test@example.com' },
          },
        }),
      })
      .where(eq(stepTable.buildId, buildId))
      .run();
    await report(s, machine.token, machine.machineId, {
      status: 'allowed',
      rateLimitType: 'five_hour',
    });
    expect(stepOfBuild(s, buildId)).toMatchObject({ status: 'pending', quotaBlock: null });
    s.dispose();
  });

  test('a later allowed report clears the same window and a different window stays rejected', async () => {
    const s = bootServer({ claimHoldMs: 50 });
    insertClaudeSubscription(s);
    const machine = await enroll(s, await issueKey(s, 'omarchy-key'), 'omarchy');
    useSessionRoute(s, machine.machineId, 'claude-code');
    const buildId = await startBuild(s);
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

  test('a continuing session on A is not parked for a rate-blocked rule machine B', async () => {
    const s = bootServer({ claimHoldMs: 50 });
    insertClaudeSubscription(s);
    const session = await enroll(s, await issueKey(s, 'session-key'), 'session-host');
    const rule = await enroll(s, await issueKey(s, 'rule-key'), 'rule-host');
    useSessionRoute(s, rule.machineId, 'claude-code');
    const buildId = await startBuild(s);
    const pending = stepOfBuild(s, buildId);
    s.db
      .insert(stepTable)
      .values({
        id: `prior-${pending.id}`,
        buildId,
        kind: 'session',
        machineId: session.machineId,
        status: 'done',
        prompt: null,
        freshSession: false,
        sessionId: 'sess-a',
        createdAt: pending.createdAt - 1,
      })
      .run();
    await report(s, rule.token, rule.machineId, {
      status: 'rejected',
      rateLimitType: 'five_hour',
      resetsAt: Date.now() + 2 * HOUR,
    });
    expect(s.db.select().from(stepTable).where(eq(stepTable.id, pending.id)).get()?.status).toBe(
      'pending',
    );
    expect((await claim(s, session.token))?.step.buildId).toBe(buildId);
    s.dispose();
  });

  test('another online machine does not take a rate-blocked owner step', async () => {
    const s = bootServer({ claimHoldMs: 50 });
    insertClaudeSubscription(s);
    const owner = await enroll(s, await issueKey(s, 'owner-key'), 'omarchy');
    const other = await enroll(s, await issueKey(s, 'spare-key'), 'spare');
    useSessionRoute(s, owner.machineId, 'claude-code');
    const buildId = await startBuild(s);
    await report(s, owner.token, owner.machineId, {
      status: 'rejected',
      rateLimitType: 'five_hour',
      resetsAt: Date.now() + 2 * HOUR,
    });
    expect(await claim(s, other.token)).toBeNull();
    expect(stepOfBuild(s, buildId).machineId).toBeNull();
    expect(stepOfBuild(s, buildId).status).not.toBe('claimed');
    expect(
      s.db.select().from(routingRule).where(eq(routingRule.use, 'session')).get()?.machineId,
    ).toBe(owner.machineId);
    s.dispose();
  });

  test('an OAuth or API-key spare does not take a rate-blocked owner step', async () => {
    const s = bootServer({ claimHoldMs: 50 });
    insertClaudeSubscription(s);
    try {
      const owner = await enroll(s, await issueKey(s, 'owner-key'), 'owner');
      const oauth = await enroll(s, await issueKey(s, 'oauth-key'), 'oauth-spare');
      const paid = await enroll(s, await issueKey(s, 'paid-key'), 'paid-spare');
      for (const [machineId, method] of [
        [owner.machineId, 'claude.ai'],
        [oauth.machineId, 'oauth_token'],
        [paid.machineId, 'api_key'],
      ] as const) {
        s.db
          .update(machineTable)
          .set({
            claudeCodeReport: {
              installed: true,
              hostname: machineId,
              models: [{ id: 'claude-sonnet', name: 'Sonnet' }],
              auth: { state: 'logged-in', method, provider: 'firstParty' },
            },
          })
          .where(eq(machineTable.id, machineId))
          .run();
      }
      useSessionRoute(s, owner.machineId, 'claude-code');
      const buildId = await startBuild(s);
      expect(
        (
          await report(s, owner.token, owner.machineId, {
            status: 'rejected',
            rateLimitType: 'five_hour',
            resetsAt: Date.now() + 2 * HOUR,
          })
        ).status,
      ).toBe(200);
      expect(stepOfBuild(s, buildId).status).toBe('waiting_quota');
      expect(await claim(s, paid.token)).toBeNull();
      expect(await claim(s, oauth.token)).toBeNull();
      expect(stepOfBuild(s, buildId).status).toBe('waiting_quota');
      expect(stepOfBuild(s, buildId).machineId).toBeNull();
      expect(
        s.db.select().from(routingRule).where(eq(routingRule.use, 'session')).get()?.machineId,
      ).toBe(owner.machineId);
    } finally {
      s.dispose();
    }
  });

  test.each(['oauth_token', 'api_key'] as const)(
    'a %s spare does not take a rate-blocked owner step',
    async (method) => {
      const s = bootServer({ claimHoldMs: 50 });
      insertClaudeSubscription(s);
      try {
        const owner = await enroll(s, await issueKey(s, 'owner-key'), 'owner');
        const oauth = await enroll(s, await issueKey(s, 'oauth-key'), 'oauth-spare');
        const paid = await enroll(s, await issueKey(s, 'paid-key'), 'paid-spare');
        for (const [machineId, authMethod] of [
          [owner.machineId, 'claude.ai'],
          [oauth.machineId, 'oauth_token'],
          [paid.machineId, 'api_key'],
        ] as const) {
          s.db
            .update(machineTable)
            .set({
              claudeCodeReport: {
                installed: true,
                hostname: machineId,
                models: [{ id: 'claude-sonnet', name: 'Sonnet' }],
                auth: { state: 'logged-in', method: authMethod, provider: 'firstParty' },
              },
            })
            .where(eq(machineTable.id, machineId))
            .run();
        }
        useSessionRoute(s, owner.machineId, 'claude-code');
        const buildId = await startBuild(s);
        expect(
          (
            await report(s, owner.token, owner.machineId, {
              status: 'rejected',
              rateLimitType: 'five_hour',
              resetsAt: Date.now() + 2 * HOUR,
            })
          ).status,
        ).toBe(200);
        const claimant = method === 'oauth_token' ? oauth : paid;
        expect(await claim(s, claimant.token)).toBeNull();
        expect(stepOfBuild(s, buildId)).toMatchObject({
          status: 'waiting_quota',
          machineId: null,
        });
        expect(
          s.db.select().from(routingRule).where(eq(routingRule.use, 'session')).get()?.machineId,
        ).toBe(owner.machineId);
      } finally {
        s.dispose();
      }
    },
  );

  test('non-Claude work on an API-key machine is claimed despite a Claude rate block', async () => {
    const s = bootServer({ claimHoldMs: 50 });
    insertClaudeSubscription(s);
    try {
      const machine = await enroll(s, await issueKey(s, 'paid-key'), 'paid');
      s.db
        .update(machineTable)
        .set({
          claudeCodeReport: {
            installed: true,
            hostname: 'paid',
            models: [{ id: 'claude-sonnet', name: 'Sonnet' }],
            auth: { state: 'logged-in', method: 'api_key' },
          },
        })
        .where(eq(machineTable.id, machine.machineId))
        .run();
      useSessionRoute(s, machine.machineId, 'stub-gw');
      const buildId = await startBuild(s);
      await report(s, machine.token, machine.machineId, {
        status: 'rejected',
        rateLimitType: 'five_hour',
        resetsAt: Date.now() + 2 * HOUR,
      });
      expect(await claim(s, machine.token)).toMatchObject({
        step: { buildId, machineId: machine.machineId },
        agent: { provider: 'stub-gw' },
      });
    } finally {
      s.dispose();
    }
  });

  test('the only rejected machine parks the step and a failed done does not fail it', async () => {
    const s = bootServer({ claimHoldMs: 50 });
    insertClaudeSubscription(s);
    const machine = await enroll(s, await issueKey(s, 'omarchy-key'), 'omarchy');
    useSessionRoute(s, machine.machineId, 'claude-code');
    const buildId = await startBuild(s);
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
    insertClaudeSubscription(s);
    const machine = await enroll(s, await issueKey(s, 'omarchy-key'), 'omarchy');
    useSessionRoute(s, machine.machineId, 'claude-code');
    const buildId = await startBuild(s);
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

  test('a late failure from a legacy pi reviewer stops it without changing the Claude quota wait', async () => {
    const s = bootServer({ claimHoldMs: 50 });
    insertClaudeSubscription(s);
    const machine = await enroll(s, await issueKey(s, 'omarchy-key'), 'omarchy');
    useSessionRoute(s, machine.machineId, 'claude-code');
    seedRoute(s, 'review', {
      provider: 'stub-gw',
      modelId: 'stub-model',
      machineId: machine.machineId,
    });
    const claudeBuild = await startBuild(s);
    const piBuild = await startBuild(s);
    s.db
      .update(stepTable)
      .set({
        kind: 'review',
        prompt: `${JSON.stringify({ kind: 'review', agentId: 'review-route', gate: 'review' })}\n请审核`,
      })
      .where(eq(stepTable.buildId, piBuild))
      .run();
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
    expect(stepOfBuild(s, piBuild).status).toBe('stopped');
    expect(stepOfBuild(s, claudeBuild).status).toBe('waiting_quota');
    s.dispose();
  });
});

describe('subscription quota attribution', () => {
  function quotaWindows(s: ReturnType<typeof bootServer>, subscriptionId: string) {
    return s.db
      .select()
      .from(claudeSubscriptionTable)
      .where(eq(claudeSubscriptionTable.id, subscriptionId))
      .get()?.quotaWindows;
  }

  function seedStep(
    s: ReturnType<typeof bootServer>,
    row: {
      id: string;
      machineId: string | null;
      subscriptionId: string | null;
      status?: 'pending' | 'claimed' | 'done' | 'failed' | 'stopped';
    },
  ) {
    s.db
      .insert(stepTable)
      .values({
        id: row.id,
        buildId: `b-${row.id}`,
        kind: 'build',
        status: row.status ?? 'claimed',
        machineId: row.machineId,
        claudeSubscriptionId: row.subscriptionId,
        claimedAt: 10,
        createdAt: 1,
      })
      .run();
  }

  test('a report for a claimed bound step writes the subscription quota windows beside the machine windows', async () => {
    const s = bootServer({ claimHoldMs: 50 });
    const subscriptionId = insertClaudeSubscription(s);
    const machine = await enroll(s, await issueKey(s, 'omarchy-key'), 'omarchy');
    useSessionRoute(s, machine.machineId, 'claude-code');
    const buildId = await startBuild(s);
    const claimed = await claim(s, machine.token);
    expect(claimed?.step.buildId).toBe(buildId);
    expect(stepOfBuild(s, buildId).claudeSubscriptionId).toBe(subscriptionId);
    const resetsAt = Date.now() + HOUR;
    const res = await report(s, machine.token, machine.machineId, {
      stepId: claimed!.step.id,
      status: 'rejected',
      rateLimitType: 'five_hour',
      utilization: 1,
      resetsAt,
    });
    expect(res.status).toBe(200);
    expect(quotaWindows(s, subscriptionId)).toEqual([
      expect.objectContaining({
        subscription: 'five_hour',
        status: 'rejected',
        utilization: 1,
        resetsAt,
      }),
    ]);
    expect(
      s.db.select().from(machineTable).where(eq(machineTable.id, machine.machineId)).get()
        ?.claudeRateLimits,
    ).toEqual([
      expect.objectContaining({
        subscription: 'five_hour',
        status: 'rejected',
        utilization: 1,
        resetsAt,
      }),
    ]);
    s.dispose();
  });

  test.each([
    ['no stepId', undefined],
    ['an unknown step', 'missing-step'],
    ['an unbound step', 'unbound-step'],
    ['a step another machine claimed', 'foreign-step'],
    ['a requeued step', 'requeued-step'],
  ])('a report citing %s writes machine windows only', async (_name, stepId) => {
    const s = bootServer({ claimHoldMs: 50 });
    const subscriptionId = insertClaudeSubscription(s);
    const machine = await enroll(s, await issueKey(s, 'omarchy-key'), 'omarchy');
    seedStep(s, { id: 'unbound-step', machineId: machine.machineId, subscriptionId: null });
    seedStep(s, {
      id: 'foreign-step',
      machineId: 'another-machine',
      subscriptionId,
    });
    seedStep(s, { id: 'requeued-step', machineId: null, subscriptionId, status: 'pending' });
    const res = await report(s, machine.token, machine.machineId, {
      ...(stepId !== undefined ? { stepId } : {}),
      status: 'rejected',
      rateLimitType: 'five_hour',
      utilization: 1,
      resetsAt: Date.now() + HOUR,
    });
    expect(res.status).toBe(200);
    expect(quotaWindows(s, subscriptionId) ?? null).toBeNull();
    expect(
      s.db.select().from(machineTable).where(eq(machineTable.id, machine.machineId)).get()
        ?.claudeRateLimits,
    ).toHaveLength(1);
    s.dispose();
  });

  test('a report arriving after the step finished still attributes by the stored row', async () => {
    const s = bootServer({ claimHoldMs: 50 });
    const subscriptionId = insertClaudeSubscription(s);
    const machine = await enroll(s, await issueKey(s, 'omarchy-key'), 'omarchy');
    seedStep(s, {
      id: 'finished-step',
      machineId: machine.machineId,
      subscriptionId,
      status: 'done',
    });
    const res = await report(s, machine.token, machine.machineId, {
      stepId: 'finished-step',
      status: 'allowed_warning',
      rateLimitType: 'seven_day',
      utilization: 0.7,
      resetsAt: Date.now() + 7 * 24 * HOUR,
    });
    expect(res.status).toBe(200);
    expect(quotaWindows(s, subscriptionId)).toEqual([
      expect.objectContaining({
        subscription: 'seven_day',
        status: 'allowed_warning',
        utilization: 0.7,
      }),
    ]);
    s.dispose();
  });

  test('a second report replaces the same subscription window', async () => {
    const s = bootServer({ claimHoldMs: 50 });
    const subscriptionId = insertClaudeSubscription(s);
    const machine = await enroll(s, await issueKey(s, 'omarchy-key'), 'omarchy');
    seedStep(s, {
      id: 'bound-2',
      machineId: machine.machineId,
      subscriptionId,
    });
    await report(s, machine.token, machine.machineId, {
      stepId: 'bound-2',
      status: 'rejected',
      rateLimitType: 'five_hour',
      resetsAt: Date.now() + HOUR,
    });
    await report(s, machine.token, machine.machineId, {
      stepId: 'bound-2',
      status: 'allowed',
      rateLimitType: 'five_hour',
      utilization: 0.1,
    });
    expect(quotaWindows(s, subscriptionId)).toEqual([
      expect.objectContaining({ subscription: 'five_hour', status: 'allowed', utilization: 0.1 }),
    ]);
    s.dispose();
  });

  test('a task run observation feeds the tray quota and sends no probe', async () => {
    const s = bootServer({ claimHoldMs: 50 });
    const subscriptionId = insertClaudeSubscription(s);
    const machine = await enroll(s, await issueKey(s, 'omarchy-key'), 'omarchy');
    seedStep(s, {
      id: 'observed-step',
      machineId: machine.machineId,
      subscriptionId,
    });
    const res = await report(s, machine.token, machine.machineId, {
      stepId: 'observed-step',
      status: 'allowed',
      rateLimitType: 'five_hour',
      utilization: 0.22,
      resetsAt: Date.now() + HOUR,
    });
    expect(res.status).toBe(200);
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>(async (url) => {
        calls.push(String(url));
        const target = String(url);
        if (target.includes('/v1/models'))
          return Response.json({ data: [{ id: 'claude-haiku-5-5' }], has_more: false });
        if (target.includes('/v1/messages')) return new Response('{}', { status: 200 });
        return new Response('{}', { status: 403 });
      }),
    );
    const refreshed = (await (
      await call(s.app, 'POST', `/api/teams/${s.team.id}/claude-subscriptions/quota`, {})
    ).json()) as { windows: { name: string; utilization: number }[] }[];
    expect(refreshed[0]?.windows).toEqual([
      expect.objectContaining({ name: 'five_hour', utilization: 0.22 }),
    ]);
    expect(calls.filter((url) => url.includes('/v1/messages'))).toEqual([]);
    s.dispose();
  });
});
