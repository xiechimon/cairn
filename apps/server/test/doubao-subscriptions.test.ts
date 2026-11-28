import type { MachineDoubaoVerifyBody } from '@cairn/shared';
import { eq, sql } from 'drizzle-orm';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import {
  build as buildTable,
  doubaoSubscription,
  machine as machineTable,
  step as stepTable,
  team as teamTable,
} from '../src/db/schema.js';
import { sha256Hex } from '../src/lib/crypto.js';
import { createDoubaoSubscription } from '../src/services/doubao-subscriptions.js';
import { requestDoubaoVerify } from '../src/services/machine-doubao-verify.js';
import { claimStep, markPresence } from '../src/services/machines.js';
import { getModelSources } from '../src/services/providers.js';
import {
  bootServer,
  insertMachine,
  issueApiKey,
  postProject,
  req,
  seedRoute,
  type TestServer,
} from './helpers.js';

const PNG_1X1_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

const disposables: (() => void)[] = [];
afterEach(() => {
  for (const d of disposables.splice(0)) d();
  vi.unstubAllGlobals();
});

function bootFastServer(opts: Parameters<typeof bootServer>[0] = {}): TestServer {
  const root = makeTestTempDir('doubao-sub-');
  const s = bootServer({
    reposDir: root,
    attachmentsDir: root,
    skillsDir: root,
    homeDir: root,
    dataDir: root,
    workspacesDir: root,
    ...opts,
  });
  disposables.push(() => {
    s.dispose();
    releaseTestTempDir(root);
  });
  return s;
}

const machineDeps = (s: TestServer) => ({
  ...s.svc,
  box: s.secretBox,
  reposDir: s.reposDir,
  attachmentsDir: s.attachmentsDir,
});

