import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import {
  antigravitySubscription as antigravitySubscriptionTable,
  build as buildTable,
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  machine as machineTable,
  step as stepTable,
  team as teamTable,
} from '../src/db/schema.js';
import { setCoordinatorInServer } from '../src/services/coordinator-context.js';
import { claimPendingChiefStep } from '../src/services/coordinator-steps.js';
import { antigravityUsable } from '../src/services/dispatch-eligibility.js';
import * as machineRouting from '../src/services/machine-routing.js';
import { claimStep, stepToken } from '../src/services/machines.js';
import { stepQueueProjector } from '../src/services/step-queue.js';
import {
  bootServer,
  insertAntigravitySubscription,
  insertMachine,
  postProject,
  req,
  seedRoute,
  type TestServer,
} from './helpers.js';

const disposables: (() => void)[] = [];
afterEach(() => {
  for (const d of disposables.splice(0)) d();
  setCoordinatorInServer(false);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function claim(s: TestServer, machineId: string) {
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

describe('Antigravity dispatch, worker claim, and Coordinator claim', () => {
  test('antigravityUsable truth table for host-keyring vs token fallback', () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());

    const machineId = insertMachine(s, {
      name: 'agy-host',
      capabilities: {
        mcpServers: [],
        skills: [],
        antigravity: { installed: true, authenticated: false },
      },
    });
    expect(machineId).toBeDefined();
    expect(antigravityUsable(s.db, s.team.id)).toBe(false);

    const hostSubId = insertAntigravitySubscription(s, { label: 'Host', token: null });
    expect(antigravityUsable(s.db, s.team.id)).toBe(false);

    insertMachine(s, {
      name: 'agy-host-authed',
      capabilities: {
        mcpServers: [],
        skills: [],
        antigravity: { installed: true, authenticated: true },
      },
    });
    expect(antigravityUsable(s.db, s.team.id)).toBe(false);

    s.db
      .update(machineTable)
      .set({
        capabilities: {
          mcpServers: [],
          skills: [],
          antigravity: { installed: true, authenticated: true },
        },
      })
      .where(eq(machineTable.id, machineId))
      .run();
    expect(antigravityUsable(s.db, s.team.id)).toBe(true);

    s.db
      .update(antigravitySubscriptionTable)
      .set({ enabledAt: null })
      .where(eq(antigravitySubscriptionTable.id, hostSubId))
      .run();
    const tokenSubId = insertAntigravitySubscription(s, {
      label: 'Token',
      token: `AIzaSyA${'t'.repeat(28)}`,
    });
    expect(tokenSubId).toBeDefined();
    expect(antigravityUsable(s.db, s.team.id)).toBe(true);
  });

  test('claims host-keyring work only on its bound Runner and omits antigravityToken', async () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());

    const otherRunner = insertMachine(s, {
      name: 'agy-other',
      capabilities: {
        mcpServers: [],
        skills: [],
        antigravity: { installed: true, authenticated: true },
      },
    });
    const authMachine = insertMachine(s, {
      name: 'agy-auth',
      capabilities: {
        mcpServers: [],
        skills: [],
        antigravity: { installed: true, authenticated: true },
      },
    });

    const created = await req(s.app, 'POST', `/api/teams/${s.team.id}/antigravity-subscriptions`, {
      label: 'Keyring',
      runnerId: authMachine,
    });
    expect(created.status).toBe(201);
    const { id: subId } = (await created.json()) as { id: string };
    const projectId = await postProject(s.app, 'ag-worker');
    const todo = (await (
      await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
        title: 'Task',
        spec: 'Spec',
      })
    ).json()) as { id: string };
    s.db
      .insert(buildTable)
      .values({
        id: 'b1',
        todoId: todo.id,
        withPlan: false,
        planDocId: null,
        triggerSource: 'user',
        createdAt: 1,
      })
      .run();
    s.db
      .insert(stepTable)
      .values({ id: 's1', buildId: 'b1', kind: 'build', status: 'pending', createdAt: 2 })
      .run();

    seedRoute(s, 'session', {
      provider: 'antigravity',
      modelId: 'gemini-4-carbon',
      machineId: otherRunner,
    });
    await expect(claim(s, otherRunner)).resolves.toBeNull();

    s.db
      .update(teamTable)
      .set({ defaultMachineId: otherRunner })
      .where(eq(teamTable.id, s.team.id))
      .run();
    seedRoute(s, 'session', {
      provider: 'antigravity',
      modelId: 'gemini-4-carbon',
      machineId: null,
    });
    const queued = stepQueueProjector(s.db, s.team.id).project({
      id: 's1',
      createdAt: 2,
      homeMachineId: null,
      holdReason: null,
      holdUntil: null,
    });
    expect(queued?.waitingFor?.machineId).toBe(authMachine);

    const expiry = Date.now() + 60_000;
    s.db
      .update(antigravitySubscriptionTable)
      .set({ expiresAt: expiry })
      .where(eq(antigravitySubscriptionTable.id, subId))
      .run();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(expiry - 1);
    const eligibility = machineRouting.workerIneligibility;
    const beforeExpiry = vi
      .spyOn(machineRouting, 'workerIneligibility')
      .mockImplementationOnce((...args) => {
        const result = eligibility(...args);
        expect(result).toBeNull();
        clock.mockReturnValue(expiry);
        return result;
      });
    await expect(claim(s, authMachine)).resolves.toBeNull();
    expect(beforeExpiry).toHaveBeenCalled();
    expect(s.db.select().from(stepTable).where(eq(stepTable.id, 's1')).get()).toMatchObject({
      status: 'pending',
      antigravitySubscriptionId: null,
    });
    clock.mockRestore();
    beforeExpiry.mockRestore();
    s.db
      .update(antigravitySubscriptionTable)
      .set({ expiresAt: null })
      .where(eq(antigravitySubscriptionTable.id, subId))
      .run();
    const claimed = await claim(s, authMachine);
    expect(claimed?.agent).toMatchObject({
      provider: 'antigravity',
      modelId: 'gemini-4-carbon',
    });
    expect(
      s.db.select().from(stepTable).where(eq(stepTable.id, 's1')).get()?.antigravitySubscriptionId,
    ).toBe(subId);

    const tokenRes = await stepToken(
      { ...s.svc, box: s.secretBox, attachmentsDir: s.attachmentsDir, reposDir: s.reposDir },
      authMachine,
      's1',
    );
    expect(tokenRes.antigravityToken).toBeUndefined();
  });

  test('an unpinned Coordinator uses the bound Runner instead of the team default', async () => {
    const s = bootServer();
    disposables.push(() => s.dispose());
    const capabilities = {
      mcpServers: [],
      skills: [],
      antigravity: { installed: true, authenticated: true },
    };
    const otherRunner = insertMachine(s, { name: 'chief-default', capabilities });
    const runnerId = insertMachine(s, { name: 'chief-bound', capabilities });
    s.db
      .update(teamTable)
      .set({ defaultMachineId: otherRunner })
      .where(eq(teamTable.id, s.team.id))
      .run();
    const created = await req(s.app, 'POST', `/api/teams/${s.team.id}/antigravity-subscriptions`, {
      label: 'Bound',
      runnerId,
    });
    expect(created.status).toBe(201);
    seedRoute(s, 'coordinator', {
      provider: 'antigravity',
      modelId: 'gemini-4-carbon',
      machineId: null,
    });
    s.db
      .insert(chiefTable)
      .values({ id: 'c1', userId: s.svc.user.id, teamId: s.team.id, createdAt: 1 })
      .run();
    s.db
      .insert(chiefThreadTable)
      .values({
        id: 'chief-ag-1',
        chiefId: 'c1',
        userId: s.svc.user.id,
        teamId: s.team.id,
        title: 'coord',
        createdAt: 2,
        updatedAt: 2,
        sessionId: '',
        sessionOpenedAt: 2,
      })
      .run();
    s.db
      .insert(stepTable)
      .values({ id: 'cs1', buildId: 'chief-ag-1', kind: 'chief', status: 'pending', createdAt: 3 })
      .run();
    await expect(claim(s, otherRunner)).resolves.toBeNull();
    await expect(claim(s, runnerId)).resolves.toMatchObject({ step: { id: 'cs1' } });
  });

  test('claims Coordinator chief step with token fallback, delivers antigravityToken, and resets session on switch', async () => {
    setCoordinatorInServer(true);
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());

    const tokenA = `AIzaSyA${'a'.repeat(28)}`;
    const tokenB = `AIzaSyB${'b'.repeat(28)}`;
    const subA = insertAntigravitySubscription(s, { label: 'Account A', token: tokenA });
    const machineId = insertMachine(s, {
      name: 'agy-coord',
      capabilities: {
        mcpServers: [],
        skills: [],
        antigravity: { installed: true, authenticated: false },
      },
    });
    seedRoute(s, 'coordinator', {
      provider: 'antigravity',
      modelId: 'gemini-4-carbon',
      machineId,
    });
    s.db
      .insert(chiefTable)
      .values({ id: 'c1', userId: s.svc.user.id, teamId: s.team.id, createdAt: 1 })
      .run();
    s.db
      .insert(chiefThreadTable)
      .values({
        id: 'chief-ag-1',
        chiefId: 'c1',
        userId: s.svc.user.id,
        teamId: s.team.id,
        title: 'coord',
        createdAt: 2,
        updatedAt: 2,
        sessionId: '',
        sessionOpenedAt: 2,
      })
      .run();
    s.db
      .insert(stepTable)
      .values({ id: 'cs1', buildId: 'chief-ag-1', kind: 'chief', status: 'pending', createdAt: 3 })
      .run();

    const pending = s.db.select().from(stepTable).where(eq(stepTable.id, 'cs1')).get();
    if (pending === undefined) throw new Error('Missing pending Coordinator step');
    const now = Date.now();
    s.db
      .update(antigravitySubscriptionTable)
      .set({ expiresAt: now })
      .where(eq(antigravitySubscriptionTable.id, subA))
      .run();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    expect(
      claimPendingChiefStep(s.db, pending, {
        machineId,
        bind: { runtime: 'antigravity', teamId: s.team.id },
        model: { provider: 'antigravity', modelId: 'gemini-4-carbon', thinkingLevel: null },
      }),
    ).toBeNull();
    expect(s.db.select().from(stepTable).where(eq(stepTable.id, 'cs1')).get()?.status).toBe(
      'pending',
    );
    clock.mockRestore();
    s.db
      .update(antigravitySubscriptionTable)
      .set({ expiresAt: null })
      .where(eq(antigravitySubscriptionTable.id, subA))
      .run();

    const firstClaim = await claim(s, machineId);
    expect(firstClaim?.agent).toMatchObject({
      provider: 'antigravity',
      modelId: 'gemini-4-carbon',
    });
    expect(
      s.db.select().from(stepTable).where(eq(stepTable.id, 'cs1')).get()?.antigravitySubscriptionId,
    ).toBe(subA);

    const firstToken = await stepToken(
      { ...s.svc, box: s.secretBox, attachmentsDir: s.attachmentsDir, reposDir: s.reposDir },
      machineId,
      'cs1',
    );
    expect(firstToken.antigravityToken).toBe(tokenA);

    s.db
      .update(chiefThreadTable)
      .set({ sessionId: 'ag-sess-1' })
      .where(eq(chiefThreadTable.id, 'chief-ag-1'))
      .run();
    s.db
      .update(stepTable)
      .set({ status: 'done', sessionId: 'ag-sess-1' })
      .where(eq(stepTable.id, 'cs1'))
      .run();

    const subB = insertAntigravitySubscription(s, { label: 'Account B', token: tokenB });
    s.db
      .update(antigravitySubscriptionTable)
      .set({ enabledAt: null })
      .where(eq(antigravitySubscriptionTable.id, subA))
      .run();
    s.db
      .update(antigravitySubscriptionTable)
      .set({ enabledAt: 99 })
      .where(eq(antigravitySubscriptionTable.id, subB))
      .run();

    s.db
      .insert(stepTable)
      .values({ id: 'cs2', buildId: 'chief-ag-1', kind: 'chief', status: 'pending', createdAt: 10 })
      .run();

    const secondClaim = await claim(s, machineId);
    expect(secondClaim?.session).toEqual({ action: 'new', sessionId: null });
    const secondToken = await stepToken(
      { ...s.svc, box: s.secretBox, attachmentsDir: s.attachmentsDir, reposDir: s.reposDir },
      machineId,
      'cs2',
    );
    expect(secondToken.antigravityToken).toBe(tokenB);
  });

  test('unauthenticated Runner claims worker and chief steps with portable OAuth and receives antigravityToken only while claimed', async () => {
    setCoordinatorInServer(true);
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());

    const refreshToken = `1//0gPortableClaim_${'p'.repeat(36)}`;
    const accessToken = `ya29.${'p'.repeat(64)}`;
    const prevBin = process.env.AGY_BIN;
    const binDir = makeTestTempDir('agy-claim-portable-');
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
        'import { readFileSync, writeFileSync } from "node:fs";',
        'import { createInterface } from "node:readline";',
        'const send = (o) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...o }) + "\\n");',
        'const tokenPath = process.env.HOME + "/.gemini/antigravity-acp/antigravity-oauth-token";',
        'const tok = JSON.parse(readFileSync(tokenPath, "utf8"));',
        'for await (const line of createInterface({ input: process.stdin })) {',
        '  const m = JSON.parse(line);',
        '  if (m.method === "initialize") send({ id: m.id, result: { protocolVersion: 1 } });',
        '  if (m.method === "session/new") {',
        `    tok.token.access_token = "${accessToken}";`,
        '    tok.token.expiry = new Date(Date.now() + 3600000).toISOString();',
        '    writeFileSync(tokenPath, JSON.stringify(tok));',
        '    send({ id: m.id, result: { sessionId: "ok" } });',
        '  }',
        '}',
        "'",
      ].join('\n'),
      { mode: 0o755 },
    );
    process.env.AGY_BIN = fakeBin;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ expires_in: '3600', sub: 'sub-claim-portable' })),
    );

    const created = await req(s.app, 'POST', `/api/teams/${s.team.id}/antigravity-subscriptions`, {
      label: 'Portable Google',
      refreshToken,
      authMethod: 'consumer',
    });
    expect(created.status).toBe(201);
    const { id: subId } = (await created.json()) as { id: string };
    const unauthMachine = insertMachine(s, {
      name: 'mac-mini-no-login',
      capabilities: {
        mcpServers: [],
        skills: [],
        antigravityOAuthProfile: true,
        antigravity: { installed: true, authenticated: false },
      },
    });
    expect(antigravityUsable(s.db, s.team.id)).toBe(true);

    const projectId = await postProject(s.app, 'ag-portable');
    const todo = (await (
      await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
        title: 'Portable Task',
        spec: 'Run on mini without host login',
      })
    ).json()) as { id: string };
    s.db
      .insert(buildTable)
      .values({
        id: 'b-port',
        todoId: todo.id,
        withPlan: false,
        planDocId: null,
        triggerSource: 'user',
        createdAt: 1,
      })
      .run();
    s.db
      .insert(stepTable)
      .values({ id: 's-port', buildId: 'b-port', kind: 'build', status: 'pending', createdAt: 2 })
      .run();

    seedRoute(s, 'session', {
      provider: 'antigravity',
      modelId: 'gemini-4-carbon',
      machineId: unauthMachine,
    });
    const workerClaim = await claim(s, unauthMachine);
    expect(workerClaim?.agent).toMatchObject({
      provider: 'antigravity',
      modelId: 'gemini-4-carbon',
    });
    expect(
      s.db.select().from(stepTable).where(eq(stepTable.id, 's-port')).get()
        ?.antigravitySubscriptionId,
    ).toBe(subId);

    const workerToken = await stepToken(
      { ...s.svc, box: s.secretBox, attachmentsDir: s.attachmentsDir, reposDir: s.reposDir },
      unauthMachine,
      's-port',
    );
    expect(workerToken.antigravityToken).toBeDefined();
    expect(JSON.parse(workerToken.antigravityToken ?? '')).toMatchObject({
      kind: 'oauth-personal',
      refreshToken,
      authMethod: 'consumer',
      token: accessToken,
    });

    s.db
      .update(stepTable)
      .set({ status: 'done', finishedAt: 5 })
      .where(eq(stepTable.id, 's-port'))
      .run();
    const afterDoneToken = await stepToken(
      { ...s.svc, box: s.secretBox, attachmentsDir: s.attachmentsDir, reposDir: s.reposDir },
      unauthMachine,
      's-port',
    );
    expect(afterDoneToken.antigravityToken).toBeUndefined();

    seedRoute(s, 'coordinator', {
      provider: 'antigravity',
      modelId: 'gemini-4-carbon',
      machineId: unauthMachine,
    });
    s.db
      .insert(chiefTable)
      .values({ id: 'c-port', userId: s.svc.user.id, teamId: s.team.id, createdAt: 1 })
      .run();
    s.db
      .insert(chiefThreadTable)
      .values({
        id: 'chief-port-1',
        chiefId: 'c-port',
        userId: s.svc.user.id,
        teamId: s.team.id,
        title: 'coord portable',
        createdAt: 2,
        updatedAt: 2,
        sessionId: '',
        sessionOpenedAt: 2,
      })
      .run();
    s.db
      .insert(stepTable)
      .values({
        id: 'cs-port',
        buildId: 'chief-port-1',
        kind: 'chief',
        status: 'pending',
        createdAt: 3,
      })
      .run();

    const chiefClaim = await claim(s, unauthMachine);
    expect(chiefClaim?.agent).toMatchObject({ provider: 'antigravity' });
    const chiefToken = await stepToken(
      { ...s.svc, box: s.secretBox, attachmentsDir: s.attachmentsDir, reposDir: s.reposDir },
      unauthMachine,
      'cs-port',
    );
    expect(chiefToken.antigravityToken).toBeDefined();
    expect(JSON.parse(chiefToken.antigravityToken ?? '')).toMatchObject({
      kind: 'oauth-personal',
      refreshToken,
      authMethod: 'consumer',
      token: accessToken,
    });
  });
});
