import type { ClaudeSubscriptionQuotaWindow, MachineStreamEvent } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import { antigravitySubscription, machine as machineTable } from '../src/db/schema.js';
import {
  pollAllAntigravityQuotas,
  refreshAntigravityQuota,
} from '../src/services/antigravity-subscriptions.js';
import { bootServer, issueApiKey, req, type TestServer } from './helpers.js';

const disposables: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposables.splice(0)) dispose();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function enrollUsageRunner(
  s: TestServer,
  name: string,
  opts: { antigravityUsage?: boolean; installed?: boolean; authenticated?: boolean } = {},
) {
  const key = await issueApiKey(s);
  const enrolled = await s.app.request('/api/machine/enroll', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      teamId: s.team.id,
      name,
      capabilities: {
        mcpServers: [],
        skills: [],
        ...(opts.antigravityUsage !== false ? { antigravityUsage: true } : {}),
        antigravity: {
          installed: opts.installed !== false,
          authenticated: opts.authenticated !== false,
          models: [{ id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' }],
        },
      },
    }),
  });
  expect(enrolled.status).toBe(200);
  const runner = (await enrolled.json()) as { machineId: string; token: string };
  s.db
    .update(machineTable)
    .set({ online: true })
    .where(eq(machineTable.id, runner.machineId))
    .run();
  return runner;
}

function usageClaim(s: TestServer, requestId: string, machineToken: string, connectionId: string) {
  return s.app.request(`/api/machine/antigravity/usage/${requestId}/claim`, {
    method: 'POST',
    headers: { authorization: `Bearer ${machineToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ connectionId }),
  });
}

function usageResult(
  s: TestServer,
  requestId: string,
  machineToken: string,
  connectionId: string,
  result: unknown,
) {
  return s.app.request(`/api/machine/antigravity/usage/${requestId}/result`, {
    method: 'POST',
    headers: { authorization: `Bearer ${machineToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ connectionId, result }),
  });
}

function insertOAuthAntigravity(s: TestServer, opts: { enabled?: boolean; token?: string } = {}) {
  const id = `agy-oauth-${Math.random().toString(36).slice(2)}`;
  const now = Date.now();
  const payload = JSON.stringify({
    token: opts.token ?? 'ya29.test-oauth-access-token',
    tokenExpiresAt: now + 3_600_000,
    refreshToken: '1//test-oauth-refresh-token-1234',
    authMethod: 'consumer',
    subject: 'google-sub-1',
  });
  s.db
    .insert(antigravitySubscription)
    .values({
      id,
      teamId: s.team.id,
      label: 'Google OAuth',
      tokenCipher: `oauth-personal:v2:${s.secretBox.seal(payload)}`,
      runnerId: null,
      expiresAt: null,
      enabledAt: opts.enabled === false ? null : now,
      quotaWindows: null,
      models: [],
      lastCheck: null,
      createdAt: now,
    })
    .run();
  return id;
}

