import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_ANTIGRAVITY_MODELS,
  type MachineAntigravityVerifyBody,
  type MachineStreamEvent,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import {
  antigravitySubscription,
  build as buildTable,
  machine as machineTable,
  pairedDevice,
  routingRule,
  step as stepTable,
  team,
} from '../src/db/schema.js';
import { sha256Hex } from '../src/lib/crypto.js';
import { openAntigravitySubscription } from '../src/services/antigravity-subscriptions.js';
import { issueBrowserSession } from '../src/services/browser-session.js';
import { requestAntigravityVerify } from '../src/services/machine-antigravity-verify.js';
import { MachineWakeHub } from '../src/services/machine-wake-hub.js';
import { markPresence } from '../src/services/machines.js';
import { getModelSources } from '../src/services/providers.js';
import {
  bootServer,
  insertMachine,
  issueApiKey,
  postProject,
  redeemTestPairing,
  req,
  seedRoute,
  type TestServer,
} from './helpers.js';

function attachLiveVerifier(
  s: TestServer,
  machineId: string,
  reply: (
    checkId: string,
    token: string,
  ) =>
    | Omit<MachineAntigravityVerifyBody, 'checkId'>
    | Promise<Omit<MachineAntigravityVerifyBody, 'checkId'> | null>
    | null,
): { token: string; checkIds: string[]; release: () => void } {
  const token = `machine-token-${machineId}-${Math.random().toString(36).slice(2)}`;
  s.db
    .update(machineTable)
    .set({ tokenHash: sha256Hex(token) })
    .where(eq(machineTable.id, machineId))
    .run();
  const checkIds: string[] = [];
  const release = s.machineHub.subscribeMachine(s.team.id, machineId, (ev) => {
    if (ev.type !== 'antigravity.verify') return;
    checkIds.push(ev.checkId);
    void Promise.resolve(reply(ev.checkId, token)).then(async (body) => {
      if (body === null) return;
      await s.app.request('/api/machine/antigravity/verify', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ checkId: ev.checkId, ...body }),
      });
    });
  });
  return { token, checkIds, release };
}

