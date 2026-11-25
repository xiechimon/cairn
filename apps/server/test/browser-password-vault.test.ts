import { createHash } from 'node:crypto';
import type { ComputerCall, ComputerFrame, MachineStreamEvent } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  actionProposal,
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  computerCall as computerCallTable,
  computer as computerTable,
  machine as machineTable,
  pairedDevice,
  step as stepTable,
} from '../src/db/schema.js';
import { proposalCardId } from '../src/services/action-proposals.js';
import {
  hasBrowserPasswordGrant,
  listBrowserPasswordGrants,
  revokeBrowserPasswordGrant,
} from '../src/services/browser-passwords.js';
import {
  dropComputerWaiters,
  forwardComputerCall,
  receiveComputerFrames,
} from '../src/services/machine-computer.js';
import type { MachineDeps } from '../src/services/machine-deps.js';
import {
  createSecret,
  deleteSecret,
  listSecrets,
  openSecretGrants,
  updateSecret,
} from '../src/services/secrets.js';
import { bootServer, req, seedRoute, type TestServer } from './helpers.js';

vi.setConfig({ testTimeout: 30_000 });

const THREAD = 'chief-pair-vault';
const COMPUTER = 'pair-vault-computer';

let server: TestServer | null = null;
afterEach(() => {
  vi.restoreAllMocks();
  dropComputerWaiters();
  server?.dispose();
  server = null;
});

function boot(authToken: string | null = null) {
  const s = bootServer({ authToken });
  server = s;
  const chiefId = `chief-${s.svc.user.id}-${s.team.id}`;
  for (const id of ['sidecar', 'omarchy']) {
    s.db
      .insert(machineTable)
      .values({
        id,
        teamId: s.team.id,
        name: id,
        online: true,
        lastSeenAt: 1,
        capabilities: {
          mcpServers: [],
          skills: [],
          ...(id === 'omarchy' ? { computer: true, browser: true, browserSecretFill: true } : {}),
        },
      })
      .run();
  }
  seedRoute(s, 'coordinator', { provider: 'stub-gw', modelId: 'stub-model', machineId: 'sidecar' });
  s.db
    .insert(chiefTable)
    .values({ id: chiefId, userId: s.svc.user.id, teamId: s.team.id, createdAt: 1 })
    .onConflictDoNothing()
    .run();
  s.db
    .insert(chiefThreadTable)
    .values({
      id: THREAD,
      chiefId,
      userId: s.svc.user.id,
      teamId: s.team.id,
      title: 'vault',
      createdAt: 1,
      updatedAt: 1,
      sessionRuntime: 'pi',
      sessionId: '',
      sessionOpenedAt: 1,
      pendingSessionResumeAt: null,
      toolDefHashes: {},
      toolResultHashes: {},
      activeRun: null,
      archivedAt: 1,
    })
    .run();
  s.db
    .insert(stepTable)
    .values({
      id: 'step-a',
      buildId: THREAD,
      kind: 'chief',
      machineId: 'sidecar',
      status: 'claimed',
      prompt: 'work',
      createdAt: 2,
    })
    .run();
  s.db
    .insert(computerTable)
    .values({
      id: COMPUTER,
      teamId: s.team.id,
      scopeKey: `chief:${chiefId}`,
      machineId: 'omarchy',
      providerRef: 'vault',
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
  const calls: ComputerCall[] = [];
  s.machineHub.subscribeMachine(s.team.id, 'omarchy', (ev: MachineStreamEvent) => {
    if (ev.type === 'computer') calls.push(ev.call);
  });
  const deps: MachineDeps = {
    ...s.svc,
    box: s.secretBox,
    reposDir: s.reposDir,
    attachmentsDir: s.attachmentsDir,
    skillsDir: s.skillsDir,
  };
  return { s, deps, calls };
}

function fill(toolCallId = 'fill', secret = 'LOGIN', origin = 'https://localhost:8443') {
  return {
    computer: true as const,
    name: 'browser_act' as const,
    toolCallId,
    params: { actions: [{ kind: 'fill_secret', ref: 'e1', secret, origin }] },
  };
}

function pendingApproval(s: TestServer) {
  return s.db.select().from(actionProposal).where(eq(actionProposal.status, 'pending')).get()!;
}

async function answer(s: TestServer, id: string, headers: Record<string, string> = {}) {
  const res = await s.app.request(
    `/api/teams/${s.team.id}/chief/threads/${THREAD}/questions/${proposalCardId(id)}/answer`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...headers },
      body: JSON.stringify({ answers: [{ header: '网站授权', choices: ['批准执行'] }] }),
    },
  );
  expect(res.status).toBe(200);
}