describe('antigravity usage polling', () => {
  test('dispatches OAuth usage probe, enforces single-use claim, stores windows, and filters expired resets', async () => {
    const s = bootServer();
    disposables.push(() => s.dispose());
    const runner = await enrollUsageRunner(s, 'usage-runner');
    const otherRunner = await enrollUsageRunner(s, 'other-runner');
    const id = insertOAuthAntigravity(s);

    const dispatched = deferred<string>();
    disposables.push(
      s.machineHub.subscribeMachine(s.team.id, runner.machineId, (ev: MachineStreamEvent) => {
        if (ev.type === 'antigravity.usage') dispatched.resolve(ev.requestId);
      }),
    );
    const connectionId = s.machineHub.connectionId(runner.machineId)!;
    const pending = req(s.app, 'POST', `/api/teams/${s.team.id}/antigravity-subscriptions/quota`);
    const requestId = await dispatched.promise;

    expect((await usageClaim(s, requestId, otherRunner.token, connectionId)).status).toBe(404);
    expect((await usageClaim(s, requestId, runner.token, 'wrong-conn')).status).toBe(404);
    expect(
      (await usageResult(s, requestId, runner.token, connectionId, { status: 'ok', windows: [] }))
        .status,
    ).toBe(404);

    const claimRes = await usageClaim(s, requestId, runner.token, connectionId);
    expect(claimRes.status).toBe(200);
    expect(claimRes.headers.get('cache-control')).toBe('no-store');
    expect(await claimRes.json()).toEqual({
      mode: 'oauth',
      credential: {
        kind: 'oauth-personal',
        refreshToken: '1//test-oauth-refresh-token-1234',
        authMethod: 'consumer',
        token: 'ya29.test-oauth-access-token',
        expiresAt: expect.any(Number),
      },
    });
    expect((await usageClaim(s, requestId, runner.token, connectionId)).status).toBe(404);

    const now = Date.now();
    const windows: ClaudeSubscriptionQuotaWindow[] = [
      { name: 'gemini-5h', utilization: 0.25, resetsAt: now + 3_600_000, observedAt: now },
      { name: 'gemini-weekly', utilization: 0.1, resetsAt: now - 1_000, observedAt: now },
      { name: '3p-5h', utilization: 0, resetsAt: null, observedAt: now },
    ];
    const resultRes = await usageResult(s, requestId, runner.token, connectionId, {
      status: 'ok',
      windows,
    });
    expect(resultRes.status).toBe(200);
    expect(
      (await usageResult(s, requestId, runner.token, connectionId, { status: 'ok', windows }))
        .status,
    ).toBe(404);

    const response = await pending;
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      id: string;
      windows: ClaudeSubscriptionQuotaWindow[];
    }[];
    expect(body).toHaveLength(1);
    expect(body[0]?.id).toBe(id);
    expect(body[0]?.windows).toEqual([
      { name: 'gemini-5h', utilization: 0.25, resetsAt: now + 3_600_000, observedAt: now },
      { name: '3p-5h', utilization: 0, resetsAt: null, observedAt: now },
    ]);
  });

  test('dispatches host usage probe only to the bound authenticated runner', async () => {
    const s = bootServer();
    disposables.push(() => s.dispose());
    const bound = await enrollUsageRunner(s, 'bound-runner');
    const other = await enrollUsageRunner(s, 'other-runner');

    const created = await req(s.app, 'POST', `/api/teams/${s.team.id}/antigravity-subscriptions`, {
      label: 'Host login',
      runnerId: bound.machineId,
    });
    expect(created.status).toBe(201);

    const otherEvents: string[] = [];
    disposables.push(
      s.machineHub.subscribeMachine(s.team.id, other.machineId, (ev) => {
        if (ev.type === 'antigravity.usage') otherEvents.push(ev.requestId);
      }),
    );
    const dispatched = deferred<string>();
    disposables.push(
      s.machineHub.subscribeMachine(s.team.id, bound.machineId, (ev) => {
        if (ev.type === 'antigravity.usage') dispatched.resolve(ev.requestId);
      }),
    );
    const connectionId = s.machineHub.connectionId(bound.machineId)!;
    const pending = req(s.app, 'POST', `/api/teams/${s.team.id}/antigravity-subscriptions/quota`);
    const requestId = await dispatched.promise;

    const claimRes = await usageClaim(s, requestId, bound.token, connectionId);
    expect(claimRes.status).toBe(200);
    expect(await claimRes.json()).toEqual({ mode: 'host' });
    const now = Date.now();
    await usageResult(s, requestId, bound.token, connectionId, {
      status: 'ok',
      windows: [{ name: 'gemini-5h', utilization: 0.4, resetsAt: now + 60_000, observedAt: now }],
    });
    const list = (await (await pending).json()) as { windows: ClaudeSubscriptionQuotaWindow[] }[];
    expect(list[0]?.windows).toHaveLength(1);
    expect(otherEvents).toEqual([]);
  });

  test('skips API-key subscriptions without dispatching any probe', async () => {
    const s = bootServer();
    disposables.push(() => s.dispose());
    const runner = await enrollUsageRunner(s, 'runner');
    await req(s.app, 'POST', `/api/teams/${s.team.id}/antigravity-subscriptions`, {
      label: 'API key',
      token: `AIzaSyA${'k'.repeat(28)}`,
    });

    const events: string[] = [];
    disposables.push(
      s.machineHub.subscribeMachine(s.team.id, runner.machineId, (ev) => {
        if (ev.type === 'antigravity.usage') events.push(ev.requestId);
      }),
    );

    const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/antigravity-subscriptions/quota`);
    expect(res.status).toBe(200);
    expect(events).toEqual([]);
  });

  test('dedups concurrent refreshes, enforces 60s cooldown & 5m freshness, preserves prior windows on failure, and supports force', async () => {
    const s = bootServer();
    disposables.push(() => s.dispose());
    const runner = await enrollUsageRunner(s, 'runner');
    const id = insertOAuthAntigravity(s);
    const prior: ClaudeSubscriptionQuotaWindow[] = [
      {
        name: 'gemini-5h',
        utilization: 0.5,
        resetsAt: Date.now() + 3_600_000,
        observedAt: Date.now() - 10 * 60_000,
      },
    ];
    s.db
      .update(antigravitySubscription)
      .set({ quotaWindows: prior })
      .where(eq(antigravitySubscription.id, id))
      .run();

    const requests: string[] = [];
    disposables.push(
      s.machineHub.subscribeMachine(s.team.id, runner.machineId, (ev) => {
        if (ev.type !== 'antigravity.usage') return;
        requests.push(ev.requestId);
        const conn = s.machineHub.connectionId(runner.machineId)!;
        void (async () => {
          await usageClaim(s, ev.requestId, runner.token, conn);
          const result =
            requests.length === 1
              ? { status: 'failed', failure: 'upstream' }
              : {
                  status: 'ok',
                  windows: [
                    {
                      name: 'gemini-5h',
                      utilization: 0.75,
                      resetsAt: Date.now() + 3_600_000,
                      observedAt: Date.now(),
                    },
                  ],
                };
          await usageResult(s, ev.requestId, runner.token, conn, result);
        })();
      }),
    );

    const [a, b] = await Promise.all([
      refreshAntigravityQuota({ db: s.db, box: s.secretBox, machineHub: s.machineHub }, s.team.id),
      refreshAntigravityQuota({ db: s.db, box: s.secretBox, machineHub: s.machineHub }, s.team.id),
    ]);
    expect(requests).toHaveLength(1);
    expect(a[0]?.windows).toEqual(prior);
    expect(b[0]?.windows).toEqual(prior);

    // Within 60s cooldown -> does not dispatch again
    const cooldownRes = await refreshAntigravityQuota(
      { db: s.db, box: s.secretBox, machineHub: s.machineHub },
      s.team.id,
    );
    expect(requests).toHaveLength(1);
    expect(cooldownRes[0]?.windows).toEqual(prior);

    // force: true bypasses cooldown
    const forced = await refreshAntigravityQuota(
      { db: s.db, box: s.secretBox, machineHub: s.machineHub },
      s.team.id,
      { force: true },
    );
    expect(requests).toHaveLength(2);
    expect(forced[0]?.windows?.[0]?.utilization).toBe(0.75);

    // Fresh (< 5m) suppresses background poll without force
    await pollAllAntigravityQuotas({ db: s.db, box: s.secretBox, machineHub: s.machineHub });
    expect(requests).toHaveLength(2);
  });

  test('revokes result when subscription changes after claim', async () => {
    const s = bootServer();
    disposables.push(() => s.dispose());
    const runner = await enrollUsageRunner(s, 'runner');
    const id = insertOAuthAntigravity(s);
    const dispatched = deferred<string>();
    disposables.push(
      s.machineHub.subscribeMachine(s.team.id, runner.machineId, (ev) => {
        if (ev.type === 'antigravity.usage') dispatched.resolve(ev.requestId);
      }),
    );
    const conn = s.machineHub.connectionId(runner.machineId)!;
    const pending = refreshAntigravityQuota(
      { db: s.db, box: s.secretBox, machineHub: s.machineHub },
      s.team.id,
    );
    const requestId = await dispatched.promise;
    expect((await usageClaim(s, requestId, runner.token, conn)).status).toBe(200);

    s.db
      .update(antigravitySubscription)
      .set({ enabledAt: null })
      .where(eq(antigravitySubscription.id, id))
      .run();

    const now = Date.now();
    const res = await usageResult(s, requestId, runner.token, conn, {
      status: 'ok',
      windows: [{ name: 'gemini-5h', utilization: 0.2, resetsAt: now + 60_000, observedAt: now }],
    });
    expect(res.status).toBe(409);
    const list = await pending;
    expect(list[0]?.windows).toEqual([]);
  });
});