const disposables: (() => void)[] = [];
afterEach(() => {
  for (const d of disposables.splice(0)) d();
  vi.unstubAllGlobals();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('antigravity subscriptions REST & model sources', () => {
  test('supports host-keyring subscriptions without token and optional token subscriptions', async () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());

    const createdHost = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/antigravity-subscriptions`,
      {
        label: 'Mac Studio Keyring',
      },
    );
    expect(createdHost.status).toBe(201);
    const hostBody = (await createdHost.json()) as {
      id: string;
      kind: string;
      label: string;
      hasToken: boolean;
      enabled: boolean;
    };
    expect(hostBody).toMatchObject({
      kind: 'antigravity-subscription',
      label: 'Mac Studio Keyring',
      hasToken: false,
      enabled: true,
    });

    const tokenSecret = `AIzaSyA${'x'.repeat(28)}`;
    const createdToken = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/antigravity-subscriptions`,
      { label: 'Fallback API Key', token: tokenSecret },
    );
    expect(createdToken.status).toBe(201);
    const tokenBody = (await createdToken.json()) as {
      id: string;
      hasToken: boolean;
      enabled: boolean;
    };
    expect(tokenBody).toMatchObject({ hasToken: true, enabled: false });

    const listed = await req(s.app, 'GET', `/api/teams/${s.team.id}/antigravity-subscriptions`);
    expect(listed.status).toBe(200);
    const rawText = await listed.text();
    expect(rawText).not.toContain(tokenSecret);
    const rows = JSON.parse(rawText) as Array<{ id: string; hasToken: boolean }>;
    expect(rows).toHaveLength(2);

    const renamed = await req(
      s.app,
      'PATCH',
      `/api/teams/${s.team.id}/antigravity-subscriptions/${hostBody.id}`,
      { label: 'Workstation Keyring' },
    );
    expect(renamed.status).toBe(200);
    expect((await renamed.json()) as { label: string }).toMatchObject({
      label: 'Workstation Keyring',
    });

    const badRename = await req(
      s.app,
      'PATCH',
      `/api/teams/${s.team.id}/antigravity-subscriptions/${tokenBody.id}`,
      { label: `bad-${tokenSecret}` },
    );
    expect(badRename.status).toBe(400);
  });

  test('a step cannot fall back to host login if its subscription binding is absent, missing or expired', async () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());
    const path = `/api/teams/${s.team.id}/antigravity-subscriptions`;
    const host = await req(s.app, 'POST', path, { label: 'Intentional host login' });
    const { id: hostId } = (await host.json()) as { id: string };
    const expired = await req(s.app, 'POST', path, {
      label: 'Expired key',
      token: `AIzaSyA${'e'.repeat(28)}`,
      expiresAt: Date.now() - 1000,
    });
    const { id: expiredId } = (await expired.json()) as { id: string };
    const open = (id?: string | null) =>
      openAntigravitySubscription({ db: s.db, box: s.secretBox }, s.team.id, 'antigravity', id);
    expect(open(hostId)).toBeUndefined();
    for (const id of [undefined, null, 'missing-bound-account', expiredId]) {
      expect(() => open(id)).toThrow(expect.objectContaining({ status: 409 }));
    }
  });

  test('verifies host-login connection via live probe on the bound Runner', async () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());

    const machineId = insertMachine(s, {
      name: 'agy-mac',
      capabilities: {
        mcpServers: [],
        skills: [],
        antigravity: {
          installed: true,
          version: '1.5.10',
          authenticated: true,
          source: 'local',
          models: [{ id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' }],
        },
      },
    });
    expect(machineId).toBeDefined();
    const verifier = attachLiveVerifier(s, machineId, () => ({
      installed: true,
      authenticated: true,
      version: '1.5.10',
      source: 'local',
      models: [{ id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' }],
      durationMs: 240,
    }));
    disposables.push(verifier.release);

    const sources = getModelSources({ db: s.db, box: s.secretBox }, s.team.id).sources;
    expect(sources).toContainEqual({
      runtime: 'antigravity',
      installed: true,
      hostname: 'agy-mac',
      machineId,
      models: [{ id: 'gemini-4-carbon', name: 'Gemini 4 Carbon', slot: 'builtin' }],
    });

    const created = await req(s.app, 'POST', `/api/teams/${s.team.id}/antigravity-subscriptions`, {
      label: 'Local Keyring',
    });
    const sub = (await created.json()) as { id: string };

    const okVerify = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/antigravity-subscriptions/${sub.id}/verify`,
    );
    expect(okVerify.status).toBe(200);
    expect(await okVerify.json()).toMatchObject({
      ok: true,
      runnerName: 'agy-mac',
      check: { command: 'agy acp · agy-mac', durationMs: expect.any(Number) },
    });
    expect(verifier.checkIds).toHaveLength(1);

    const createdSecond = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/antigravity-subscriptions`,
      { label: 'Second Host Keyring' },
    );
    const second = (await createdSecond.json()) as { id: string };

    const switched = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/antigravity-subscriptions/${second.id}/enable`,
    );
    expect(switched.status).toBe(200);
    expect(verifier.checkIds).toHaveLength(2);
    const dbRows = s.db.select().from(antigravitySubscription).all();
    expect(dbRows.find((r) => r.id === sub.id)?.enabledAt).toBeNull();
    expect(dbRows.find((r) => r.id === second.id)?.enabledAt).not.toBeNull();
  });

  test('never reports pass without running a live check on the named Runner', async () => {
    const s = bootServer({
      githubFetch: async () => new Response('[]'),
      antigravityVerifyTimeoutMs: 50,
    });
    disposables.push(() => s.dispose());
    const runnerId = insertMachine(s, {
      name: 'xmonsMac',
      capabilities: {
        mcpServers: [],
        skills: [],
        antigravity: {
          installed: true,
          authenticated: true,
          models: [{ id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' }],
        },
      },
    });
    const path = `/api/teams/${s.team.id}/antigravity-subscriptions`;
    const created = await req(s.app, 'POST', path, { label: 'Mac', runnerId });
    const sub = (await created.json()) as { id: string };

    const disconnected = await req(s.app, 'POST', `${path}/${sub.id}/verify`);
    expect(disconnected.status).toBe(200);
    expect(await disconnected.json()).toMatchObject({
      ok: false,
      reason: 'unavailable',
      runnerName: 'xmonsMac',
      check: { ok: false, reason: 'unavailable', command: 'agy acp · xmonsMac' },
    });

    const createdSilent = await req(s.app, 'POST', path, { label: 'Silent Mac', runnerId });
    const silentSub = (await createdSilent.json()) as { id: string };
    const silent = attachLiveVerifier(s, runnerId, () => null);
    disposables.push(silent.release);

    const timedOut = await req(s.app, 'POST', `${path}/${silentSub.id}/verify`);
    expect(timedOut.status).toBe(200);
    expect(await timedOut.json()).toMatchObject({
      ok: false,
      reason: 'timeout',
      runnerName: 'xmonsMac',
      check: { ok: false, reason: 'timeout', command: 'agy acp · xmonsMac' },
    });
    expect(silent.checkIds).toHaveLength(1);
  });

  test('daemon-reported timeout and transient probe error preserve stored login and models', async () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());
    const runnerId = insertMachine(s, {
      name: 'xmonsMac',
      capabilities: {
        mcpServers: [],
        skills: [],
        antigravity: {
          installed: true,
          authenticated: true,
          version: '1.5.15',
          models: [{ id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' }],
        },
      },
    });
    let replyMode: 'timeout' | 'error' = 'timeout';
    const probe = attachLiveVerifier(s, runnerId, () =>
      replyMode === 'timeout'
        ? {
            installed: true,
            authenticated: false,
            timedOut: true,
            durationMs: 35_000,
          }
        : {
            installed: true,
            authenticated: false,
            error: 'antigravity probe exited (1)',
            durationMs: 410,
          },
    );
    disposables.push(probe.release);

    const path = `/api/teams/${s.team.id}/antigravity-subscriptions`;
    const created = await req(s.app, 'POST', path, { label: 'Mac', runnerId });
    const sub = (await created.json()) as { id: string };

    const res = await req(s.app, 'POST', `${path}/${sub.id}/verify`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: false,
      reason: 'timeout',
      runnerName: 'xmonsMac',
      check: { ok: false, reason: 'timeout', command: 'agy acp · xmonsMac', durationMs: 35_000 },
    });
    expect(
      s.db.select().from(machineTable).where(eq(machineTable.id, runnerId)).get()?.capabilities
        ?.antigravity,
    ).toMatchObject({
      installed: true,
      authenticated: true,
      models: [{ id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' }],
    });

    replyMode = 'error';
    const created2 = await req(s.app, 'POST', path, { label: 'Mac 2', runnerId });
    const sub2 = (await created2.json()) as { id: string };
    const errRes = await req(s.app, 'POST', `${path}/${sub2.id}/verify`);
    expect(errRes.status).toBe(200);
    expect(await errRes.json()).toMatchObject({
      ok: false,
      reason: 'failed',
      runnerName: 'xmonsMac',
      check: { ok: false, reason: 'failed', command: 'agy acp · xmonsMac', durationMs: 410 },
    });
    expect(
      s.db.select().from(machineTable).where(eq(machineTable.id, runnerId)).get()?.capabilities
        ?.antigravity,
    ).toMatchObject({
      installed: true,
      authenticated: true,
      models: [{ id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' }],
    });
  });

  test('binding a Runner via PATCH clears a stale verify rate-limit window so Verify succeeds immediately', async () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());
    insertMachine(s, {
      name: 'Ians-Mac-mini',
      capabilities: {
        mcpServers: [],
        skills: [],
        antigravity: { installed: true, authenticated: false, models: [] },
      },
    });
    const macId = insertMachine(s, {
      name: 'xmonsMac',
      capabilities: {
        mcpServers: [],
        skills: [],
        antigravity: {
          installed: true,
          authenticated: true,
          models: [{ id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' }],
        },
      },
    });
    const probe = attachLiveVerifier(s, macId, () => ({
      installed: true,
      authenticated: true,
      version: '1.5.15',
      source: 'managed',
      models: [{ id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' }],
      durationMs: 420,
    }));
    disposables.push(probe.release);

    s.db
      .insert(antigravitySubscription)
      .values({ id: 'legacy-unbound', label: 'Antigravity 订阅', teamId: s.team.id, createdAt: 1 })
      .run();

    const path = `/api/teams/${s.team.id}/antigravity-subscriptions`;
    const first = await req(s.app, 'POST', `${path}/legacy-unbound/verify`);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ ok: false, reason: 'unavailable' });

    const bound = await req(s.app, 'PATCH', `${path}/legacy-unbound`, { runnerId: macId });
    expect(bound.status).toBe(200);

    const second = await req(s.app, 'POST', `${path}/legacy-unbound/verify`);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({
      ok: true,
      runnerName: 'xmonsMac',
      check: { command: 'agy acp · xmonsMac' },
    });
  });

  test('requestAntigravityVerify settles cleanly without TDZ error when pushAntigravityVerify fails synchronously', async () => {
    const machineHub = new MachineWakeHub();
    const release = machineHub.subscribeMachine('team-1', 'm-sync-fail', () => {
      throw new Error('stream write failed');
    });
    try {
      const outcome = await requestAntigravityVerify({ machineHub }, 'm-sync-fail');
      expect(outcome).toEqual({ ok: false, reason: 'unavailable' });
    } finally {
      release();
    }
  });

  test('names which runner is logged in or not, probes only the bound Runner, and rejects cross-runner replies', async () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());
    const macId = insertMachine(s, {
      name: 'xmonsMac',
      capabilities: {
        mcpServers: [],
        skills: [],
        antigravity: {
          installed: true,
          authenticated: true,
          models: [{ id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' }],
        },
      },
    });
    const miniId = insertMachine(s, {
      name: 'Ians-Mac-mini',
      capabilities: {
        mcpServers: [],
        skills: [],
        antigravity: {
          installed: true,
          authenticated: false,
          models: [],
        },
      },
    });
    s.db.update(team).set({ defaultMachineId: miniId }).where(eq(team.id, s.team.id)).run();

    const path = `/api/teams/${s.team.id}/antigravity-subscriptions`;
    const createdMac = await req(s.app, 'POST', path, { label: 'Mac Sub', runnerId: macId });
    const macSub = (await createdMac.json()) as { id: string };
    const createdMini = await req(s.app, 'POST', path, { label: 'Mini Sub', runnerId: miniId });
    const miniSub = (await createdMini.json()) as { id: string };

    const listed = (await (await req(s.app, 'GET', path)).json()) as Array<Record<string, unknown>>;
    expect(listed.find((row) => row.id === macSub.id)).toMatchObject({
      runnerId: macId,
      runnerName: 'xmonsMac',
      runnerLogin: 'ok',
      runnerLogins: [
        { runnerId: miniId, name: 'Ians-Mac-mini', online: true, status: 'missing_local_login' },
        { runnerId: macId, name: 'xmonsMac', online: true, status: 'ok' },
      ],
    });
    expect(listed.find((row) => row.id === miniSub.id)).toMatchObject({
      runnerId: miniId,
      runnerName: 'Ians-Mac-mini',
      runnerLogin: 'missing_local_login',
      runnerLogins: [
        { runnerId: miniId, name: 'Ians-Mac-mini', online: true, status: 'missing_local_login' },
        { runnerId: macId, name: 'xmonsMac', online: true, status: 'ok' },
      ],
    });

    const miniProbe = attachLiveVerifier(s, miniId, () => ({
      installed: true,
      authenticated: false,
      version: '1.5.10',
      source: 'managed',
      models: [],
      durationMs: 185,
    }));
    disposables.push(miniProbe.release);

    let spoofStatus = 0;
    const macProbe = attachLiveVerifier(s, macId, async (checkId) => {
      const spoofed = await s.app.request('/api/machine/antigravity/verify', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${miniProbe.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          checkId,
          installed: true,
          authenticated: false,
          durationMs: 10,
        }),
      });
      spoofStatus = spoofed.status;
      return {
        installed: true,
        authenticated: true,
        version: '1.5.10',
        source: 'managed',
        models: [
          { id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' },
          { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' },
        ],
        durationMs: 420,
      };
    });
    disposables.push(macProbe.release);

    const macVerified = await req(s.app, 'POST', `${path}/${macSub.id}/verify`);
    expect(macVerified.status).toBe(200);
    const macResult = (await macVerified.json()) as {
      ok: boolean;
      runnerName?: string;
      check?: { command: string; durationMs: number };
    };
    expect(macResult).toMatchObject({
      ok: true,
      runnerName: 'xmonsMac',
      check: { command: 'agy acp · xmonsMac' },
    });
    expect(macResult.check?.durationMs).toBeGreaterThanOrEqual(420);
    expect(spoofStatus).toBe(404);
    expect(macProbe.checkIds).toHaveLength(1);
    expect(miniProbe.checkIds).toHaveLength(0);

    s.db
      .update(machineTable)
      .set({
        capabilities: {
          mcpServers: [],
          skills: [],
          antigravity: { installed: true, authenticated: true, models: [] },
        },
      })
      .where(eq(machineTable.id, miniId))
      .run();

    const miniVerified = await req(s.app, 'POST', `${path}/${miniSub.id}/verify`);
    expect(miniVerified.status).toBe(200);
    const miniResult = (await miniVerified.json()) as {
      ok: boolean;
      reason?: string;
      runnerName?: string;
      check?: { command: string; durationMs: number };
    };
    expect(miniResult).toMatchObject({
      ok: false,
      reason: 'missing_local_login',
      runnerName: 'Ians-Mac-mini',
      check: { command: 'agy acp · Ians-Mac-mini' },
    });
    expect(miniResult.check?.durationMs).toBeGreaterThanOrEqual(185);
    expect(miniProbe.checkIds).toHaveLength(1);
    expect(
      s.db.select().from(machineTable).where(eq(machineTable.id, miniId)).get()?.capabilities
        ?.antigravity?.authenticated,
    ).toBe(false);
  });

  test.each([
    ['signed out', true, false, 'missing_local_login', 'auth'],
    ['offline', false, true, 'unavailable', 'not-found'],
    ['signed in', true, true, null, null],
  ] as const)(
    'keeps verification and models on the bound Runner when it is %s',
    async (_state, online, authenticated, reason, failure) => {
      const s = bootServer({ githubFetch: async () => new Response('[]') });
      disposables.push(() => s.dispose());
      const ownModel = { id: 'bound-model', name: 'Bound model' };
      const otherModel = { id: 'other-model', name: 'Other model' };
      const runnerId = insertMachine(s, {
        name: 'bound',
        capabilities: {
          mcpServers: [],
          skills: [],
          antigravity: { installed: true, authenticated: true, models: [ownModel] },
        },
      });
      const otherId = insertMachine(s, {
        name: 'other',
        capabilities: {
          mcpServers: [],
          skills: [],
          antigravity: { installed: true, authenticated: true, models: [otherModel] },
        },
      });
      const path = `/api/teams/${s.team.id}/antigravity-subscriptions`;
      const created = await req(s.app, 'POST', path, { label: 'Bound', runnerId });
      expect(created.status).toBe(201);
      const sub = (await created.json()) as { id: string };
      s.db
        .update(machineTable)
        .set({
          online,
          capabilities: {
            mcpServers: [],
            skills: [],
            antigravity: { installed: true, authenticated, models: [ownModel] },
          },
        })
        .where(eq(machineTable.id, runnerId))
        .run();
      if (online) {
        const boundVerifier = attachLiveVerifier(s, runnerId, () => ({
          installed: true,
          authenticated,
          models: [ownModel],
          durationMs: 120,
        }));
        disposables.push(boundVerifier.release);
      }
      const otherVerifier = attachLiveVerifier(s, otherId, () => ({
        installed: true,
        authenticated: true,
        models: [otherModel],
        durationMs: 120,
      }));
      disposables.push(otherVerifier.release);

      const verified = await req(s.app, 'POST', `${path}/${sub.id}/verify`);
      expect(verified.status).toBe(200);
      expect
        .soft(await verified.json())
        .toMatchObject(
          reason === null
            ? { ok: true, runnerName: 'bound' }
            : { ok: false, reason, runnerName: 'bound' },
        );
      expect(otherVerifier.checkIds).toHaveLength(0);

      const catalog = await req(s.app, 'POST', `${path}/${sub.id}/upstream-models`);
      expect(catalog.status).toBe(200);
      expect
        .soft(await catalog.json())
        .toMatchObject(
          failure === null
            ? { status: 'ok', models: [ownModel] }
            : { status: 'fallback', failure, models: expect.not.arrayContaining([otherModel]) },
        );

      const list = await req(s.app, 'GET', path);
      expect.soft(await list.json()).toMatchObject([
        {
          id: sub.id,
          runnerId,
          runnerLogin: reason ?? 'ok',
          models: [],
          runnerModels: reason === null ? [ownModel] : [],
          ...(!online ? { runnerOffline: true } : {}),
        },
      ]);
      const sources = getModelSources({ db: s.db, box: s.secretBox }, s.team.id).sources.filter(
        (source) => source.runtime === 'antigravity',
      );
      expect(sources).toEqual(
        reason === null
          ? [
              expect.objectContaining({
                machineId: runnerId,
                models: [{ ...ownModel, slot: 'builtin' }],
              }),
            ]
          : [],
      );
    },
  );

  test('does not guess a Runner for a legacy subscription in a multi-Runner team', async () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());
    const path = `/api/teams/${s.team.id}/antigravity-subscriptions`;
    const capabilities = (accountId: string) => ({
      mcpServers: [],
      skills: [],
      antigravity: {
        installed: true,
        authenticated: true,
        models: [{ id: accountId, name: accountId }],
      },
    });
    insertMachine(s, { name: 'unexpected', capabilities: capabilities('unexpected') });
    const matchingRunner = insertMachine(s, {
      name: 'original',
      capabilities: capabilities('original'),
    });
    s.db
      .insert(antigravitySubscription)
      .values({
        id: 'unknown',
        label: 'Unknown',
        teamId: s.team.id,
        createdAt: 2,
      })
      .run();

    const ambiguous = await req(s.app, 'POST', `${path}/unknown/verify`);
    expect(await ambiguous.json()).toMatchObject({ ok: false, reason: 'unavailable' });
    expect(await (await req(s.app, 'GET', path)).json()).toMatchObject([
      { id: 'unknown', runnerId: null, runnerLogin: 'unavailable' },
    ]);
    const rebound = await req(s.app, 'PATCH', `${path}/unknown`, { runnerId: matchingRunner });
    expect(await rebound.json()).toMatchObject({ runnerId: matchingRunner });
    const catalog = await req(s.app, 'POST', `${path}/unknown/upstream-models`);
    expect(await catalog.json()).toEqual({
      status: 'ok',
      models: [{ id: 'original', name: 'original' }],
    });
    const ignored = await req(s.app, 'PATCH', `${path}/unknown`, {
      runnerId: 'machine-unexpected',
    });
    expect(await ignored.json()).toMatchObject({ runnerId: matchingRunner });
  });

  test('a bound Runner signing out refreshes status without an online transition', async () => {
    const s = bootServer();
    disposables.push(() => s.dispose());
    const capabilities = {
      mcpServers: [],
      skills: [],
      antigravity: { installed: true, authenticated: true },
    };
    const runnerId = insertMachine(s, { name: 'bound', capabilities });
    const path = `/api/teams/${s.team.id}/antigravity-subscriptions`;
    expect((await req(s.app, 'POST', path, { label: 'Bound' })).status).toBe(201);
    const events: object[] = [];
    const unsubscribe = s.hub.subscribe(s.team.id, {
      nextSeq: () => 1,
      send: async (event) => {
        events.push(event);
      },
    });
    disposables.push(unsubscribe);
    const deps = {
      ...s.svc,
      box: s.secretBox,
      reposDir: s.reposDir,
      attachmentsDir: s.attachmentsDir,
      skillsDir: s.skillsDir,
    };
    markPresence(deps, runnerId, { capabilities });
    expect(events).toEqual([]);
    markPresence(deps, runnerId, {
      capabilities: { ...capabilities, antigravity: { installed: true, authenticated: false } },
    });
    expect(events).toEqual([{ type: 'machine_presence', machineId: runnerId, online: true }]);
    expect(await (await req(s.app, 'GET', path)).json()).toMatchObject([
      { runnerId, runnerLogin: 'missing_local_login' },
    ]);
  });

  test('refuses disabling or deleting an account with running tasks and lists step history', async () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());
    const machineId = insertMachine(s, {
      name: 'agy-box',
      capabilities: {
        mcpServers: [],
        skills: [],
        antigravity: {
          installed: true,
          authenticated: false,
          models: DEFAULT_ANTIGRAVITY_MODELS.map(({ id, name }) => ({ id, name })),
        },
      },
    });
    seedRoute(s, 'session', { provider: 'antigravity', modelId: 'gemini-4-carbon', machineId });
    const created = await req(s.app, 'POST', `/api/teams/${s.team.id}/antigravity-subscriptions`, {
      label: 'Token Key',
      token: `AIzaSyA${'z'.repeat(28)}`,
    });
    const sub = (await created.json()) as { id: string };

    const projectId = await postProject(s.app, 'ag-proj');
    const todo = (await (
      await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
        title: 'Task',
        spec: 'Spec',
      })
    ).json()) as { id: string };
    s.db
      .insert(buildTable)
      .values({
        id: 'b-ag',
        todoId: todo.id,
        withPlan: false,
        planDocId: null,
        triggerSource: 'user',
        createdAt: 10,
      })
      .run();
    s.db
      .insert(stepTable)
      .values({
        id: 's-ag',
        buildId: 'b-ag',
        kind: 'build',
        status: 'claimed',
        claimedAt: 11,
        antigravitySubscriptionId: sub.id,
        createdAt: 11,
      })
      .run();

    const conflictDisable = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/antigravity-subscriptions/${sub.id}/disable`,
    );
    expect(conflictDisable.status).toBe(409);

    const path = `/api/teams/${s.team.id}/antigravity-subscriptions`;
    s.db
      .update(antigravitySubscription)
      .set({ expiresAt: Date.now() - 1000 })
      .where(eq(antigravitySubscription.id, sub.id))
      .run();
    const replacement = await req(s.app, 'POST', path, { label: 'Replacement' });
    expect(replacement.status).toBe(201);
    expect(await replacement.json()).toMatchObject({ enabled: false });
    expect(await (await req(s.app, 'GET', path)).json()).toContainEqual(
      expect.objectContaining({ id: sub.id, enabled: true }),
    );

    s.db
      .update(antigravitySubscription)
      .set({ enabledAt: null })
      .where(eq(antigravitySubscription.id, sub.id))
      .run();
    expect((await req(s.app, 'DELETE', `${path}/${sub.id}`)).status).toBe(409);

    const stepsRes = await req(
      s.app,
      'GET',
      `/api/teams/${s.team.id}/antigravity-subscriptions/${sub.id}/steps`,
    );
    expect(stepsRes.status).toBe(200);
    expect(((await stepsRes.json()) as { steps: Array<{ stepId: string }> }).steps[0]?.stepId).toBe(
      's-ag',
    );

    s.db
      .update(stepTable)
      .set({ status: 'done', finishedAt: 20 })
      .where(eq(stepTable.id, 's-ag'))
      .run();
    const disabled = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/antigravity-subscriptions/${sub.id}/disable`,
    );
    expect(disabled.status).toBe(200);
    const removed = await req(
      s.app,
      'DELETE',
      `/api/teams/${s.team.id}/antigravity-subscriptions/${sub.id}`,
    );
    expect(removed.status).toBe(204);
  });
});

describe('antigravity token verification via Google API', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('verifies a token by calling the Google models endpoint with the key header', async () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());
    const token = `AIzaSyA${'t'.repeat(28)}`;
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const created = await req(s.app, 'POST', `/api/teams/${s.team.id}/antigravity-subscriptions`, {
      label: 'API Key',
      token,
    });
    const sub = (await created.json()) as { id: string };
    const res = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/antigravity-subscriptions/${sub.id}/verify`,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models');
    expect(url).not.toContain(token);
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe(token);
  });

  test('maps Google failures to verify reasons', async () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());
    const fetchMock = vi.fn(async () => new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const created = await req(s.app, 'POST', `/api/teams/${s.team.id}/antigravity-subscriptions`, {
      label: 'Bad Key',
      token: `AIzaSyA${'u'.repeat(28)}`,
    });
    const sub = (await created.json()) as { id: string };
    const res = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/antigravity-subscriptions/${sub.id}/verify`,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: false, reason: 'auth' });
  });

  test('treats a network failure as unavailable', async () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    const created = await req(s.app, 'POST', `/api/teams/${s.team.id}/antigravity-subscriptions`, {
      label: 'Offline Key',
      token: `AIzaSyA${'v'.repeat(28)}`,
    });
    const sub = (await created.json()) as { id: string };
    const res = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/antigravity-subscriptions/${sub.id}/verify`,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: false, reason: 'unavailable' });
  });

  test('a key that no longer decrypts reads as a failed check, not a server error', async () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());
    const path = `/api/teams/${s.team.id}/antigravity-subscriptions`;
    const created = await req(s.app, 'POST', path, {
      label: 'Tampered Key',
      token: `AIzaSyA${'t'.repeat(28)}`,
    });
    const sub = (await created.json()) as { id: string };
    s.db
      .update(antigravitySubscription)
      .set({ tokenCipher: 'v1:tampered' })
      .where(eq(antigravitySubscription.id, sub.id))
      .run();
    const res = await req(s.app, 'POST', `${path}/${sub.id}/verify`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: false, reason: 'failed' });
    const list = (await (await req(s.app, 'GET', path)).json()) as { lastCheck: unknown }[];
    expect(list[0]?.lastCheck).toMatchObject({ ok: false, reason: 'failed' });
  });
});