async function grantFill(
  s: TestServer,
  deps: MachineDeps,
  calls: ComputerCall[],
  toolCallId: string,
) {
  const pending = forwardComputerCall(deps, 'sidecar', 'step-a', fill(toolCallId));
  const call = calls.at(-1)!;
  receiveComputerFrames(s.db, s.hub, 'omarchy', call.callId, [done(1)], s.secretBox);
  return pending;
}

function done(seq: number): ComputerFrame {
  return { kind: 'done', seq, text: 'ok' };
}

describe('username+password pair secrets', () => {
  test('a pair round-trips as one entry and a fill dispatches both fields', async () => {
    const { s, deps, calls } = boot();
    const saved = createSecret(deps, {
      teamId: s.team.id,
      name: 'LOGIN',
      value: 'synthetic-password',
      username: 'synthetic-user',
      kind: 'pair',
    });
    expect(saved.kind).toBe('pair');
    expect(saved.delivery).toBe('plaintext');
    expect(listSecrets(deps, s.team.id)).toEqual([
      expect.objectContaining({ id: saved.id, kind: 'pair', name: 'LOGIN' }),
    ]);
    expect(openSecretGrants(deps, s.team.id, [saved.id], null).values).toEqual({
      LOGIN: JSON.stringify({ username: 'synthetic-user', password: 'synthetic-password' }),
    });
    const first = await forwardComputerCall(deps, 'sidecar', 'step-a', fill());
    expect(first.text).toContain('尚未代填');
    await answer(s, pendingApproval(s).id);
    await grantFill(s, deps, calls, 'pair-fill');
    expect(calls.at(-1)?.browserSecrets).toEqual([
      {
        name: 'LOGIN',
        origin: 'https://localhost:8443',
        value: 'synthetic-password',
        username: 'synthetic-user',
      },
    ]);
    expect(JSON.stringify(calls.at(-1)?.params)).not.toContain('synthetic-user');
    expect(JSON.stringify(calls.at(-1)?.params)).not.toContain('synthetic-password');
    expect(JSON.stringify(s.db.select().from(computerCallTable).all())).not.toContain(
      'synthetic-user',
    );
  });

  test('browser results redact both pair fields and their encoded forms', async () => {
    const { s, deps, calls } = boot();
    const password = 'synthetic "password" \\+&';
    const username = 'user"name+tag@example.com';
    createSecret(deps, {
      teamId: s.team.id,
      name: 'LOGIN',
      value: password,
      username,
      kind: 'pair',
    });
    await forwardComputerCall(deps, 'sidecar', 'step-a', fill());
    await answer(s, pendingApproval(s).id);
    await grantFill(s, deps, calls, 'granted');
    const forms = [password, username].flatMap((value) => [
      value,
      encodeURIComponent(value),
      new URLSearchParams({ v: value }).toString().slice(2),
      JSON.stringify(value).slice(1, -1),
    ]);
    const pending = forwardComputerCall(deps, 'sidecar', 'step-a', {
      computer: true,
      name: 'browser_snapshot',
      toolCallId: 'leak',
      params: {},
    });
    const call = calls.at(-1)!;
    receiveComputerFrames(
      s.db,
      s.hub,
      'omarchy',
      call.callId,
      [{ kind: 'error', seq: 1, message: forms.join('\n'), delivery: 'unknown' }],
      s.secretBox,
    );
    const result = await pending;
    for (const form of forms) expect(result.text).not.toContain(form);
    expect(result.text).toContain('[REDACTED');
    const row = s.db
      .select()
      .from(computerCallTable)
      .where(eq(computerCallTable.id, call.callId))
      .get();
    for (const form of forms) expect(JSON.stringify(row)).not.toContain(form);
  });

  test('pair kind validation: username required, plaintext only, no username on plain kinds', () => {
    const { s, deps } = boot();
    expect(() =>
      createSecret(deps, { teamId: s.team.id, name: 'LOGIN', value: 'pw', kind: 'pair' }),
    ).toThrow('needs a username');
    expect(() =>
      createSecret(deps, {
        teamId: s.team.id,
        name: 'LOGIN',
        value: 'pw',
        username: 'u',
        kind: 'pair',
        delivery: 'http',
        http: { origin: 'https://api.example.com', header: 'x-key', template: '{secret}' },
      }),
    ).toThrow('cannot use http delivery');
    expect(() =>
      createSecret(deps, {
        teamId: s.team.id,
        name: 'LOGIN',
        value: 'pw',
        username: 'u',
      }),
    ).toThrow('only a username+password pair takes a username');
    expect(() =>
      createSecret(deps, {
        teamId: s.team.id,
        name: 'LOGIN',
        value: '',
        username: 'u',
        kind: 'pair',
      }),
    ).toThrow('cannot be empty');
  });

  test('pair updates keep both fields and rotate the grant revision', async () => {
    const { s, deps, calls } = boot();
    const saved = createSecret(deps, {
      teamId: s.team.id,
      name: 'LOGIN',
      value: 'synthetic-password',
      username: 'synthetic-user',
      kind: 'pair',
    });
    const rotatedUser = updateSecret(deps, s.team.id, saved.id, { username: 'next-user' });
    expect(rotatedUser.kind).toBe('pair');
    expect(rotatedUser.policyRevision).toBe(2);
    await forwardComputerCall(deps, 'sidecar', 'step-a', fill());
    await answer(s, pendingApproval(s).id);
    await grantFill(s, deps, calls, 'fill-a');
    expect(calls.at(-1)?.browserSecrets?.[0]).toMatchObject({
      value: 'synthetic-password',
      username: 'next-user',
    });
    const converted = updateSecret(deps, s.team.id, saved.id, { kind: 'secret' });
    expect(converted.kind).toBe('secret');
    expect(openSecretGrants(deps, s.team.id, [saved.id], null)).toEqual({ values: {}, http: [] });
    const again = updateSecret(deps, s.team.id, saved.id, { kind: 'pair', username: 're-paired' });
    expect(again.kind).toBe('pair');
    expect(() =>
      updateSecret(deps, s.team.id, saved.id, { kind: 'secret', username: 'stray' }),
    ).toThrow('only a username+password pair takes a username');
    expect(() => updateSecret(deps, s.team.id, saved.id, { username: '' })).toThrow(
      'needs a username',
    );
  });

  test('a plain secret can become a pair with a username patch', () => {
    const { s, deps } = boot();
    const saved = createSecret(deps, { teamId: s.team.id, name: 'LOGIN', value: 'pw' });
    expect(() => updateSecret(deps, s.team.id, saved.id, { kind: 'pair' })).toThrow(
      'needs a username',
    );
    const paired = updateSecret(deps, s.team.id, saved.id, { kind: 'pair', username: 'site-user' });
    expect(paired.kind).toBe('pair');
    expect(paired.policyRevision).toBe(2);
  });
});