function attachLiveVerifier(
  s: TestServer,
  machineId: string,
  reply: (
    checkId: string,
    token: string,
  ) =>
    | Omit<MachineDoubaoVerifyBody, 'checkId'>
    | Promise<Omit<MachineDoubaoVerifyBody, 'checkId'> | null>
    | null,
): { token: string; checkIds: string[]; release: () => void } {
  const token = `doubao-machine-token-${machineId}-${Math.random().toString(36).slice(2)}`;
  s.db
    .update(machineTable)
    .set({ tokenHash: sha256Hex(token) })
    .where(eq(machineTable.id, machineId))
    .run();
  const checkIds: string[] = [];
  const release = s.machineHub.subscribeMachine(s.team.id, machineId, (ev) => {
    if (ev.type !== 'doubao.verify') return;
    checkIds.push(ev.checkId);
    void Promise.resolve(reply(ev.checkId, token)).then(async (body) => {
      if (body === null) return;
      await s.app.request('/api/machine/doubao/verify', {
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('doubao subscriptions REST, lifecycle, and live verify', () => {
  test('manages CRUD, single-active toggle, 409 while claimed, non-owner 403, and usage counting', async () => {
    const ownerToken = 'doubao-owner-token-0123456789abcdef';
    const s = bootFastServer({
      authToken: ownerToken,
      githubFetch: async () => new Response('[]'),
    });
    const ownerReq = (method: string, path: string, body?: unknown) =>
      s.app.request(path, {
        method,
        headers: {
          authorization: `Bearer ${ownerToken}`,
          'content-type': 'application/json',
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });

    const m1 = insertMachine(s, {
      name: 'macbook-doubao',
      capabilities: {
        mcpServers: [],
        skills: [],
        doubao: {
          installed: true,
          authenticated: true,
          platformSupported: true,
          version: '2.38.4',
          probedAt: 1000,
          models: [{ id: '4', name: 'Doubao 2.1 Turbo' }],
        },
      },
    });
    const m2 = insertMachine(s, {
      name: 'linux-doubao',
      capabilities: {
        mcpServers: [],
        skills: [],
        doubao: { installed: true, authenticated: false, platformSupported: true, probedAt: 1000 },
      },
    });
    s.db.update(teamTable).set({ defaultMachineId: m1 }).where(eq(teamTable.id, s.team.id)).run();

    const c1 = await ownerReq('POST', `/api/teams/${s.team.id}/doubao-subscriptions`, {
      label: 'MacBook 豆包',
      runnerId: m1,
    });
    expect(c1.status).toBe(201);
    const sub1 = (await c1.json()) as {
      id: string;
      enabledAt: number | null;
      runnerId: string;
      models: Array<{ id: string }>;
    };
    expect(sub1.enabledAt).toEqual(expect.any(Number));
    expect(sub1.runnerId).toBe(m1);
    expect(sub1.models.map((m) => m.id)).toEqual(['4']);

    const c2 = await ownerReq('POST', `/api/teams/${s.team.id}/doubao-subscriptions`, {
      label: 'Linux 豆包',
      runnerId: m2,
    });
    expect(c2.status).toBe(201);
    const sub2 = (await c2.json()) as { id: string; enabledAt: number | null; models: unknown[] };
    expect(sub2.enabledAt).toBeNull();
    expect(sub2.models).toEqual([]);

    const anonCreate = await s.app.request(`/api/teams/${s.team.id}/doubao-subscriptions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'Anon fail', runnerId: m1 }),
    });
    expect(anonCreate.status).toBe(401);

    s.db.run(
      sql`INSERT INTO user (rowid, id, displayName, avatarUrl) VALUES (0, 'instance-owner-0', 'Owner', NULL)`,
    );
    const memberCreate = await ownerReq('POST', `/api/teams/${s.team.id}/doubao-subscriptions`, {
      label: 'Member fail',
      runnerId: m1,
    });
    expect(memberCreate.status).toBe(403);
    const memberVerify = await ownerReq(
      'POST',
      `/api/teams/${s.team.id}/doubao-subscriptions/${sub1.id}/verify`,
    );
    expect(memberVerify.status).toBe(403);
    s.db.run(sql`DELETE FROM user WHERE rowid = 0`);

    const projRes = await ownerReq('POST', '/api/projects', { name: 'p-usage' });
    const proj = (await projRes.json()) as { id: string };
    const todoRes = await ownerReq('POST', `/api/projects/${proj.id}/todos`, {
      title: 'Doubao claimed',
      spec: '',
    });
    expect(todoRes.status).toBe(201);
    const todoRow = (await todoRes.json()) as { id: string };
    const buildRes = await ownerReq('POST', `/api/projects/${proj.id}/builds`, {
      todoIds: [todoRow.id],
    });
    expect(buildRes.status).toBe(201);
    const buildId = ((await buildRes.json()) as { builds: Array<{ id: string }> }).builds[0]!.id;
    const initialStep = s.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).get()!;
    s.db
      .update(stepTable)
      .set({ status: 'claimed', claimedAt: Date.now(), doubaoSubscriptionId: sub1.id })
      .where(eq(stepTable.id, initialStep.id))
      .run();
    s.db
      .insert(stepTable)
      .values({
        id: 'step-failed',
        buildId,
        kind: 'build',
        status: 'failed',
        claimedAt: Date.now() - 60_000,
        doubaoSubscriptionId: sub1.id,
        createdAt: 1000,
      })
      .run();

    expect(
      (await ownerReq('POST', `/api/teams/${s.team.id}/doubao-subscriptions/${sub1.id}/disable`))
        .status,
    ).toBe(409);
    expect(
      (await ownerReq('POST', `/api/teams/${s.team.id}/doubao-subscriptions/${sub2.id}/enable`))
        .status,
    ).toBe(409);
    expect(
      (
        await ownerReq('PATCH', `/api/teams/${s.team.id}/doubao-subscriptions/${sub1.id}`, {
          runnerId: m2,
        })
      ).status,
    ).toBe(409);
    expect(
      (await ownerReq('DELETE', `/api/teams/${s.team.id}/doubao-subscriptions/${sub1.id}`)).status,
    ).toBe(409);

    s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.id, initialStep.id)).run();

    const listRes = await ownerReq('GET', `/api/teams/${s.team.id}/doubao-subscriptions`);
    const listBody = (await listRes.json()) as {
      subscriptions: Array<{ id: string; stepsLast24h: number }>;
    };
    expect(listBody.subscriptions.find((x) => x.id === sub1.id)?.stepsLast24h).toBe(2);
    expect(listBody.subscriptions.find((x) => x.id === sub2.id)?.stepsLast24h).toBe(0);

    expect(
      (await ownerReq('POST', `/api/teams/${s.team.id}/doubao-subscriptions/${sub2.id}/enable`))
        .status,
    ).toBe(200);
    expect(
      (await ownerReq('DELETE', `/api/teams/${s.team.id}/doubao-subscriptions/${sub1.id}`)).status,
    ).toBe(204);
    expect(
      s.db
        .select({ subId: stepTable.doubaoSubscriptionId })
        .from(stepTable)
        .where(eq(stepTable.id, initialStep.id))
        .get()?.subId,
    ).toBe(sub1.id);
  });

  test('reassigns doubao runnerId on machine merge and exposes fallback models before any runner logs in', async () => {
    const s = bootFastServer({ githubFetch: async () => new Response('[]') });
    const key1 = await issueApiKey(s);
    const key2 = await issueApiKey(s);

    const oldEnrollRes = await s.app.request('/api/machine/enroll', {
      method: 'POST',
      headers: { authorization: `Bearer ${key1}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        teamId: s.team.id,
        name: 'mac-dup',
        capabilities: {
          mcpServers: [],
          skills: [],
          doubao: {
            installed: false,
            authenticated: false,
            platformSupported: true,
            probedAt: 100,
          },
        },
      }),
    });
    expect(oldEnrollRes.status).toBe(200);
    const oldEnroll = (await oldEnrollRes.json()) as { machineId: string };
    const sub = createDoubaoSubscription({ db: s.db }, s.team.id, {
      label: 'Mac 豆包',
      runnerId: oldEnroll.machineId,
    });
    expect(sub.models).toEqual([]);
    const doubaoSource = getModelSources({ db: s.db, box: s.secretBox }, s.team.id).sources.find(
      (src) => src.runtime === 'doubao',
    );
    expect(doubaoSource).toBeDefined();
    expect(doubaoSource?.installed).toBe(false);
    expect(doubaoSource?.models.map((m) => m.id)).toEqual(['4']);

    const upstreamUnauthed = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/doubao-subscriptions/${sub.id}/upstream-models`,
    );
    expect(upstreamUnauthed.status).toBe(200);
    expect((await upstreamUnauthed.json()) as { status: string; models: unknown[] }).toMatchObject({
      status: 'fallback',
      models: [],
    });

    const newEnrollRes = await s.app.request('/api/machine/enroll', {
      method: 'POST',
      headers: { authorization: `Bearer ${key2}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        teamId: s.team.id,
        name: 'mac-dup',
        capabilities: {
          mcpServers: [],
          skills: [],
          doubao: {
            installed: true,
            authenticated: true,
            platformSupported: true,
            probedAt: 200,
            models: [{ id: '5', name: 'Doubao 2.1 Pro' }],
          },
        },
      }),
    });
    expect(newEnrollRes.status).toBe(200);
    const newEnroll = (await newEnrollRes.json()) as { machineId: string };
    expect(newEnroll.machineId).not.toBe(oldEnroll.machineId);
    const updatedRow = s.db
      .select()
      .from(doubaoSubscription)
      .where(eq(doubaoSubscription.id, sub.id))
      .get();
    expect(updatedRow?.runnerId).toBe(newEnroll.machineId);
  });

  test('verifies runner via machine bearer auth with dedupe, wrong-runner 404, timeout, disconnect, mid-verify rebind guard, and queue wake', async () => {
    const s = bootFastServer({
      githubFetch: async () => new Response('[]'),
      doubaoVerifyTimeoutMs: 60,
    });

    const m1 = insertMachine(s, {
      name: 'mbp-verify',
      capabilities: {
        mcpServers: [],
        skills: [],
        doubao: { installed: true, authenticated: false, platformSupported: true, probedAt: 500 },
      },
    });
    const m2 = insertMachine(s, {
      name: 'other-runner',
      capabilities: {
        mcpServers: [],
        skills: [],
        doubao: { installed: true, authenticated: false, platformSupported: true, probedAt: 500 },
      },
    });
    const m2Token = 'other-runner-token-xyz';
    s.db
      .update(machineTable)
      .set({ tokenHash: sha256Hex(m2Token) })
      .where(eq(machineTable.id, m2))
      .run();

    const sub = createDoubaoSubscription({ db: s.db, machineHub: s.machineHub }, s.team.id, {
      label: 'Verify Target',
      runnerId: m1,
    });

    let wrongStatus = 0;
    const gate = deferred<Omit<MachineDoubaoVerifyBody, 'checkId'>>();
    const verifier = attachLiveVerifier(s, m1, async (checkId) => {
      const wrongResp = await s.app.request('/api/machine/doubao/verify', {
        method: 'POST',
        headers: { authorization: `Bearer ${m2Token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ checkId, installed: true, authenticated: true }),
      });
      wrongStatus = wrongResp.status;
      return gate.promise;
    });
    disposables.push(verifier.release);

    const seqBefore = s.machineHub.wakeSeq(s.team.id);
    const verifyPromise = req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/doubao-subscriptions/${sub.id}/verify`,
    );
    const dupVerify = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/doubao-subscriptions/${sub.id}/verify`,
    );
    expect(dupVerify.status).toBe(429);

    gate.resolve({
      installed: true,
      authenticated: true,
      platformSupported: true,
      version: '2.38.4',
      probedAt: 2000,
      models: [{ id: '4', name: 'Doubao 2.1 Turbo' }],
      durationMs: 42,
    });
    const res1 = await verifyPromise;
    expect(wrongStatus).toBe(404);
    expect(res1.status).toBe(200);
    expect(await res1.json()).toMatchObject({ ok: true, runnerName: 'mbp-verify' });
    expect(s.machineHub.wakeSeq(s.team.id)).toBeGreaterThan(seqBefore);

    markPresence(machineDeps(s), m1, {
      capabilities: {
        mcpServers: [],
        skills: [],
        doubao: { installed: true, authenticated: false, platformSupported: true, probedAt: 1000 },
      },
    });
    const afterStaleHeartbeat = s.db
      .select()
      .from(machineTable)
      .where(eq(machineTable.id, m1))
      .get();
    expect(afterStaleHeartbeat?.capabilities?.doubao?.authenticated).toBe(true);

    const sub2 = createDoubaoSubscription({ db: s.db }, s.team.id, {
      label: 'Timeout Target',
      runnerId: m1,
    });
    verifier.release();
    const slowVerifier = attachLiveVerifier(s, m1, () => null);
    disposables.push(slowVerifier.release);
    const timedOut = await (
      await req(s.app, 'POST', `/api/teams/${s.team.id}/doubao-subscriptions/${sub2.id}/verify`)
    ).json();
    expect(timedOut).toMatchObject({ ok: false, reason: 'timeout' });

    const sub3 = createDoubaoSubscription({ db: s.db }, s.team.id, {
      label: 'Disconnect Target',
      runnerId: m1,
    });
    slowVerifier.release();
    const discGate = deferred<null>();
    const discVerifier = attachLiveVerifier(s, m1, async () => {
      discVerifier.release();
      return discGate.promise;
    });
    const disconnectedRes = await (
      await req(s.app, 'POST', `/api/teams/${s.team.id}/doubao-subscriptions/${sub3.id}/verify`)
    ).json();
    discGate.resolve(null);
    expect(disconnectedRes).toMatchObject({ ok: false, reason: 'unavailable' });

    const sub4 = createDoubaoSubscription({ db: s.db }, s.team.id, {
      label: 'Rebind Guard',
      runnerId: m1,
    });
    const rebindGate = deferred<Omit<MachineDoubaoVerifyBody, 'checkId'>>();
    const rebindVerifier = attachLiveVerifier(s, m1, () => rebindGate.promise);
    disposables.push(rebindVerifier.release);
    const p4 = req(s.app, 'POST', `/api/teams/${s.team.id}/doubao-subscriptions/${sub4.id}/verify`);
    await req(s.app, 'PATCH', `/api/teams/${s.team.id}/doubao-subscriptions/${sub4.id}`, {
      runnerId: m2,
    });
    rebindGate.resolve({ installed: true, authenticated: true, probedAt: 3000 });
    await p4;
    const rowAfterRebind = s.db
      .select()
      .from(doubaoSubscription)
      .where(eq(doubaoSubscription.id, sub4.id))
      .get();
    expect(rowAfterRebind?.runnerId).toBe(m2);
    expect(rowAfterRebind?.lastCheck).toBeNull();
  });

  test('manages concurrent per-machine QR login sessions, deduplicates callers, guards logoutFirst while claimed, redacts QR for non-owners, enforces team boundary, rejects invalid PNG/wrong runner/late events, marks offline on disconnect, and unblocks queued step on succeeded', async () => {
    const ownerToken = 'doubao-qr-owner-token-0123456789abc';
    const s = bootFastServer({
      authToken: ownerToken,
      githubFetch: async () => new Response('[]'),
    });
    const ownerReq = (method: string, path: string, body?: unknown) =>
      s.app.request(path, {
        method,
        headers: {
          authorization: `Bearer ${ownerToken}`,
          'content-type': 'application/json',
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });

    const m1 = insertMachine(s, {
      name: 'mac-mini-qr',
      capabilities: {
        mcpServers: [],
        skills: [],
        doubao: { installed: false, authenticated: false, platformSupported: true, probedAt: 100 },
      },
    });
    const m2 = insertMachine(s, {
      name: 'macbook-qr',
      capabilities: {
        mcpServers: [],
        skills: [],
        doubao: { installed: false, authenticated: false, platformSupported: true, probedAt: 100 },
      },
    });
    const mUnsupported = insertMachine(s, {
      name: 'intel-mac',
      capabilities: {
        mcpServers: [],
        skills: [],
        doubao: { installed: false, authenticated: false, platformSupported: false, probedAt: 100 },
      },
    });

    const tok1 = 'tok-m1-secret';
    const tok2 = 'tok-m2-secret';
    s.db
      .update(machineTable)
      .set({ tokenHash: sha256Hex(tok1) })
      .where(eq(machineTable.id, m1))
      .run();
    s.db
      .update(machineTable)
      .set({ tokenHash: sha256Hex(tok2) })
      .where(eq(machineTable.id, m2))
      .run();

    const pushed1: Array<{ type: string; loginId?: string; logoutFirst?: boolean }> = [];
    const pushed2: Array<{ type: string; loginId?: string; logoutFirst?: boolean }> = [];
    const sub1Stream = s.machineHub.subscribeMachine(s.team.id, m1, (ev) => pushed1.push(ev));
    const sub2Stream = s.machineHub.subscribeMachine(s.team.id, m2, (ev) => pushed2.push(ev));
    const subUnsup = s.machineHub.subscribeMachine(s.team.id, mUnsupported, () => {});
    disposables.push(sub1Stream, sub2Stream, subUnsup);

    expect(
      (await ownerReq('POST', `/api/teams/${s.team.id}/machines/${mUnsupported}/doubao-login`, {}))
        .status,
    ).toBe(400);
    expect(
      (await ownerReq('GET', `/api/teams/other-team/machines/${m1}/doubao-login`)).status,
    ).toBe(404);

    s.db.update(teamTable).set({ defaultMachineId: m1 }).where(eq(teamTable.id, s.team.id)).run();
    const subRes = await ownerReq('POST', `/api/teams/${s.team.id}/doubao-subscriptions`, {
      label: '团队豆包',
    });
    expect(subRes.status).toBe(201);
    const subRow = (await subRes.json()) as { id: string; runnerId: string | null };
    expect(subRow.runnerId).toBeNull();
    seedRoute(s, 'session', { provider: 'doubao', modelId: '4' });
    const projRes = await ownerReq('POST', '/api/projects', { name: 'qr-proj' });
    const proj = (await projRes.json()) as { id: string };
    const todoRes = await ownerReq('POST', `/api/projects/${proj.id}/todos`, {
      title: 'QR wait',
      spec: '',
    });
    const todoRow = (await todoRes.json()) as { id: string };
    expect(
      (await ownerReq('POST', `/api/projects/${proj.id}/builds`, { todoIds: [todoRow.id] })).status,
    ).toBe(201);

    const start1 = await ownerReq(
      'POST',
      `/api/teams/${s.team.id}/machines/${m1}/doubao-login`,
      {},
    );
    const start1Dup = await ownerReq(
      'POST',
      `/api/teams/${s.team.id}/machines/${m1}/doubao-login`,
      {},
    );
    const start2 = await ownerReq(
      'POST',
      `/api/teams/${s.team.id}/machines/${m2}/doubao-login`,
      {},
    );
    expect(start1.status).toBe(200);
    expect(start2.status).toBe(200);
    const s1Body = (await start1.json()) as { session: { loginId: string; status: string } };
    const s1DupBody = (await start1Dup.json()) as { session: { loginId: string } };
    const s2Body = (await start2.json()) as { session: { loginId: string } };
    expect(s1DupBody.session.loginId).toBe(s1Body.session.loginId);
    expect(s2Body.session.loginId).not.toBe(s1Body.session.loginId);

    const badPng = await s.app.request('/api/machine/doubao-login-event', {
      method: 'POST',
      headers: { authorization: `Bearer ${tok1}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        loginId: s1Body.session.loginId,
        status: 'qr',
        revision: 1,
        qrPngBase64: Buffer.from('not-a-png').toString('base64'),
      }),
    });
    expect(badPng.status).toBe(400);

    const wrongRunner = await s.app.request('/api/machine/doubao-login-event', {
      method: 'POST',
      headers: { authorization: `Bearer ${tok2}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        loginId: s1Body.session.loginId,
        status: 'qr',
        revision: 1,
        qrPngBase64: PNG_1X1_B64,
      }),
    });
    expect(wrongRunner.status).toBe(404);

    expect(
      (
        await s.app.request('/api/machine/doubao-login-event', {
          method: 'POST',
          headers: { authorization: `Bearer ${tok1}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            loginId: s1Body.session.loginId,
            status: 'qr',
            revision: 1,
            qrPngBase64: PNG_1X1_B64,
          }),
        })
      ).status,
    ).toBe(200);

    s.db.run(
      sql`INSERT INTO user (rowid, id, displayName, avatarUrl) VALUES (0, 'instance-owner-0', 'Owner', NULL)`,
    );
    const memberGet = await ownerReq('GET', `/api/teams/${s.team.id}/machines/${m1}/doubao-login`);
    expect(memberGet.status).toBe(200);
    const memberSession = (await memberGet.json()) as {
      session: { status: string; qrPngBase64?: string };
    };
    expect(memberSession.session.status).toBe('qr');
    expect(memberSession.session.qrPngBase64).toBeUndefined();
    expect(
      (await ownerReq('POST', `/api/teams/${s.team.id}/machines/${m1}/doubao-login`, {})).status,
    ).toBe(403);
    expect(
      (await ownerReq('DELETE', `/api/teams/${s.team.id}/machines/${m1}/doubao-login`)).status,
    ).toBe(403);
    s.db.run(sql`DELETE FROM user WHERE rowid = 0`);

    const ownerGet = await ownerReq('GET', `/api/teams/${s.team.id}/machines/${m1}/doubao-login`);
    expect(
      ((await ownerGet.json()) as { session: { qrPngBase64?: string } }).session.qrPngBase64,
    ).toBe(PNG_1X1_B64);

    sub2Stream();
    const m2AfterDisc = (await (
      await ownerReq('GET', `/api/teams/${s.team.id}/machines/${m2}/doubao-login`)
    ).json()) as { session: { status: string; reason?: string } };
    expect(m2AfterDisc.session.status).toBe('failed');
    expect(m2AfterDisc.session.reason).toBe('offline');

    const forcedRes = await ownerReq(
      'POST',
      `/api/teams/${s.team.id}/machines/${m1}/doubao-login`,
      {
        force: true,
      },
    );
    const forcedBody = (await forcedRes.json()) as { session: { loginId: string } };
    expect(forcedBody.session.loginId).not.toBe(s1Body.session.loginId);
    expect(
      pushed1.some((e) => e.type === 'doubao.login.cancel' && e.loginId === s1Body.session.loginId),
    ).toBe(true);
    expect(
      (
        await s.app.request('/api/machine/doubao-login-event', {
          method: 'POST',
          headers: { authorization: `Bearer ${tok1}`, 'content-type': 'application/json' },
          body: JSON.stringify({ loginId: s1Body.session.loginId, status: 'scanned', revision: 2 }),
        })
      ).status,
    ).toBe(404);

    const wakeBefore = s.machineHub.wakeSeq(s.team.id);
    expect(
      (
        await s.app.request('/api/machine/doubao-login-event', {
          method: 'POST',
          headers: { authorization: `Bearer ${tok1}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            loginId: forcedBody.session.loginId,
            status: 'succeeded',
            revision: 3,
            doubao: {
              installed: true,
              authenticated: true,
              platformSupported: true,
              version: '2.38.4',
              probedAt: 5000,
              models: [{ id: '4', name: 'Doubao 2.1 Turbo' }],
            },
          }),
        })
      ).status,
    ).toBe(200);
    expect(s.machineHub.wakeSeq(s.team.id)).toBeGreaterThan(wakeBefore);

    const claimed = await claimStep(
      {
        ...s.svc,
        box: s.secretBox,
        reposDir: s.reposDir,
        attachmentsDir: s.attachmentsDir,
        skillsDir: s.skillsDir,
      },
      m1,
      s.team.id,
      10,
      'http://localhost',
    );
    expect(claimed?.step.id).toBeDefined();

    expect(
      (
        await ownerReq('POST', `/api/teams/${s.team.id}/machines/${m1}/doubao-login`, {
          logoutFirst: true,
        })
      ).status,
    ).toBe(409);

    s.db
      .update(stepTable)
      .set({ status: 'done', finishedAt: Date.now() })
      .where(eq(stepTable.id, claimed!.step.id))
      .run();
    const switchRes = await ownerReq(
      'POST',
      `/api/teams/${s.team.id}/machines/${m1}/doubao-login`,
      {
        logoutFirst: true,
      },
    );
    expect(switchRes.status).toBe(200);
    const switchBody = (await switchRes.json()) as { session: { loginId: string } };
    expect(
      s.db.select().from(machineTable).where(eq(machineTable.id, m1)).get()?.capabilities?.doubao
        ?.authenticated,
    ).toBe(false);
    expect(pushed1.at(-1)).toMatchObject({ type: 'doubao.login.start', logoutFirst: true });
    expect(await requestDoubaoVerify({ machineHub: s.machineHub }, m1, { timeoutMs: 200 })).toEqual(
      {
        ok: false,
        reason: 'unavailable',
      },
    );

    markPresence(machineDeps(s), m1, {
      capabilities: {
        mcpServers: [],
        skills: [],
        doubao: { installed: true, authenticated: true, platformSupported: true, probedAt: 99_999 },
      },
    });
    expect(
      s.db.select().from(machineTable).where(eq(machineTable.id, m1)).get()?.capabilities?.doubao
        ?.authenticated,
    ).toBe(false);

    const todo2Res = await ownerReq('POST', `/api/projects/${proj.id}/todos`, {
      title: 'Blocked during switch',
      spec: '',
    });
    const todo2 = (await todo2Res.json()) as { id: string };
    await ownerReq('POST', `/api/projects/${proj.id}/builds`, { todoIds: [todo2.id] });
    expect(
      await claimStep(
        {
          ...s.svc,
          box: s.secretBox,
          reposDir: s.reposDir,
          attachmentsDir: s.attachmentsDir,
          skillsDir: s.skillsDir,
        },
        m1,
        s.team.id,
        10,
        'http://localhost',
      ),
    ).toBeNull();

    expect(
      (
        await s.app.request('/api/machine/doubao-login-event', {
          method: 'POST',
          headers: { authorization: `Bearer ${tok1}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            loginId: switchBody.session.loginId,
            status: 'installing',
            revision: 1,
          }),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await s.app.request('/api/machine/doubao-login-event', {
          method: 'POST',
          headers: { authorization: `Bearer ${tok1}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            loginId: switchBody.session.loginId,
            status: 'installing',
            revision: 1,
          }),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await s.app.request('/api/machine/doubao-login-event', {
          method: 'POST',
          headers: { authorization: `Bearer ${tok1}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            loginId: switchBody.session.loginId,
            status: 'succeeded',
            revision: 2,
          }),
        })
      ).status,
    ).toBe(409);

    expect(
      (
        await ownerReq(
          'DELETE',
          `/api/teams/${s.team.id}/machines/${m1}/doubao-login?loginId=${encodeURIComponent(s1Body.session.loginId)}`,
        )
      ).status,
    ).toBe(200);
    const stillActive = (await (
      await ownerReq('GET', `/api/teams/${s.team.id}/machines/${m1}/doubao-login`)
    ).json()) as { session: { loginId: string; status: string } };
    expect(stillActive.session.loginId).toBe(switchBody.session.loginId);
    expect(stillActive.session.status).toBe('installing');

    expect(
      (
        await ownerReq(
          'DELETE',
          `/api/teams/${s.team.id}/machines/${m1}/doubao-login?loginId=${encodeURIComponent(switchBody.session.loginId)}`,
        )
      ).status,
    ).toBe(200);
    const afterCancel = (await (
      await ownerReq('GET', `/api/teams/${s.team.id}/machines/${m1}/doubao-login`)
    ).json()) as { session: { status: string } };
    expect(afterCancel.session.status).toBe('cancelled');

    const postLogoutMachine = s.db
      .select()
      .from(machineTable)
      .where(eq(machineTable.id, m1))
      .get()!;
    expect(postLogoutMachine.capabilities?.doubao?.switchedAt).toEqual(expect.any(Number));
    const preLateSwitchAt = postLogoutMachine.capabilities!.doubao!.switchedAt!;

    markPresence(machineDeps(s), m1, {
      capabilities: {
        mcpServers: [],
        skills: [],
        doubao: {
          installed: true,
          authenticated: true,
          platformSupported: true,
          probedAt: 100_005,
        },
      },
    });
    expect(
      s.db.select().from(machineTable).where(eq(machineTable.id, m1)).get()?.capabilities?.doubao
        ?.authenticated,
    ).toBe(false);

    const wakeBeforeLateSuccess = s.machineHub.wakeSeq(s.team.id);
    expect(
      (
        await s.app.request('/api/machine/doubao-login-event', {
          method: 'POST',
          headers: { authorization: `Bearer ${tok1}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            loginId: switchBody.session.loginId,
            status: 'succeeded',
            revision: 3,
            doubao: {
              installed: true,
              authenticated: true,
              platformSupported: true,
              probedAt: 100_007,
            },
          }),
        })
      ).status,
    ).toBe(200);
    const afterLateSuccess = s.db.select().from(machineTable).where(eq(machineTable.id, m1)).get()!;
    expect(afterLateSuccess.capabilities?.doubao?.authenticated).toBe(true);
    expect(afterLateSuccess.capabilities?.doubao?.switchedAt).toBeGreaterThanOrEqual(
      preLateSwitchAt,
    );
    expect(s.machineHub.wakeSeq(s.team.id)).toBeGreaterThan(wakeBeforeLateSuccess);

    const switchHoldTest = await ownerReq(
      'POST',
      `/api/teams/${s.team.id}/machines/${m1}/doubao-login`,
      {
        logoutFirst: true,
      },
    );
    expect(switchHoldTest.status).toBe(200);
    const switchHoldBody = (await switchHoldTest.json()) as { session: { loginId: string } };
    sub1Stream();
    expect(
      (
        await ownerReq('POST', `/api/teams/${s.team.id}/machines/${m1}/doubao-login`, {
          force: true,
        })
      ).status,
    ).toBe(409);
    markPresence(machineDeps(s), m1, {
      capabilities: {
        mcpServers: [],
        skills: [],
        doubao: {
          installed: true,
          authenticated: true,
          platformSupported: true,
          probedAt: 100_009,
        },
      },
    });
    expect(
      s.db.select().from(machineTable).where(eq(machineTable.id, m1)).get()?.capabilities?.doubao
        ?.authenticated,
    ).toBe(false);
    s.db.update(machineTable).set({ online: true }).where(eq(machineTable.id, m1)).run();
    const reattachedM1 = s.machineHub.subscribeMachine(s.team.id, m1, (ev) => pushed1.push(ev));
    disposables.push(reattachedM1);

    expect(
      (
        await s.app.request('/api/machine/doubao-login-event', {
          method: 'POST',
          headers: { authorization: `Bearer ${tok1}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            loginId: switchHoldBody.session.loginId,
            status: 'cancelled',
            revision: 2,
          }),
        })
      ).status,
    ).toBe(200);

    const postCancelFresh = await ownerReq(
      'POST',
      `/api/teams/${s.team.id}/machines/${m1}/doubao-login`,
      {},
    );
    const postCancelSession = ((await postCancelFresh.json()) as { session: { loginId: string } })
      .session;
    for (const [rev, status, qr] of [
      [1, 'qr', PNG_1X1_B64],
      [2, 'scanned', undefined],
      [3, 'qr', PNG_1X1_B64],
      [4, 'verifying', undefined],
      [5, 'qr', PNG_1X1_B64],
    ] as const) {
      expect(
        (
          await s.app.request('/api/machine/doubao-login-event', {
            method: 'POST',
            headers: { authorization: `Bearer ${tok1}`, 'content-type': 'application/json' },
            body: JSON.stringify({
              loginId: postCancelSession.loginId,
              status,
              revision: rev,
              ...(qr !== undefined ? { qrPngBase64: qr } : {}),
            }),
          })
        ).status,
      ).toBe(200);
    }
    expect(
      (
        await s.app.request('/api/machine/doubao-login-event', {
          method: 'POST',
          headers: { authorization: `Bearer ${tok1}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            loginId: postCancelSession.loginId,
            status: 'cancelled',
            revision: 6,
          }),
        })
      ).status,
    ).toBe(200);

    let lateVerifyCheckId = '';
    const verifyBeforeSwitch = attachLiveVerifier(s, m1, (checkId) => {
      lateVerifyCheckId = checkId;
      return null;
    });
    disposables.push(verifyBeforeSwitch.release);
    const pendingVerifyPromise = requestDoubaoVerify({ machineHub: s.machineHub }, m1, {
      timeoutMs: 2_000,
    });
    expect(lateVerifyCheckId).not.toBe('');

    const switch2Res = await ownerReq(
      'POST',
      `/api/teams/${s.team.id}/machines/${m1}/doubao-login`,
      {
        logoutFirst: true,
      },
    );
    expect(switch2Res.status).toBe(200);
    const lateVerifyResp = await s.app.request('/api/machine/doubao/verify', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${verifyBeforeSwitch.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        checkId: lateVerifyCheckId,
        installed: true,
        authenticated: true,
        platformSupported: true,
        probedAt: 100_008,
      }),
    });
    expect(lateVerifyResp.status).toBe(200);
    expect(await pendingVerifyPromise).toMatchObject({ ok: false, reason: 'missing_local_login' });
    expect(
      s.db.select().from(machineTable).where(eq(machineTable.id, m1)).get()?.capabilities?.doubao
        ?.authenticated,
    ).toBe(false);

    s.db
      .update(machineTable)
      .set({ tokenHash: sha256Hex(tok1) })
      .where(eq(machineTable.id, m1))
      .run();

    const refreshAfterSwitchRes = await ownerReq(
      'POST',
      `/api/teams/${s.team.id}/machines/${m1}/doubao-login`,
      { force: true },
    );
    const refreshAfterSwitch = (await refreshAfterSwitchRes.json()) as {
      session: { loginId: string };
    };
    markPresence(machineDeps(s), m1, {
      capabilities: {
        mcpServers: [],
        skills: [],
        doubao: {
          installed: true,
          authenticated: true,
          platformSupported: true,
          probedAt: 100_010,
        },
      },
    });
    expect(
      s.db.select().from(machineTable).where(eq(machineTable.id, m1)).get()?.capabilities?.doubao
        ?.authenticated,
    ).toBe(false);

    expect(
      (
        await s.app.request('/api/machine/doubao-login-event', {
          method: 'POST',
          headers: { authorization: `Bearer ${tok1}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            loginId: refreshAfterSwitch.session.loginId,
            status: 'succeeded',
            revision: 3,
            doubao: {
              installed: true,
              authenticated: true,
              platformSupported: true,
              probedAt: 100_020,
            },
          }),
        })
      ).status,
    ).toBe(200);
    const switchedReport = s.db.select().from(machineTable).where(eq(machineTable.id, m1)).get()
      ?.capabilities?.doubao;
    expect(switchedReport?.authenticated).toBe(true);
    expect(switchedReport?.switchedAt).toEqual(expect.any(Number));

    const mOld = insertMachine(s, {
      name: 'legacy-runner',
      capabilities: { mcpServers: [], skills: [] },
    });
    const subOldStream = s.machineHub.subscribeMachine(s.team.id, mOld, () => {});
    disposables.push(subOldStream);
    expect(
      (await ownerReq('POST', `/api/teams/${s.team.id}/machines/${mOld}/doubao-login`, {})).status,
    ).toBe(400);

    const sseEvents: Array<{ type: string; machineId?: string; status?: string }> = [];
    const sseUnsubs = s.hub.subscribe(s.team.id, {
      send: async (ev) => {
        const parsed = ev as { type?: string; machineId?: string; status?: string };
        if (parsed.type === 'doubao.login') {
          sseEvents.push({ type: parsed.type, machineId: parsed.machineId, status: parsed.status });
        }
      },
    });
    disposables.push(sseUnsubs);
    s.db.update(machineTable).set({ online: true }).where(eq(machineTable.id, m2)).run();
    const m2Sub = s.machineHub.subscribeMachine(s.team.id, m2, () => {});
    disposables.push(m2Sub);
    const s2New = await ownerReq('POST', `/api/teams/${s.team.id}/machines/${m2}/doubao-login`, {
      force: true,
    });
    expect(s2New.status).toBe(200);
    const s2NewBody = (await s2New.json()) as { session: { loginId: string } };

    expect(
      (
        await s.app.request('/api/machine/doubao-login-event', {
          method: 'POST',
          headers: { authorization: `Bearer ${tok2}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            loginId: s2NewBody.session.loginId,
            status: 'qr',
            revision: 1,
            qrPngBase64: PNG_1X1_B64,
          }),
        })
      ).status,
    ).toBe(200);
    vi.spyOn(s.db, 'transaction').mockImplementationOnce(() => {
      throw new Error('transient sqlite busy');
    });
    expect(
      (
        await s.app.request('/api/machine/doubao-login-event', {
          method: 'POST',
          headers: { authorization: `Bearer ${tok2}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            loginId: s2NewBody.session.loginId,
            status: 'succeeded',
            revision: 2,
          }),
        })
      ).status,
    ).toBe(500);
    const stillQrAfterTxErr = (await (
      await ownerReq('GET', `/api/teams/${s.team.id}/machines/${m2}/doubao-login`)
    ).json()) as { session: { status: string } };
    expect(stillQrAfterTxErr.session.status).toBe('qr');

    const m3 = insertMachine(s, {
      name: 'runner-intersection',
      capabilities: {
        mcpServers: [],
        skills: [],
        doubao: {
          installed: true,
          authenticated: true,
          platformSupported: true,
          probedAt: 120_000,
          models: [
            { id: '4', name: 'Doubao 2.1 Turbo' },
            { id: '5', name: 'Doubao 2.1 Pro' },
          ],
        },
      },
    });
    s.db
      .update(machineTable)
      .set({
        capabilities: {
          mcpServers: [],
          skills: [],
          doubao: {
            installed: true,
            authenticated: true,
            platformSupported: true,
            probedAt: 120_000,
            models: [{ id: '4', name: 'Doubao 2.1 Turbo' }],
          },
        },
      })
      .where(eq(machineTable.id, m1))
      .run();
    const unboundRes = await ownerReq('POST', `/api/teams/${s.team.id}/doubao-subscriptions`, {
      label: '未绑定豆包',
    });
    expect(unboundRes.status).toBe(201);
    const unboundSub = (await unboundRes.json()) as {
      id: string;
      runnerId: string | null;
      models: unknown[];
    };
    expect(unboundSub.runnerId).toBeNull();
    expect(unboundSub.models).toEqual([]);
    const listAfterUnionCheck = (await (
      await ownerReq('GET', `/api/teams/${s.team.id}/doubao-subscriptions`)
    ).json()) as {
      subscriptions: Array<{ id: string; runnerModels: Array<{ id: string }> }>;
    };
    expect(
      listAfterUnionCheck.subscriptions
        .find((x) => x.id === unboundSub.id)
        ?.runnerModels.map((m) => m.id),
    ).toEqual(['4']);
    void m3;

    s.db.update(machineTable).set({ retiredAt: Date.now() }).where(eq(machineTable.id, m2)).run();
    const wakeBeforeRetired = s.machineHub.wakeSeq(s.team.id);
    expect(
      (
        await s.app.request('/api/machine/doubao-login-event', {
          method: 'POST',
          headers: { authorization: `Bearer ${tok2}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            loginId: s2NewBody.session.loginId,
            status: 'succeeded',
            revision: 2,
            doubao: {
              installed: true,
              authenticated: true,
              platformSupported: true,
              probedAt: 99_999,
            },
          }),
        })
      ).status,
    ).toBe(409);
    expect(s.machineHub.wakeSeq(s.team.id)).toBe(wakeBeforeRetired);
    expect(
      s.db.select().from(machineTable).where(eq(machineTable.id, m2)).get()?.capabilities?.doubao
        ?.authenticated,
    ).toBe(false);
    expect(sseEvents.some((e) => e.machineId === m2 && e.status === 'failed')).toBe(true);
  });

  test('server backstop timeout expires stale QR login session and notifies runner', async () => {
    const ownerToken = 'doubao-timeout-owner-token-0123456';
    const s = bootFastServer({
      authToken: ownerToken,
      doubaoLoginTimeoutMs: 40,
      githubFetch: async () => new Response('[]'),
    });
    const m1 = insertMachine(s, {
      name: 'timeout-runner',
      capabilities: {
        mcpServers: [],
        skills: [],
        doubao: { installed: false, authenticated: false, platformSupported: true, probedAt: 100 },
      },
    });
    const pushed: Array<{ type: string; loginId?: string }> = [];
    const rel = s.machineHub.subscribeMachine(s.team.id, m1, (ev) => pushed.push(ev));
    disposables.push(rel);

    const started = await s.app.request(`/api/teams/${s.team.id}/machines/${m1}/doubao-login`, {
      method: 'POST',
      headers: { authorization: `Bearer ${ownerToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(started.status).toBe(200);
    const { session } = (await started.json()) as { session: { loginId: string } };
    await new Promise((r) => setTimeout(r, 80));

    const fetched = await s.app.request(`/api/teams/${s.team.id}/machines/${m1}/doubao-login`, {
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const body = (await fetched.json()) as { session: { status: string; reason?: string } };
    expect(body.session.status).toBe('expired');
    expect(body.session.reason).toBe('expired');
    expect(
      pushed.some((e) => e.type === 'doubao.login.cancel' && e.loginId === session.loginId),
    ).toBe(true);
  });
});