describe('antigravity upstream models', () => {
  async function enrollProbeRunner(
    s: ReturnType<typeof bootServer>,
    name: string,
    authenticated = true,
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
          antigravitySubscriptionModels: true,
          antigravity: {
            installed: true,
            authenticated,
            models: [{ id: 'gemini-3.8-flash', name: 'Runner login' }],
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

  function probeRequest(
    s: ReturnType<typeof bootServer>,
    requestId: string,
    machineToken: string,
    body: unknown,
  ) {
    return s.app.request(`/api/machine/antigravity/model-probes/${requestId}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${machineToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  test.each([
    'expired',
    'ambiguous-default',
    'team-default-without-provider-route',
    'sole-runner-without-provider-route',
    'wrong-runner',
    'retired',
    'capability',
  ] as const)(
    'returns fallback without dispatching to a %s runner or subscription',
    async (refusal) => {
      const s = bootServer({ githubFetch: async () => new Response('[]') });
      disposables.push(() => s.dispose());
      const runner = await enrollProbeRunner(s, 'refusal-runner');
      const path = `/api/teams/${s.team.id}/antigravity-subscriptions`;
      const created = await req(s.app, 'POST', path, {
        label: 'Refusal',
        token: `AIzaSyA${'r'.repeat(28)}`,
        ...(refusal === 'expired' ? { expiresAt: Date.now() - 1_000 } : {}),
      });
      const { id } = (await created.json()) as { id: string };
      const assigned =
        refusal === 'wrong-runner' ? await enrollProbeRunner(s, 'assigned-offline-stream') : runner;
      if (refusal === 'ambiguous-default') {
        await enrollProbeRunner(s, 'another-eligible-runner');
        s.db.update(team).set({ defaultMachineId: null }).where(eq(team.id, s.team.id)).run();
      } else if (refusal === 'team-default-without-provider-route') {
        await enrollProbeRunner(s, 'another-eligible-runner');
        s.db
          .update(team)
          .set({ defaultMachineId: runner.machineId })
          .where(eq(team.id, s.team.id))
          .run();
        seedRoute(s, 'session', { provider: 'devin', machineId: runner.machineId });
      } else if (refusal === 'sole-runner-without-provider-route') {
        s.db.update(team).set({ defaultMachineId: null }).where(eq(team.id, s.team.id)).run();
      } else {
        seedRoute(s, 'session', {
          provider: 'antigravity',
          modelId: 'gemini-4-carbon',
          machineId: assigned.machineId,
          ...(refusal === 'capability' ? { requiredCapabilities: { os: 'linux' } } : {}),
        });
      }
      if (refusal === 'retired') {
        s.db
          .update(machineTable)
          .set({ retiredAt: 1 })
          .where(eq(machineTable.id, runner.machineId))
          .run();
      }
      const controller = new AbortController();
      const events: MachineStreamEvent[] = [];
      disposables.push(
        s.machineHub.subscribeMachine(s.team.id, runner.machineId, (event) => {
          if (event.type === 'antigravity.models') {
            events.push(event);
            controller.abort();
          }
        }),
      );
      const response = await s.app.request(`${path}/${id}/upstream-models`, {
        method: 'POST',
        signal: controller.signal,
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        status: 'fallback',
        models: DEFAULT_ANTIGRAVITY_MODELS.map(({ id, name }) => ({ id, name })),
      });
      expect(events).toEqual([]);
    },
  );

  test('paired-device diagnostics return fallback without opening the subscription credential', async () => {
    const ownerToken = 'owner-test-0123456789abcdef';
    const s = bootServer({ authToken: ownerToken });
    disposables.push(() => s.dispose());
    const path = `/api/teams/${s.team.id}/antigravity-subscriptions`;
    const created = await s.app.request(path, {
      method: 'POST',
      headers: { authorization: `Bearer ${ownerToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'Owner account', token: `AIzaSyA${'o'.repeat(28)}` }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    s.db
      .insert(pairedDevice)
      .values({
        id: 'catalog-phone',
        teamId: s.team.id,
        name: 'Phone',
        tokenHash: 'synthetic',
        masked: 'phone',
        createdAt: 1,
      })
      .run();
    const session = issueBrowserSession(s.db, 'device', 'catalog-phone');
    const open = vi.spyOn(s.secretBox, 'open');
    try {
      const response = await s.app.request(`${path}/${id}/upstream-models`, {
        method: 'POST',
        headers: { cookie: `cairn_auth=${session.token}`, 'sec-fetch-site': 'same-origin' },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: 'fallback' });
      expect(open).not.toHaveBeenCalled();
    } finally {
      open.mockRestore();
    }
  });

  test.each(['pinned', 'unpinned'] as const)(
    'dispatches each account credential only to its assigned connection with %s routing',
    async (routing) => {
      const s = bootServer({ githubFetch: async () => new Response('[]') });
      disposables.push(() => s.dispose());
      const runner = await enrollProbeRunner(s, 'probe-runner');
      const otherRunner = await enrollProbeRunner(s, 'unassigned-runner');
      if (routing !== 'pinned') {
        s.db
          .update(team)
          .set({ defaultMachineId: runner.machineId })
          .where(eq(team.id, s.team.id))
          .run();
      }
      seedRoute(s, 'session', {
        provider: 'antigravity',
        modelId: 'gemini-4-carbon',
        machineId: routing === 'pinned' ? runner.machineId : null,
      });
      let event: ReturnType<
        typeof deferred<Extract<MachineStreamEvent, { type: 'antigravity.models' }>>
      >;
      disposables.push(
        s.machineHub.subscribeMachine(s.team.id, runner.machineId, (message) => {
          if (message.type === 'antigravity.models') event.resolve(message);
        }),
      );
      const connectionId = s.machineHub.connectionId(runner.machineId);
      expect(connectionId).toBeDefined();
      const path = `/api/teams/${s.team.id}/antigravity-subscriptions`;
      for (const [label, keyChar, model, expectedName] of [
        ['Paid A', 'a', { id: 'claude-paid', name: 'Claude Paid' }, 'Claude Paid'],
        ['Paid B', 'b', { id: 'gpt-paid', name: 'GPT Paid' }, 'GPT Paid'],
        ['Gemini', 'c', { id: 'gemini-paid', name: 'Gemini Paid' }, 'Gemini Paid'],
        ['Other', 'f', { id: 'other-model', name: 'Other Model' }, 'Other Model'],
        ['Long name', 'g', { id: 'gpt-long', name: 'X'.repeat(256) }, 'X'.repeat(256)],
      ] as const) {
        event = deferred();
        const token = `AIzaSyA${keyChar.repeat(28)}`;
        const created = await req(s.app, 'POST', path, { label, token });
        expect(created.status).toBe(201);
        const { id, enabled } = (await created.json()) as { id: string; enabled: boolean };
        expect(enabled).toBe(keyChar === 'a');
        const pending = req(s.app, 'POST', `${path}/${id}/upstream-models`);
        const dispatch = await Promise.race([event.promise, pending.then(() => null)]);
        expect(dispatch).not.toBeNull();
        if (dispatch === null) throw new Error('No probe dispatched');
        expect(Object.keys(dispatch).sort()).toEqual(['requestId', 'type']);
        const { requestId } = dispatch;
        const claim = { phase: 'claim', connectionId };
        const result = {
          phase: 'result',
          connectionId,
          result: { status: 'ok', models: [model, model, { id: 'echo', name: token }] },
        };
        expect((await probeRequest(s, requestId, otherRunner.token, claim)).status).toBe(404);
        const stale = await probeRequest(s, requestId, runner.token, {
          ...claim,
          connectionId: 'stale',
        });
        expect(stale.status).toBe(404);
        expect((await probeRequest(s, requestId, runner.token, result)).status).toBe(404);
        const credential = await probeRequest(s, requestId, runner.token, claim);
        expect(credential.status).toBe(200);
        expect(credential.headers.get('cache-control')).toBe('no-store');
        expect(await credential.json()).toEqual({ token });
        expect((await probeRequest(s, requestId, runner.token, claim)).status).toBe(404);
        expect((await probeRequest(s, requestId, runner.token, result)).status).toBe(200);
        expect((await probeRequest(s, requestId, runner.token, result)).status).toBe(404);
        const response = await pending;
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          status: 'ok',
          models: [{ ...model, name: expectedName }],
        });
      }
    },
  );

  test.each(['signed-out host account', 'no active account'] as const)(
    'uses the selected API key with %s',
    async (active) => {
      const s = bootServer();
      const runner = await enrollProbeRunner(s, 'signed-out-runner', false);
      seedRoute(s, 'session', {
        provider: 'antigravity',
        modelId: 'gemini-4-carbon',
        machineId: runner.machineId,
      });
      const path = `/api/teams/${s.team.id}/antigravity-subscriptions`;
      const hostResponse = await req(s.app, 'POST', path, { label: 'Host account' });
      expect(hostResponse.status).toBe(201);
      const host = (await hostResponse.json()) as { id: string; enabled: boolean };
      const token = `AIzaSyA${'k'.repeat(28)}`;
      const selectedResponse = await req(s.app, 'POST', path, { label: 'Selected API key', token });
      expect(selectedResponse.status).toBe(201);
      const selected = (await selectedResponse.json()) as { id: string; enabled: boolean };
      expect(host.enabled).toBe(true);
      expect(selected.enabled).toBe(false);
      const disableHost = async () => {
        expect((await req(s.app, 'POST', `${path}/${host.id}/disable`)).status).toBe(200);
      };
      if (active === 'no active account') await disableHost();

      const dispatched = deferred<string>();
      disposables.push(
        s.machineHub.subscribeMachine(s.team.id, runner.machineId, (event) => {
          if (event.type === 'antigravity.models') dispatched.resolve(event.requestId);
        }),
      );
      const pending = req(s.app, 'POST', `${path}/${selected.id}/upstream-models`);
      const requestId = await Promise.race([dispatched.promise, pending.then(() => null)]);
      expect(
        requestId,
        'The selected API key should not need another account’s login',
      ).not.toBeNull();
      if (requestId === null) throw new Error('No probe dispatched');
      const connectionId = s.machineHub.connectionId(runner.machineId);
      const claim = await probeRequest(s, requestId, runner.token, {
        phase: 'claim',
        connectionId,
      });
      expect(claim.status).toBe(200);
      expect(await claim.json()).toEqual({ token });
      if (active === 'signed-out host account') await disableHost();
      const models = [{ id: 'fixture-model', name: 'Selected model' }];
      const result = await probeRequest(s, requestId, runner.token, {
        phase: 'result',
        connectionId,
        result: { status: 'ok', models },
      });
      expect(result.status).toBe(200);
      expect(await (await pending).json()).toEqual({ status: 'ok', models });
    },
  );

  test.each([1, 2])(
    'overlapping lookups return each account’s own catalog with %i Runner(s)',
    async (count) => {
      const s = bootServer();
      const path = `/api/teams/${s.team.id}/antigravity-subscriptions`;
      const createAccount = async (suffix: string) => {
        const token = `AIzaSyA${suffix.repeat(29)}`;
        const response = await req(s.app, 'POST', path, { label: `Account ${suffix}`, token });
        expect(response.status).toBe(201);
        const { id } = (await response.json()) as { id: string };
        return { id, token, models: [{ id: `fixture-${suffix}`, name: `Model ${suffix}` }] };
      };
      const first = await createAccount('a');
      const second = await createAccount('b');
      const runners = [await enrollProbeRunner(s, 'primary')];
      if (count === 2) runners.push(await enrollProbeRunner(s, 'backup'));
      runners.sort((a, b) => (a.machineId < b.machineId ? -1 : 1));
      const events = runners.map(() => [deferred<string>(), deferred<string>()] as const);
      for (const [index, runner] of runners.entries()) {
        seedRoute(s, index === 0 ? 'session' : 'review', {
          provider: 'antigravity',
          modelId: 'gemini-4-carbon',
          machineId: runner.machineId,
        });
        let eventIndex = 0;
        disposables.push(
          s.machineHub.subscribeMachine(s.team.id, runner.machineId, (event) => {
            if (event.type === 'antigravity.models')
              events[index]?.[eventIndex++]?.resolve(event.requestId);
          }),
        );
      }
      const start = (account: typeof first) =>
        req(s.app, 'POST', `${path}/${account.id}/upstream-models`);
      const claim = async (
        runnerIndex: number,
        eventIndex: 0 | 1,
        pending: Promise<Response>,
        token: string,
      ) => {
        const runner = runners[runnerIndex]!;
        const requestId = await Promise.race([
          events[runnerIndex]![eventIndex].promise,
          pending.then(() => null),
        ]);
        expect(requestId, 'The lookup returned without dispatching its probe').not.toBeNull();
        if (requestId === null) throw new Error('No probe dispatched');
        const connectionId = s.machineHub.connectionId(runner.machineId);
        const response = await probeRequest(s, requestId, runner.token, {
          phase: 'claim',
          connectionId,
        });
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ token });
        return async (models: typeof first.models) => {
          const result = await probeRequest(s, requestId, runner.token, {
            phase: 'result',
            connectionId,
            result: { status: 'ok', models },
          });
          expect(result.status).toBe(200);
          expect(await (await pending).json()).toEqual({ status: 'ok', models });
        };
      };
      const finishFirst = await claim(0, 0, start(first), first.token);
      const pendingSecond = start(second);
      if (count === 2) {
        const finishSecond = await claim(1, 0, pendingSecond, second.token);
        await finishSecond(second.models);
        await finishFirst(first.models);
      } else {
        const beforeFirstFinished = await Promise.race([
          events[0]![1].promise.then(() => 'dispatched'),
          pendingSecond.then(() => 'returned'),
          new Promise<string>((resolve) => setImmediate(() => resolve('waiting'))),
        ]);
        expect(beforeFirstFinished).toBe('waiting');
        await finishFirst(first.models);
        const finishSecond = await claim(0, 1, pendingSecond, second.token);
        await finishSecond(second.models);
      }
    },
  );

  test.each(['deleted', 'route-changed', 'runner-retired', 'default-changed'] as const)(
    'rechecks %s authorization before releasing a pending probe credential',
    async (change) => {
      const s = bootServer();
      disposables.push(() => s.dispose());
      const runner = await enrollProbeRunner(s, 'changing-runner');
      const nextDefault =
        change === 'default-changed' ? await enrollProbeRunner(s, 'next-default') : null;
      if (nextDefault !== null) {
        s.db
          .update(team)
          .set({ defaultMachineId: runner.machineId })
          .where(eq(team.id, s.team.id))
          .run();
      }
      const ruleId = seedRoute(s, 'session', {
        provider: 'antigravity',
        modelId: 'gemini-4-carbon',
        machineId: nextDefault === null ? runner.machineId : null,
      });
      const path = `/api/teams/${s.team.id}/antigravity-subscriptions`;
      const created = await req(s.app, 'POST', path, {
        label: 'Changing',
        token: `AIzaSyA${'h'.repeat(28)}`,
      });
      const { id } = (await created.json()) as { id: string };
      const event = deferred<string>();
      const controller = new AbortController();
      disposables.push(
        s.machineHub.subscribeMachine(s.team.id, runner.machineId, (message) => {
          if (message.type === 'antigravity.models') event.resolve(message.requestId);
        }),
      );
      const pending = s.app.request(`${path}/${id}/upstream-models`, {
        method: 'POST',
        signal: controller.signal,
      });
      const requestId = await Promise.race([
        event.promise,
        Promise.resolve(pending).then(() => null),
      ]);
      if (requestId === null) throw new Error('No probe dispatched');
      if (change === 'deleted')
        expect((await req(s.app, 'DELETE', `${path}/${id}`)).status).toBe(204);
      if (change === 'route-changed')
        s.db.update(routingRule).set({ provider: 'devin' }).where(eq(routingRule.id, ruleId)).run();
      if (change === 'runner-retired')
        s.db
          .update(machineTable)
          .set({ retiredAt: 1 })
          .where(eq(machineTable.id, runner.machineId))
          .run();
      if (nextDefault !== null) {
        s.db
          .update(team)
          .set({ defaultMachineId: nextDefault.machineId })
          .where(eq(team.id, s.team.id))
          .run();
      }
      const claim = await probeRequest(s, requestId, runner.token, {
        phase: 'claim',
        connectionId: s.machineHub.connectionId(runner.machineId),
      });
      controller.abort();
      await pending;
      expect(claim.status).toBe(404);
    },
  );

  test.each(['ok', 'failed'] as const)(
    'rejects a Runner %s result if the routing rule changed after claim',
    async (status) => {
      const s = bootServer();
      const runner = await enrollProbeRunner(s, 'revoked-after-claim');
      const ruleId = seedRoute(s, 'session', {
        provider: 'antigravity',
        modelId: 'gemini-4-carbon',
        machineId: runner.machineId,
      });
      const path = `/api/teams/${s.team.id}/antigravity-subscriptions`;
      const token = `AIzaSyA${'j'.repeat(28)}`;
      const created = await req(s.app, 'POST', path, { label: 'Probe account', token });
      const { id } = (await created.json()) as { id: string };
      const dispatched = deferred<string>();
      disposables.push(
        s.machineHub.subscribeMachine(s.team.id, runner.machineId, (message) => {
          if (message.type === 'antigravity.models') dispatched.resolve(message.requestId);
        }),
      );
      const pending = req(s.app, 'POST', `${path}/${id}/upstream-models`);
      const requestId = await Promise.race([dispatched.promise, pending.then(() => null)]);
      if (requestId === null) throw new Error('No probe dispatched');
      const connectionId = s.machineHub.connectionId(runner.machineId);
      const claim = await probeRequest(s, requestId, runner.token, {
        phase: 'claim',
        connectionId,
      });
      expect(await claim.json()).toEqual({ token });
      s.db
        .update(routingRule)
        .set(status === 'ok' ? { modelId: 'gemini-4-argon' } : { provider: 'devin' })
        .where(eq(routingRule.id, ruleId))
        .run();
      const responseBody = {
        phase: 'result',
        connectionId,
        result:
          status === 'ok'
            ? { status, models: [{ id: 'claimed-model', name: 'Claimed model' }] }
            : { status, failure: 'upstream' },
      };
      const result = await probeRequest(s, requestId, runner.token, responseBody);
      expect(result.status).toBe(409);
      expect(await result.json()).toMatchObject({ code: 'probe-authorization-changed' });
      expect((await probeRequest(s, requestId, runner.token, responseBody)).status).toBe(404);
      expect(await (await pending).json()).toMatchObject({ status: 'fallback', failure: 'auth' });
    },
  );

  test('disconnecting a probe returns the labelled fallback and invalidates the request', async () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    const runner = await enrollProbeRunner(s, 'disconnecting-runner');
    seedRoute(s, 'session', {
      provider: 'antigravity',
      modelId: 'gemini-4-carbon',
      machineId: runner.machineId,
    });
    const request = deferred<string>();
    disposables.push(
      s.machineHub.subscribeMachine(s.team.id, runner.machineId, (message) => {
        if (message.type === 'antigravity.models') request.resolve(message.requestId);
      }),
    );
    const connectionId = s.machineHub.connectionId(runner.machineId);
    const path = `/api/teams/${s.team.id}/antigravity-subscriptions`;
    const created = await req(s.app, 'POST', path, {
      label: 'Disconnect',
      token: `AIzaSyA${'d'.repeat(28)}`,
    });
    const { id } = (await created.json()) as { id: string };
    const pending = req(s.app, 'POST', `${path}/${id}/upstream-models`);
    const requestId = await Promise.race([request.promise, pending.then(() => null)]);
    if (requestId === null) throw new Error('No probe dispatched');
    s.machineHub.releaseMachine(runner.machineId);
    const late = await probeRequest(s, requestId, runner.token, { phase: 'claim', connectionId });
    expect(late.status).toBe(404);
    expect(await (await pending).json()).toMatchObject({
      status: 'fallback',
      failure: 'not-found',
    });
  });
  test('falls back rather than returning the runner login single-model list for a token subscription', async () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());
    insertMachine(s, {
      name: 'agy-personal-login',
      capabilities: {
        mcpServers: [],
        skills: [],
        antigravity: {
          installed: true,
          authenticated: true,
          models: [{ id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' }],
        },
      },
    });
    const created = await req(s.app, 'POST', `/api/teams/${s.team.id}/antigravity-subscriptions`, {
      label: 'Paid subscription',
      token: `AIzaSyA${'p'.repeat(28)}`,
    });
    const sub = (await created.json()) as { id: string };
    const res = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/antigravity-subscriptions/${sub.id}/upstream-models`,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: 'fallback',
      failure: 'not-found',
      httpStatus: null,
      models: DEFAULT_ANTIGRAVITY_MODELS.map(({ id, name }) => ({ id, name })),
    });

    const rateLimited = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/antigravity-subscriptions/${sub.id}/upstream-models`,
    );
    expect(rateLimited.status).toBe(429);
  });

  test('lists distinct models from the explicitly selected Runner', async () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());
    const runnerId = insertMachine(s, {
      name: 'agy-one',
      capabilities: {
        mcpServers: [],
        skills: [],
        antigravity: {
          installed: true,
          authenticated: true,
          models: [
            { id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' },
            { id: 'gemini-4-argon', name: 'Gemini 4 Argon' },
          ],
        },
      },
    });
    insertMachine(s, {
      name: 'agy-two',
      capabilities: {
        mcpServers: [],
        skills: [],
        antigravity: {
          installed: true,
          authenticated: true,
          models: [
            { id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' },
            { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
          ],
        },
      },
    });
    const created = await req(s.app, 'POST', `/api/teams/${s.team.id}/antigravity-subscriptions`, {
      label: 'Keyring',
      runnerId,
    });
    const sub = (await created.json()) as { id: string };
    const res = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/antigravity-subscriptions/${sub.id}/upstream-models`,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: 'ok',
      models: [
        { id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' },
        { id: 'gemini-4-argon', name: 'Gemini 4 Argon' },
      ],
    });

    const rateLimited = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/antigravity-subscriptions/${sub.id}/upstream-models`,
    );
    expect(rateLimited.status).toBe(429);
  });

  test('labels the built-in list as fallback for no probe runner or no stored credential', async () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());
    insertMachine(s, {
      name: 'plain-box',
      capabilities: { mcpServers: [], skills: [] },
    });
    const created = await req(s.app, 'POST', `/api/teams/${s.team.id}/antigravity-subscriptions`, {
      label: 'Token without runner',
      token: `AIzaSyA${'q'.repeat(28)}`,
    });
    const sub = (await created.json()) as { id: string };
    const res = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/antigravity-subscriptions/${sub.id}/upstream-models`,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: 'fallback',
      failure: 'not-found',
      models: expect.arrayContaining([{ id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' }]),
    });
    insertMachine(s, {
      name: 'agy-signed-out',
      capabilities: {
        mcpServers: [],
        skills: [],
        antigravity: {
          installed: true,
          authenticated: false,
          models: [{ id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' }],
        },
      },
    });
    const second = await req(s.app, 'POST', `/api/teams/${s.team.id}/antigravity-subscriptions`, {
      label: 'Second',
      runnerId: 'machine-agy-signed-out',
    });
    const other = (await second.json()) as { id: string };
    const signedOut = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/antigravity-subscriptions/${other.id}/upstream-models`,
    );
    expect(await signedOut.json()).toMatchObject({ status: 'fallback', failure: 'auth' });
  });

  test('lists the full CLI model catalog reported by an authenticated Runner for a host-login subscription while ignoring retired Runners', async () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());
    const fullCliModels = [
      { id: 'gemini-4-neon', name: 'Gemini 4 Neon' },
      { id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' },
      { id: 'gemini-4-argon', name: 'Gemini 4 Argon' },
      { id: 'gemini-4-hydrogen', name: 'Gemini 4 Hydrogen' },
      { id: 'gemini-pro-orchestrator-neon', name: 'Orchestrator (Neon)' },
      { id: 'gemini-pro-orchestrator', name: 'Orchestrator (Carbon)' },
      { id: 'gemini-pro-orchestrator-argon', name: 'Orchestrator (Argon)' },
      { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' },
      { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
      { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
      { id: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B (Medium)' },
    ];
    const retiredId = insertMachine(s, {
      name: 'agy-retired',
      capabilities: {
        mcpServers: [],
        skills: [],
        antigravity: {
          installed: true,
          authenticated: true,
          models: [{ id: 'retired-only-model', name: 'Retired Only' }],
        },
      },
    });
    s.db.update(machineTable).set({ retiredAt: 1 }).where(eq(machineTable.id, retiredId)).run();
    insertMachine(s, {
      name: 'agy-full-cli',
      capabilities: {
        mcpServers: [],
        skills: [],
        antigravity: {
          installed: true,
          version: '1.5.16',
          authenticated: true,
          models: fullCliModels,
        },
      },
    });
    const path = `/api/teams/${s.team.id}/antigravity-subscriptions`;
    const createdHost = await req(s.app, 'POST', path, { label: 'Host login' });
    expect(createdHost.status).toBe(201);
    const host = (await createdHost.json()) as { id: string };
    const upstream = await req(s.app, 'POST', `${path}/${host.id}/upstream-models`);
    expect(upstream.status).toBe(200);
    expect(await upstream.json()).toEqual({ status: 'ok', models: fullCliModels });

    const createdKey = await req(s.app, 'POST', path, {
      label: 'Separate key',
      token: `AIzaSyA${'m'.repeat(28)}`,
    });
    const keyed = (await createdKey.json()) as { id: string };
    const keyedUpstream = await req(s.app, 'POST', `${path}/${keyed.id}/upstream-models`);
    expect(keyedUpstream.status).toBe(200);
    expect(await keyedUpstream.json()).toMatchObject({ status: 'fallback', failure: 'not-found' });
  });

  test('stores a curated model subset and offers it in model sources', async () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());
    insertMachine(s, {
      name: 'agy-mac',
      capabilities: {
        mcpServers: [],
        skills: [],
        antigravity: {
          installed: true,
          authenticated: true,
          models: [
            { id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' },
            { id: 'gemini-4-argon', name: 'Gemini 4 Argon' },
          ],
        },
      },
    });
    const created = await req(s.app, 'POST', `/api/teams/${s.team.id}/antigravity-subscriptions`, {
      label: 'Curated',
    });
    const sub = (await created.json()) as { id: string; enabled: boolean };
    expect(sub.enabled).toBe(true);

    const patched = await req(
      s.app,
      'PATCH',
      `/api/teams/${s.team.id}/antigravity-subscriptions/${sub.id}`,
      {
        models: [
          { id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' },
          { id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' },
          { id: 'gemini-4-hydrogen', name: 'Gemini 4 Hydrogen' },
        ],
      },
    );
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({
      models: [
        { id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' },
        { id: 'gemini-4-hydrogen', name: 'Gemini 4 Hydrogen' },
      ],
    });
    expect(
      await (await req(s.app, 'GET', `/api/teams/${s.team.id}/antigravity-subscriptions`)).json(),
    ).toMatchObject([
      {
        models: [{ id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' }],
        runnerModels: [
          { id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' },
          { id: 'gemini-4-argon', name: 'Gemini 4 Argon' },
        ],
      },
    ]);

    const sources = getModelSources({ db: s.db, box: s.secretBox }, s.team.id).sources;
    expect(sources).toContainEqual({
      runtime: 'antigravity',
      installed: true,
      hostname: 'agy-mac',
      machineId: 'machine-agy-mac',
      models: [
        { id: 'gemini-4-carbon', name: 'Gemini 4 Carbon', slot: 'builtin' },
        { id: 'gemini-4-argon', name: 'Gemini 4 Argon', slot: 'builtin' },
      ],
    });
  });

  test('token model choices retain built-in thinking levels without borrowing Runner models', async () => {
    const s = bootServer();
    disposables.push(() => s.dispose());
    insertMachine(s, {
      name: 'token-runner',
      capabilities: {
        mcpServers: [],
        skills: [],
        antigravity: { installed: true, models: [{ id: 'runner-only', name: 'Runner Only' }] },
      },
    });
    const path = `/api/teams/${s.team.id}/antigravity-subscriptions`;
    const created = await req(s.app, 'POST', path, {
      label: 'Token',
      token: `AIzaSyA${'x'.repeat(28)}`,
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    expect(
      (
        await req(s.app, 'PATCH', `${path}/${id}`, {
          models: [{ id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' }],
        })
      ).status,
    ).toBe(200);
    expect(
      getModelSources({ db: s.db, box: s.secretBox }, s.team.id).sources.find(
        (s) => s.runtime === 'antigravity',
      )?.models,
    ).toMatchObject([{ id: 'gemini-3.8-flash', thinkingLevels: ['low', 'medium', 'high'] }]);
  });

  test('an offline antigravity-capable Runner still contributes its model source', async () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());
    const machineId = insertMachine(s, {
      name: 'agy-asleep',
      capabilities: {
        mcpServers: [],
        skills: [],
        antigravity: {
          installed: true,
          authenticated: true,
          models: [{ id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' }],
        },
      },
    });
    s.db.update(machineTable).set({ online: false }).where(eq(machineTable.id, machineId)).run();
    const sources = getModelSources({ db: s.db, box: s.secretBox }, s.team.id).sources;
    expect(sources).toContainEqual({
      runtime: 'antigravity',
      installed: true,
      hostname: 'agy-asleep',
      machineId,
      models: [{ id: 'gemini-4-carbon', name: 'Gemini 4 Carbon', slot: 'builtin' }],
    });
  });

  test('stores durable refresh-token OAuth bound to refresh-derived subject, blocks account-swap and paired verify, and allows bound renewal after auth failure', async () => {
    const ownerToken = 'durable-oauth-owner-token-0123456789abcdef';
    const s = bootServer({ authToken: ownerToken, githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());
    const ownerHeaders = { authorization: `Bearer ${ownerToken}` };
    const call = (
      method: string,
      url: string,
      headers: Record<string, string>,
      body?: unknown,
    ): Promise<Response> =>
      Promise.resolve(
        s.app.request(url, {
          method,
          headers: {
            ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
            ...headers,
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        }),
      );
    const path = `/api/teams/${s.team.id}/antigravity-subscriptions`;
    const refreshA = `1//0gDurableRefreshA_${'a'.repeat(32)}`;
    const refreshB = `1//0gDurableRefreshB_${'b'.repeat(32)}`;
    const refreshOther = `1//0gDurableRefreshOther_${'o'.repeat(32)}`;
    const refreshRevoked = `1//0gDurableRefreshRevoked_${'r'.repeat(32)}`;
    const accessA = `ya29.${'a'.repeat(64)}`;
    const accessB = `ya29.${'b'.repeat(64)}`;
    const accessOther = `ya29.${'o'.repeat(64)}`;
    const expiresAt = Date.now() + 3_600_000;

    const prevBin = process.env.AGY_BIN;
    const binDir = makeTestTempDir('agy-verify-durable-');
    const stateFile = join(binDir, 'revoked.flag');
    disposables.push(() => {
      if (prevBin === undefined) delete process.env.AGY_BIN;
      else process.env.AGY_BIN = prevBin;
      releaseTestTempDir(binDir);
    });
    const fakeBin = join(binDir, 'fake-agy.sh');
    writeFileSync(
      fakeBin,
      [
        '#!/bin/sh',
        `exec "${process.execPath}" --input-type=module -e '`,
        'import { existsSync, readFileSync, writeFileSync } from "node:fs";',
        'import { createInterface } from "node:readline";',
        'const send = (o) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...o }) + "\\n");',
        'const force = process.env.AGY_CLI_FORCE_FILE_TOKEN_STORAGE;',
        'const tokenPath = process.env.HOME + "/.gemini/antigravity-acp/antigravity-oauth-token";',
        'const tok = JSON.parse(readFileSync(tokenPath, "utf8"));',
        'const refresh = tok.token?.refresh_token;',
        `const minted = refresh === "${refreshA}" && !existsSync(${JSON.stringify(stateFile)}) ? "${accessA}" : refresh === "${refreshB}" ? "${accessB}" : refresh === "${refreshOther}" ? "${accessOther}" : null;`,
        'for await (const line of createInterface({ input: process.stdin })) {',
        '  const m = JSON.parse(line);',
        '  if (m.method === "initialize") send({ id: m.id, result: { protocolVersion: 1 } });',
        '  if (m.method === "session/new") {',
        '    if (force === "1" && minted !== null) {',
        '      tok.token.access_token = minted;',
        '      tok.token.expiry = new Date(Date.now() + 3600000).toISOString();',
        '      writeFileSync(tokenPath, JSON.stringify(tok));',
        '      send({ id: m.id, result: { sessionId: "ok" } });',
        '    } else {',
        '      send({ id: m.id, error: { code: -32000, message: "Authentication required" } });',
        '    }',
        '  }',
        '}',
        "'",
      ].join('\n'),
      { mode: 0o755 },
    );
    process.env.AGY_BIN = fakeBin;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        expect(url).toBe('https://oauth2.googleapis.com/tokeninfo');
        const bearer = new Headers(init?.headers).get('authorization');
        if (bearer === `Bearer ${accessA}` || bearer === `Bearer ${accessB}`) {
          return Response.json({ expires_in: '3600', sub: 'sub-same' });
        }
        if (bearer === `Bearer ${accessOther}`) {
          return Response.json({ expires_in: '3600', sub: 'sub-other' });
        }
        return Response.json({ error: 'invalid_token' }, { status: 400 });
      }),
    );

    const leaked = await call('POST', path, ownerHeaders, {
      label: `Oops ${refreshA}`,
      token: accessA,
      expiresAt,
      refreshToken: refreshA,
    });
    expect(leaked.status).toBe(400);

    const unverified = await call('POST', path, ownerHeaders, {
      label: 'Bad refresh',
      refreshToken: refreshRevoked,
      authMethod: 'consumer',
    });
    expect(unverified.status).toBe(400);

    const mismatchedCreate = await call('POST', path, ownerHeaders, {
      label: 'Cross account',
      token: accessA,
      expiresAt,
      refreshToken: refreshOther,
      authMethod: 'consumer',
    });
    expect(mismatchedCreate.status).toBe(400);

    const created = await call('POST', path, ownerHeaders, {
      label: 'Portable Google',
      refreshToken: refreshA,
      authMethod: 'consumer',
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as {
      id: string;
      hasToken: boolean;
      oauthPersonal?: boolean;
      expiresAt: number | null;
    };
    expect(body).toMatchObject({
      hasToken: true,
      oauthPersonal: true,
      expiresAt: null,
    });
    expect(JSON.stringify(body)).not.toContain(refreshA);

    const patchLeak = await call('PATCH', `${path}/${body.id}`, ownerHeaders, {
      label: `leak-${refreshA}`,
    });
    expect(patchLeak.status).toBe(400);

    const healthyOverwrite = await call('POST', `${path}/${body.id}/attach-oauth`, ownerHeaders, {
      kind: 'oauth-personal',
      token: accessB,
      expiresAt,
      refreshToken: refreshB,
    });
    expect(healthyOverwrite.status).toBe(409);

    const issued = await call('POST', '/api/remote/pairing', ownerHeaders);
    expect(issued.status).toBe(201);
    const { code } = (await issued.json()) as { code: string };
    const paired = await redeemTestPairing(s.app, code, 'phone');
    expect(paired.status).toBe(201);
    const { token: deviceToken } = (await paired.json()) as { token: string };
    const pairedVerify = await call('POST', `${path}/${body.id}/verify`, {
      authorization: `Bearer ${deviceToken}`,
    });
    expect(pairedVerify.status).toBe(403);

    writeFileSync(stateFile, 'revoked');
    const failedVerify = await call('POST', `${path}/${body.id}/verify`, ownerHeaders);
    expect(failedVerify.status).toBe(200);
    expect(await failedVerify.json()).toMatchObject({ ok: false, reason: 'auth' });

    const swappedRenew = await call('POST', `${path}/${body.id}/attach-oauth`, ownerHeaders, {
      kind: 'oauth-personal',
      token: accessB,
      expiresAt,
      refreshToken: refreshOther,
      authMethod: 'consumer',
    });
    expect(swappedRenew.status).toBe(400);

    const otherSubjectRenew = await call('POST', `${path}/${body.id}/attach-oauth`, ownerHeaders, {
      kind: 'oauth-personal',
      refreshToken: refreshOther,
      authMethod: 'consumer',
    });
    expect(otherSubjectRenew.status).toBe(409);

    const renewed = await call('POST', `${path}/${body.id}/attach-oauth`, ownerHeaders, {
      kind: 'oauth-personal',
      token: accessB,
      expiresAt,
      refreshToken: refreshB,
      authMethod: 'consumer',
    });
    expect(renewed.status).toBe(200);
    expect(await renewed.json()).toMatchObject({
      id: body.id,
      hasToken: true,
      oauthPersonal: true,
      expiresAt: null,
    });

    const okVerify = await call('POST', `${path}/${body.id}/verify`, ownerHeaders);
    expect(okVerify.status).toBe(200);
    expect(await okVerify.json()).toMatchObject({
      ok: true,
      check: { command: 'agy acp · Portable Google OAuth' },
    });

    const epipeBin = join(binDir, 'early-exit-agy.sh');
    writeFileSync(epipeBin, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    process.env.AGY_BIN = epipeBin;
    const earlyExit = await call('POST', path, ownerHeaders, {
      label: 'Early exit probe',
      refreshToken: refreshB,
      authMethod: 'consumer',
    });
    expect(earlyExit.status).toBe(502);
  });
});