describe('browser password grants', () => {
  test('the grant list shows secret, origin and machine with state; revoke blocks the fill again', async () => {
    const { s, deps, calls } = boot();
    createSecret(deps, { teamId: s.team.id, name: 'LOGIN', value: 'synthetic-password' });
    await forwardComputerCall(deps, 'sidecar', 'step-a', fill());
    await answer(s, pendingApproval(s).id);
    expect(listBrowserPasswordGrants(s.db, s.team.id)).toEqual([
      expect.objectContaining({
        secretName: 'LOGIN',
        origin: 'https://localhost:8443',
        machineId: 'omarchy',
        machineName: 'omarchy',
        state: 'active',
        revokedAt: null,
      }),
    ]);
    const grant = listBrowserPasswordGrants(s.db, s.team.id)[0]!;
    expect(grant.grantedAt).toEqual(expect.any(Number));
    const res = await req(s.app, 'GET', `/api/teams/${s.team.id}/browser-password-grants`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { grants: unknown[] }).grants).toHaveLength(1);
    const revoke = await req(
      s.app,
      'DELETE',
      `/api/teams/${s.team.id}/browser-password-grants/${grant.grantId}`,
    );
    expect(revoke.status).toBe(204);
    expect(listBrowserPasswordGrants(s.db, s.team.id)).toEqual([
      expect.objectContaining({ grantId: grant.grantId, state: 'revoked' }),
    ]);
    expect(
      hasBrowserPasswordGrant(s.db, s.team.id, {
        secretId: grant.secretId,
        revision: 1,
        origin: 'https://localhost:8443',
        machineId: 'omarchy',
      }),
    ).toBe(false);
    const retried = await forwardComputerCall(deps, 'sidecar', 'step-a', fill('after-revoke'));
    expect(retried.text).toContain('尚未代填');
    expect(calls).toHaveLength(0);
    expect(pendingApproval(s).id).not.toBe(grant.grantId);
    expect(
      (
        await req(
          s.app,
          'DELETE',
          `/api/teams/${s.team.id}/browser-password-grants/${grant.grantId}`,
        )
      ).status,
    ).toBe(404);
    expect(
      (await req(s.app, 'DELETE', `/api/teams/${s.team.id}/browser-password-grants/nope`)).status,
    ).toBe(404);
  });

  test('a rotated or deleted secret leaves a stale grant in the list', async () => {
    const { s, deps } = boot();
    const saved = createSecret(deps, { teamId: s.team.id, name: 'LOGIN', value: 'one' });
    await forwardComputerCall(deps, 'sidecar', 'step-a', fill());
    await answer(s, pendingApproval(s).id);
    updateSecret(deps, s.team.id, saved.id, { value: 'two' });
    expect(listBrowserPasswordGrants(s.db, s.team.id)[0]).toMatchObject({ state: 'stale' });
    deleteSecret(deps, s.team.id, saved.id);
    expect(listBrowserPasswordGrants(s.db, s.team.id)[0]).toMatchObject({
      state: 'stale',
      secretName: null,
    });
    const grant = listBrowserPasswordGrants(s.db, s.team.id)[0]!;
    revokeBrowserPasswordGrant(s.db, s.team.id, grant.grantId);
    expect(listBrowserPasswordGrants(s.db, s.team.id)[0]).toMatchObject({
      state: 'revoked',
      revokedAt: expect.any(Number),
    });
  });

  test('grant endpoints admit a paired device bearer token like the owner session', async () => {
    const { s, deps } = boot('synthetic-owner-token');
    s.db
      .insert(pairedDevice)
      .values({
        id: 'paired-phone',
        teamId: s.team.id,
        name: 'phone',
        tokenHash: createHash('sha256').update('cairn_dev_synthetic').digest('hex'),
        masked: 'synthetic-device',
        createdAt: Date.now(),
      })
      .run();
    createSecret(deps, { teamId: s.team.id, name: 'LOGIN', value: 'synthetic-password' });
    await forwardComputerCall(deps, 'sidecar', 'step-a', fill());
    await answer(s, pendingApproval(s).id, {
      authorization: 'Bearer synthetic-owner-token',
    });
    const grant = listBrowserPasswordGrants(s.db, s.team.id)[0]!;
    const headers = { authorization: 'Bearer cairn_dev_synthetic' };
    const listed = await s.app.request(`/api/teams/${s.team.id}/browser-password-grants`, {
      headers,
    });
    expect(listed.status).toBe(200);
    const revoked = await s.app.request(
      `/api/teams/${s.team.id}/browser-password-grants/${grant.grantId}`,
      { method: 'DELETE', headers },
    );
    expect(revoked.status).toBe(204);
    expect(listBrowserPasswordGrants(s.db, s.team.id)[0]).toMatchObject({ state: 'revoked' });
  });
});
