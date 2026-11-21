import { createHash } from 'node:crypto';
import type { ComputerCall, ComputerFrame, MachineStreamEvent } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test, vi } from 'vitest';
import webpush from 'web-push';
import {
  actionProposal,
  chiefMessage,
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  computerCall as computerCallTable,
  computer as computerTable,
  machine as machineTable,
  pairedDevice,
  pushDelivery,
  pushSubscription,
  secret,
  step as stepTable,
} from '../src/db/schema.js';
import { proposalCardId, sweepExpiredActionProposals } from '../src/services/action-proposals.js';
import { issueBrowserSession } from '../src/services/browser-session.js';
import { askQuestionContentOf } from '../src/services/chief-question-store.js';
import {
  acquireComputerControl,
  releaseComputerControl,
} from '../src/services/computer-control.js';
import { sweepComputerHandoffs } from '../src/services/computer-handoff.js';
import {
  dropComputerWaiters,
  forwardComputerCall,
  receiveComputerFrames,
  stopStepComputer,
} from '../src/services/machine-computer.js';
import type { MachineDeps } from '../src/services/machine-deps.js';
import { executeRelayToolCall } from '../src/services/machine-relay.js';
import {
  createSecret,
  deleteSecret,
  openSecretGrants,
  updateSecret,
} from '../src/services/secrets.js';
import { bootServer, req, seedRoute, type TestServer } from './helpers.js';

vi.setConfig({ testTimeout: 30_000 });

const THREAD = 'chief-handoff-thread';
const COMPUTER = 'handoff-computer';
const HANDED_BACK =
  'The owner handed the computer back. Take a fresh browser_snapshot before acting.';
const NOT_DONE = 'The owner did not finish. This step is not done. Stop and tell the owner.';
const FAST = { takeover: { timeoutMs: 60_000, pollMs: 5 } };

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
      title: 'handoff',
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
      providerRef: 'handoff',
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

function browser(name: 'browser_navigate' | 'browser_snapshot', toolCallId: string) {
  return { computer: true as const, name, toolCallId, params: {} };
}

function fill(toolCallId = 'fill', origin = 'https://localhost:8443') {
  return {
    computer: true as const,
    name: 'browser_act' as const,
    toolCallId,
    params: { actions: [{ kind: 'fill_secret', ref: 'e1', secret: 'LOGIN', origin }] },
  };
}

function pendingApproval(s: TestServer) {
  return s.db.select().from(actionProposal).where(eq(actionProposal.status, 'pending')).get()!;
}

function answer(
  s: TestServer,
  id: string,
  choice = '批准执行',
  headers: Record<string, string> = { 'sec-fetch-site': 'same-origin' },
) {
  return s.app.request(
    `/api/teams/${s.team.id}/chief/threads/${THREAD}/questions/${proposalCardId(id)}/answer`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ answers: [{ header: '网站授权', choices: [choice] }] }),
    },
  );
}

function takeover(toolCallId = 'tk-1', reason = 'log in to the job board') {
  return {
    computer: true as const,
    name: 'request_takeover' as const,
    toolCallId,
    params: { reason },
  };
}

function computerRow(s: TestServer) {
  return s.db.select().from(computerTable).where(eq(computerTable.id, COMPUTER)).get()!;
}

function setHandoff(s: TestServer, patch: Partial<typeof computerTable.$inferInsert>) {
  s.db.update(computerTable).set(patch).where(eq(computerTable.id, COMPUTER)).run();
}

function takeoverRow(s: TestServer) {
  return s.db
    .select()
    .from(computerCallTable)
    .where(eq(computerCallTable.tool, 'request_takeover'))
    .get();
}

async function waitForPending(s: TestServer) {
  await vi.waitFor(() => expect(computerRow(s).handoffReason).toBe('model'));
}

function done(seq: number, loginForm?: { signals: ('password' | 'challenge')[] }): ComputerFrame {
  return { kind: 'done', seq, text: 'ok', ...(loginForm ? { loginForm } : {}) };
}

function track<T>(promise: Promise<T>) {
  const state = { settled: false };
  void promise.then(
    () => {
      state.settled = true;
    },
    () => {
      state.settled = true;
    },
  );
  return state;
}

describe('login handoff gate', () => {
  test('a later browser result or error redacts all current browser passwords, including encoded forms', async () => {
    const { s, deps, calls } = boot();
    const value = 'synthetic "password" \\+&';
    createSecret(deps, {
      teamId: s.team.id,
      name: 'LOGIN',
      value,
    });
    await forwardComputerCall(deps, 'sidecar', 'step-a', fill());
    const forms = [
      value,
      encodeURIComponent(value),
      new URLSearchParams({ v: value }).toString().slice(2),
      JSON.stringify(value).slice(1, -1),
    ];
    for (const error of [false, true]) {
      const pending = forwardComputerCall(
        deps,
        'sidecar',
        'step-a',
        browser('browser_snapshot', `reveal-${error}`),
      );
      const call = calls.at(-1)!;
      receiveComputerFrames(
        s.db,
        s.hub,
        'omarchy',
        call.callId,
        [
          error
            ? { kind: 'error', seq: 1, message: forms.join('\n'), delivery: 'unknown' }
            : { kind: 'done', seq: 1, text: forms.join('\n') },
        ],
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
    }
  });

  test('first use asks once in chat without decrypting; owner approval permits same-site fills', async () => {
    const { s, deps, calls } = boot();
    const value = 'synthetic-login-password';
    const saved = createSecret(deps, { teamId: s.team.id, name: 'LOGIN', value });
    const open = vi.spyOn(deps.box, 'open');
    expect((await forwardComputerCall(deps, 'sidecar', 'step-a', fill())).text).toContain(
      '尚未代填',
    );
    const proposal = pendingApproval(s);
    await forwardComputerCall(deps, 'sidecar', 'step-a', fill('again'));
    expect(pendingApproval(s).id).toBe(proposal.id);
    expect(calls).toHaveLength(0);
    expect(s.db.select().from(computerCallTable).all()).toEqual([]);
    expect(computerRow(s).executionStepId).toBeNull();
    expect(open).not.toHaveBeenCalled();
    const card = askQuestionContentOf(
      s.db
        .select()
        .from(chiefMessage)
        .where(eq(chiefMessage.id, proposalCardId(proposal.id)))
        .get()?.content,
    );
    expect(card?.questions[0]?.question).toContain('https://localhost:8443');
    expect(card?.questions[0]?.question).toContain('之后在这台电脑的同一网站自动可用');
    expect(card?.questions[0]?.question).not.toContain(value);
    expect(openSecretGrants(deps, s.team.id, [saved.id], null)).toEqual({ values: {}, http: [] });
    expect((await answer(s, proposal.id)).status).toBe(200);
    for (const toolCallId of ['approved', 'same-site-again']) {
      const pending = forwardComputerCall(deps, 'sidecar', 'step-a', fill(toolCallId));
      const call = calls.at(-1)!;
      expect(call.browserSecrets).toEqual([
        { name: 'LOGIN', origin: 'https://localhost:8443', value },
      ]);
      expect(JSON.stringify(call.params)).not.toContain(value);
      receiveComputerFrames(s.db, s.hub, 'omarchy', call.callId, [done(1)], s.secretBox);
      await pending;
    }
    expect(s.db.select().from(actionProposal).all()).toHaveLength(1);
    expect(JSON.stringify(s.db.select().from(computerCallTable).all())).not.toContain(value);
    expect(JSON.stringify(s.db.select().from(actionProposal).all())).not.toContain(value);
  });

  test.each(['bearer', 'session'] as const)(
    'a paired %s cannot approve a password website, but the owner can',
    async (kind) => {
      const ownerToken = 'synthetic-owner-token';
      const deviceToken = 'cairn_dev_synthetic-device-token';
      const { s, deps, calls } = boot(ownerToken);
      s.db
        .insert(pairedDevice)
        .values({
          id: 'paired-phone',
          teamId: s.team.id,
          name: 'phone',
          tokenHash: createHash('sha256').update(deviceToken).digest('hex'),
          masked: 'synthetic-device',
          createdAt: Date.now(),
        })
        .run();
      createSecret(deps, { teamId: s.team.id, name: 'LOGIN', value: 'synthetic-password' });
      await forwardComputerCall(deps, 'sidecar', 'step-a', fill());
      const pending = pendingApproval(s);
      const path = `/api/teams/${s.team.id}/chief/threads/${THREAD}/questions/${proposalCardId(pending.id)}/answer`;
      const post = (headers: Record<string, string>) =>
        s.app.request(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify({ answers: [{ header: '网站授权', choices: ['批准执行'] }] }),
        });
      const headers: Record<string, string> =
        kind === 'bearer'
          ? { authorization: `Bearer ${deviceToken}` }
          : {
              cookie: `cairn_auth=${issueBrowserSession(s.db, 'device', 'paired-phone').token}`,
              'sec-fetch-site': 'same-origin',
            };
      expect((await post(headers)).status).toBe(403);
      expect(pendingApproval(s).id).toBe(pending.id);
      expect(calls).toHaveLength(0);
      const ownerHeaders: Record<string, string> =
        kind === 'bearer'
          ? { authorization: `Bearer ${ownerToken}`, 'sec-fetch-site': 'same-origin' }
          : {
              cookie: `cairn_auth=${issueBrowserSession(s.db, 'owner').token}`,
              'sec-fetch-site': 'same-origin',
            };
      expect((await post(ownerHeaders)).status).toBe(200);
      expect(
        s.db.select().from(actionProposal).where(eq(actionProposal.id, pending.id)).get(),
      ).toMatchObject({ status: 'executed', decidedBy: s.user.id });
      const filled = forwardComputerCall(deps, 'sidecar', 'step-a', fill('owner-approved'));
      expect(calls).toHaveLength(1);
      receiveComputerFrames(s.db, s.hub, 'omarchy', calls[0]!.callId, [done(1)], s.secretBox);
      await filled;
    },
  );

  test('a historical device-approved password grant cannot be reused', async () => {
    const { s, deps, calls } = boot();
    createSecret(deps, { teamId: s.team.id, name: 'LOGIN', value: 'synthetic-password' });
    await forwardComputerCall(deps, 'sidecar', 'step-a', fill());
    const pending = pendingApproval(s);
    await answer(s, pending.id);
    s.db
      .update(actionProposal)
      .set({ decidedBy: 'device:paired-phone' })
      .where(eq(actionProposal.id, pending.id))
      .run();
    const result = forwardComputerCall(deps, 'sidecar', 'step-a', fill('historical-grant'));
    if (calls.length > 0) {
      receiveComputerFrames(s.db, s.hub, 'omarchy', calls[0]!.callId, [done(1)], s.secretBox);
    }
    expect((await result).text).toContain('尚未代填');
    expect(calls).toHaveLength(0);
    expect(pendingApproval(s).id).not.toBe(pending.id);
  });

  test('another website or machine and a rotated or deleted secret cannot reuse approval', async () => {
    const { s, deps, calls } = boot();
    const saved = createSecret(deps, {
      teamId: s.team.id,
      name: 'LOGIN',
      value: 'synthetic-password',
    });
    await forwardComputerCall(deps, 'sidecar', 'step-a', fill());
    await answer(s, pendingApproval(s).id);
    await forwardComputerCall(
      deps,
      'sidecar',
      'step-a',
      fill('wrong-site', 'https://localhost:9443'),
    );
    expect(JSON.parse(pendingApproval(s).inputJson).origin).toBe('https://localhost:9443');
    s.db
      .update(computerTable)
      .set({ machineId: 'sidecar' })
      .where(eq(computerTable.id, COMPUTER))
      .run();
    s.db
      .update(machineTable)
      .set({
        capabilities: {
          computer: true,
          browser: true,
          browserSecretFill: true,
          mcpServers: [],
          skills: [],
        },
      })
      .where(eq(machineTable.id, 'sidecar'))
      .run();
    s.machineHub.subscribeMachine(s.team.id, 'sidecar', () => {});
    await forwardComputerCall(deps, 'sidecar', 'step-a', fill('wrong-machine'));
    expect(JSON.parse(pendingApproval(s).inputJson).machineId).toBe('sidecar');
    s.db
      .update(computerTable)
      .set({ machineId: 'omarchy' })
      .where(eq(computerTable.id, COMPUTER))
      .run();
    updateSecret(deps, s.team.id, saved.id, { value: 'synthetic-rotated' });
    await forwardComputerCall(deps, 'sidecar', 'step-a', fill('rotated'));
    expect(JSON.parse(pendingApproval(s).inputJson).revision).toBe(2);
    expect(calls).toHaveLength(0);
    deleteSecret(deps, s.team.id, saved.id);
    expect((await answer(s, pendingApproval(s).id)).status).toBe(200);
    expect(s.db.select().from(actionProposal).all().at(-1)?.status).toBe('failed');
    await expect(forwardComputerCall(deps, 'sidecar', 'step-a', fill('deleted'))).rejects.toThrow(
      'Save',
    );
  });

  test.each(['refused', 'expired', 'stale'] as const)(
    '%s approval does not authorize or expose the secret',
    async (outcome) => {
      const { s, deps, calls } = boot();
      const saved = createSecret(deps, {
        teamId: s.team.id,
        name: 'LOGIN',
        value: 'synthetic-password',
      });
      await forwardComputerCall(deps, 'sidecar', 'step-a', fill());
      const pending = pendingApproval(s);
      if (outcome === 'refused') await answer(s, pending.id, '不执行');
      else if (outcome === 'expired') sweepExpiredActionProposals(s.db, pending.expiresAt + 1);
      else {
        updateSecret(deps, s.team.id, saved.id, { value: 'synthetic-rotated' });
        await answer(s, pending.id);
      }
      await forwardComputerCall(deps, 'sidecar', 'step-a', fill('retry'));
      expect(calls).toHaveLength(0);
      expect(pendingApproval(s).id).not.toBe(pending.id);
      expect(openSecretGrants(deps, s.team.id, [saved.id], null)).toEqual({ values: {}, http: [] });
      expect((await answer(s, pending.id)).status).toBe(409);
    },
  );

  test('an owner-token request no Cairn page made cannot authorize a password website', async () => {
    const { s, deps, calls } = boot();
    createSecret(deps, { teamId: s.team.id, name: 'LOGIN', value: 'synthetic-password' });
    await forwardComputerCall(deps, 'sidecar', 'step-a', fill());
    const pending = pendingApproval(s);
    expect((await answer(s, pending.id, '批准执行', {})).status).toBe(403);
    expect(pendingApproval(s)).toMatchObject({ id: pending.id, decidedBy: null });
    await forwardComputerCall(deps, 'sidecar', 'step-a', fill('retry'));
    expect(calls).toHaveLength(0);
    expect((await answer(s, pending.id, '不执行', {})).status).toBe(200);
  });

  test('only an owner card approval works; model text and an intact but superseded card do not', async () => {
    const { s, deps, calls } = boot();
    createSecret(deps, { teamId: s.team.id, name: 'LOGIN', value: 'synthetic-password' });
    await forwardComputerCall(deps, 'sidecar', 'step-a', fill());
    const pending = pendingApproval(s);
    expect(
      (
        await req(s.app, 'POST', `/api/actions/proposals/${pending.id}/answer`, {
          decision: 'allow-once',
        })
      ).status,
    ).toBe(409);
    await forwardComputerCall(deps, 'sidecar', 'step-a', fill('changed', 'https://example.com'));
    expect((await answer(s, pending.id)).status).toBe(409);
    expect(calls).toHaveLength(0);
  });

  test('environment variables, service credentials and old machines are refused before asking', async () => {
    const { s, deps } = boot();
    const saved = createSecret(deps, {
      teamId: s.team.id,
      name: 'LOGIN',
      value: 'public-value',
      kind: 'env',
    });
    await expect(forwardComputerCall(deps, 'sidecar', 'step-a', fill())).rejects.toThrow(
      'workspace secret',
    );
    s.db.update(secret).set({ envSeal: null }).where(eq(secret.id, saved.id)).run();
    s.db
      .update(machineTable)
      .set({ capabilities: { computer: true, browser: true, mcpServers: [], skills: [] } })
      .where(eq(machineTable.id, 'omarchy'))
      .run();
    await expect(forwardComputerCall(deps, 'sidecar', 'step-a', fill())).rejects.toThrow(
      'Update this machine',
    );
    expect(s.db.select().from(actionProposal).all()).toEqual([]);
  });

  test('a challenge on a browser call sets the handoff', async () => {
    const { s, deps, calls } = boot();
    const pending = forwardComputerCall(
      deps,
      'sidecar',
      'step-a',
      browser('browser_snapshot', 'a'),
    );
    receiveComputerFrames(s.db, s.hub, 'omarchy', calls[0]!.callId, [
      done(1, { signals: ['challenge'] }),
    ]);
    await pending;
    expect(computerRow(s)).toMatchObject({
      handoffReason: 'login',
      handoffStepId: 'step-a',
      handoffRequestedAt: expect.any(Number),
    });
  });

  test('a password form or a shell call does not force handoff', async () => {
    const { s, deps, calls } = boot();
    const snapshot = forwardComputerCall(
      deps,
      'sidecar',
      'step-a',
      browser('browser_snapshot', 'a'),
    );
    receiveComputerFrames(s.db, s.hub, 'omarchy', calls[0]!.callId, [
      done(1, { signals: ['password'] }),
    ]);
    await snapshot;
    const shell = forwardComputerCall(deps, 'sidecar', 'step-a', {
      computer: true,
      name: 'shell',
      toolCallId: 'b',
      params: { command: 'ls' },
    });
    receiveComputerFrames(s.db, s.hub, 'omarchy', calls[1]!.callId, [
      done(1, { signals: ['password'] }),
    ]);
    await shell;
    expect(computerRow(s).handoffReason).toBeNull();
  });

  test('browser_navigate is refused while a handoff is pending and nothing is dispatched', async () => {
    const { s, deps, calls } = boot();
    setHandoff(s, {
      handoffReason: 'login',
      handoffStepId: 'step-a',
      handoffRequestedAt: Date.now(),
    });
    const result = await forwardComputerCall(
      deps,
      'sidecar',
      'step-a',
      browser('browser_navigate', 'n'),
    );
    expect(result.text).toContain('request_takeover');
    expect(calls).toEqual([]);
    expect(s.db.select().from(computerCallTable).all()).toEqual([]);
  });

  test('browser_snapshot and computer_observe are refused while the owner holds control', async () => {
    const { s, deps, calls } = boot();
    setHandoff(s, {
      controlHolder: 'user',
      controlLeaseId: 'lease',
      controlLeaseExpiresAt: Date.now() + 60_000,
    });
    const snapshot = await forwardComputerCall(
      deps,
      'sidecar',
      'step-a',
      browser('browser_snapshot', 's'),
    );
    const observe = await forwardComputerCall(deps, 'sidecar', 'step-a', {
      computer: true,
      name: 'computer_observe',
      toolCallId: 'o',
      params: {},
    });
    expect(snapshot.text).toContain('owner');
    expect(observe.text).toContain('owner');
    expect(calls).toEqual([]);
    expect(s.db.select().from(computerCallTable).all()).toEqual([]);
  });

  test('read-only tools other than snapshot and observe still pass while the owner holds control', async () => {
    const { s, deps, calls } = boot();
    setHandoff(s, {
      controlHolder: 'user',
      controlLeaseId: 'lease',
      controlLeaseExpiresAt: Date.now() + 60_000,
    });
    const listing = forwardComputerCall(deps, 'sidecar', 'step-a', {
      computer: true,
      name: 'list_files',
      toolCallId: 'l',
      params: { path: '.' },
    });
    expect(calls).toHaveLength(1);
    receiveComputerFrames(s.db, s.hub, 'omarchy', calls[0]!.callId, [done(1)]);
    await listing;
  });
});

describe('request_takeover', () => {
  test('waits until the owner takes control and gives it back, then returns the handed-back text', async () => {
    const { s, deps, calls } = boot();
    const result = forwardComputerCall(deps, 'sidecar', 'step-a', takeover(), FAST);
    const state = track(result);
    await waitForPending(s);
    expect(calls).toEqual([]);
    expect(takeoverRow(s)).toMatchObject({ state: 'running', replaySafe: false });
    const lease = acquireComputerControl(s.db, s.machineHub, s.team.id, s.user.id, COMPUTER);
    expect(state.settled).toBe(false);
    releaseComputerControl(s.db, s.team.id, s.user.id, COMPUTER, lease.leaseId);
    expect((await result).text).toBe(HANDED_BACK);
    expect(computerRow(s)).toMatchObject({
      handoffReason: null,
      handoffStepId: null,
      handoffRequestedAt: null,
    });
    expect(takeoverRow(s)).toMatchObject({ state: 'done', finishedAt: expect.any(Number) });
  });

  test('without a Give back it ends at the timeout with the not-done text and clears the state', async () => {
    const { s, deps } = boot();
    const result = await forwardComputerCall(deps, 'sidecar', 'step-a', takeover(), {
      takeover: { timeoutMs: 40, pollMs: 5 },
    });
    expect(result.text).toBe(NOT_DONE);
    expect(computerRow(s)).toMatchObject({
      handoffReason: null,
      handoffStepId: null,
      handoffRequestedAt: null,
    });
    expect(takeoverRow(s)).toMatchObject({ state: 'error', finishedAt: expect.any(Number) });
    expect(computerRow(s).executionStepId).toBeNull();
  });

  test('a stopped step ends it with the not-done text', async () => {
    const { s, deps } = boot();
    const abort = new AbortController();
    const result = forwardComputerCall(deps, 'sidecar', 'step-a', takeover(), {
      ...FAST,
      signal: abort.signal,
    });
    await waitForPending(s);
    abort.abort();
    expect((await result).text).toBe(NOT_DONE);
    expect(computerRow(s).handoffReason).toBeNull();
    expect(takeoverRow(s)).toMatchObject({ state: 'error', finishedAt: expect.any(Number) });
  });

  test('an owner who already held control resolves it with one Give back', async () => {
    const { s, deps } = boot();
    const lease = acquireComputerControl(s.db, s.machineHub, s.team.id, s.user.id, COMPUTER);
    const result = forwardComputerCall(deps, 'sidecar', 'step-a', takeover(), FAST);
    await waitForPending(s);
    releaseComputerControl(s.db, s.team.id, s.user.id, COMPUTER, lease.leaseId);
    expect((await result).text).toBe(HANDED_BACK);
  });

  test('the Coordinator relay routes request_takeover to the server hold', async () => {
    const { s, deps } = boot();
    const abort = new AbortController();
    const result = executeRelayToolCall(
      deps,
      'sidecar',
      'step-a',
      'request_takeover',
      { reason: 'captcha' },
      'tk-relay',
      abort.signal,
    );
    await waitForPending(s);
    abort.abort();
    expect(await result).toBe(NOT_DONE);
  });

  test('a takeover with no subscribed device still leaves a push record', async () => {
    const { s, deps } = boot();
    const abort = new AbortController();
    const result = forwardComputerCall(deps, 'sidecar', 'step-a', takeover(), {
      ...FAST,
      signal: abort.signal,
    });
    await waitForPending(s);
    await vi.waitFor(() => {
      const rows = s.db.select().from(pushDelivery).all();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.pushStatus).toBe('no-subscription');
      expect(rows[0]?.message?.href).toBe(`/app?chief=${THREAD}`);
    });
    abort.abort();
    await result;
  });

  test('sends exactly one push that opens the conversation', async () => {
    const { s, deps } = boot();
    s.db
      .insert(pushSubscription)
      .values({
        id: 'handoff-sub',
        userId: s.user.id,
        teamId: s.team.id,
        endpoint: 'https://push.example/handoff',
        p256dh: 'key',
        auth: 'auth',
        createdAt: Date.now(),
      })
      .run();
    const send = vi
      .spyOn(webpush, 'sendNotification')
      .mockResolvedValue({ statusCode: 201, body: '', headers: {} });
    const abort = new AbortController();
    const result = forwardComputerCall(deps, 'sidecar', 'step-a', takeover(), {
      ...FAST,
      signal: abort.signal,
    });
    await waitForPending(s);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    abort.abort();
    await result;
    expect(send).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(send.mock.calls[0]![1])).notification;
    expect(payload.title).toBe('需要你登录');
    expect(payload.body).toContain('log in to the job board');
    expect(payload.navigate).toContain(`/app?chief=${THREAD}`);
    expect(s.db.select().from(pushDelivery).all()).toHaveLength(1);
  });
});

describe('handoff state paths', () => {
  test('Give back clears the handoff', () => {
    const { s } = boot();
    setHandoff(s, {
      controlHolder: 'user',
      controlLeaseId: 'lease',
      controlLeaseExpiresAt: Date.now() + 60_000,
      handoffReason: 'login',
      handoffStepId: 'step-a',
      handoffRequestedAt: Date.now(),
    });
    releaseComputerControl(s.db, s.team.id, s.user.id, COMPUTER, 'lease');
    expect(computerRow(s)).toMatchObject({
      handoffReason: null,
      handoffStepId: null,
      handoffRequestedAt: null,
    });
  });

  test('a turn that ends without request_takeover clears the login handoff it set', () => {
    const { s, deps } = boot();
    setHandoff(s, {
      handoffReason: 'login',
      handoffStepId: 'step-a',
      handoffRequestedAt: Date.now(),
    });
    stopStepComputer(deps, 'step-a');
    expect(computerRow(s)).toMatchObject({
      handoffReason: null,
      handoffStepId: null,
      handoffRequestedAt: null,
    });
  });

  test('another turn ending leaves a handoff it did not set', () => {
    const { s, deps } = boot();
    setHandoff(s, {
      handoffReason: 'login',
      handoffStepId: 'step-a',
      handoffRequestedAt: Date.now(),
    });
    stopStepComputer(deps, 'step-b');
    expect(computerRow(s).handoffReason).toBe('login');
  });

  test('a replay of a waiting takeover keeps waiting instead of ending the call', async () => {
    const { s, deps } = boot();
    const first = forwardComputerCall(deps, 'sidecar', 'step-a', takeover(), FAST);
    await waitForPending(s);
    dropComputerWaiters();
    const again = forwardComputerCall(deps, 'sidecar', 'step-a', takeover(), FAST);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(takeoverRow(s)).toMatchObject({ state: 'running', finishedAt: null });
    expect(computerRow(s).handoffReason).toBe('model');
    const lease = acquireComputerControl(s.db, s.machineHub, s.team.id, s.user.id, COMPUTER);
    releaseComputerControl(s.db, s.team.id, s.user.id, COMPUTER, lease.leaseId);
    expect((await again).text).toBe(HANDED_BACK);
    await first.catch(() => undefined);
  });

  test('a restart keeps a fresh takeover waiting and ends only one past its deadline', () => {
    const { s } = boot();
    const now = Date.now();
    setHandoff(s, {
      handoffReason: 'model',
      handoffStepId: 'step-a',
      handoffRequestedAt: now - 60_000,
    });
    s.db
      .insert(computerCallTable)
      .values({
        id: 'd'.repeat(64),
        teamId: s.team.id,
        stepId: 'step-a',
        toolCallId: 'waiting',
        machineId: 'omarchy',
        computerId: COMPUTER,
        tool: 'request_takeover',
        replaySafe: false,
        params: {},
        state: 'running',
        deadlineAt: now + 14 * 60_000,
        createdAt: now - 60_000,
      })
      .run();
    sweepComputerHandoffs(s.db, now);
    expect(computerRow(s).handoffReason).toBe('model');
    expect(takeoverRow(s)).toMatchObject({ state: 'running', finishedAt: null });

    const overdue = boot();
    const overdueNow = Date.now();
    setHandoff(overdue.s, {
      handoffReason: 'login',
      handoffStepId: 'step-a',
      handoffRequestedAt: overdueNow - 16 * 60_000,
    });
    overdue.s.db
      .insert(computerCallTable)
      .values({
        id: 'e'.repeat(64),
        teamId: overdue.s.team.id,
        stepId: 'step-a',
        toolCallId: 'late',
        machineId: 'omarchy',
        computerId: COMPUTER,
        tool: 'request_takeover',
        replaySafe: false,
        params: {},
        state: 'running',
        deadlineAt: overdueNow - 60_000,
        createdAt: overdueNow - 16 * 60_000,
      })
      .run();
    sweepComputerHandoffs(overdue.s.db, overdueNow);
    expect(computerRow(overdue.s).handoffReason).toBeNull();
    expect(takeoverRow(overdue.s)).toMatchObject({
      state: 'error',
      finishedAt: expect.any(Number),
    });
  });

  test('the start sweep clears an overdue handoff, keeps a fresh one and ends a left-over takeover call', () => {
    const { s } = boot();
    const now = Date.now();
    setHandoff(s, {
      handoffReason: 'login',
      handoffStepId: 'step-a',
      handoffRequestedAt: now - 16 * 60_000,
    });
    s.db
      .insert(computerCallTable)
      .values({
        id: 'c'.repeat(64),
        teamId: s.team.id,
        stepId: 'step-a',
        toolCallId: 'old',
        machineId: 'omarchy',
        computerId: COMPUTER,
        tool: 'request_takeover',
        replaySafe: false,
        params: {},
        state: 'running',
        deadlineAt: now - 60_000,
        createdAt: now - 1000,
      })
      .run();
    sweepComputerHandoffs(s.db, now);
    expect(computerRow(s).handoffReason).toBeNull();
    expect(takeoverRow(s)).toMatchObject({ state: 'error', finishedAt: expect.any(Number) });
    setHandoff(s, {
      handoffReason: 'login',
      handoffStepId: 'step-a',
      handoffRequestedAt: now - 60_000,
    });
    sweepComputerHandoffs(s.db, now);
    expect(computerRow(s).handoffReason).toBe('login');
  });
});

describe('the Runner relay route', () => {
  test('the tool call id sent with a browser call keeps two identical calls apart, and a client that gives up releases the takeover hold', async () => {
    const { s, calls } = boot();
    const token = 'sidecar-token';
    s.db
      .update(machineTable)
      .set({ tokenHash: createHash('sha256').update(token).digest('hex') })
      .where(eq(machineTable.id, 'sidecar'))
      .run();
    const post = (
      name: string,
      params: Record<string, unknown>,
      toolCallId?: string,
      signal?: AbortSignal,
    ) =>
      s.app.request('/api/machine/tool/step-a', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ name, params, ...(toolCallId !== undefined ? { toolCallId } : {}) }),
        ...(signal !== undefined ? { signal } : {}),
      });

    for (const [index, id] of ['call-1', 'call-2'].entries()) {
      const response = post('browser_navigate', { url: 'https://example.test' }, id);
      await vi.waitFor(() => expect(calls).toHaveLength(index + 1));
      receiveComputerFrames(s.db, s.hub, 'omarchy', calls[index]!.callId, [done(1)]);
      expect((await response).status).toBe(200);
    }
    expect(calls.map((call) => call.callId)).toHaveLength(2);
    expect(new Set(calls.map((call) => call.callId)).size).toBe(2);

    const abort = new AbortController();
    const takeoverResponse = post(
      'request_takeover',
      { reason: 'captcha' },
      'tk-route',
      abort.signal,
    );
    await waitForPending(s);
    abort.abort();
    await Promise.resolve(takeoverResponse).catch(() => {});
    await vi.waitFor(() => expect(takeoverRow(s)?.state).toBe('error'));
    expect(computerRow(s)).toMatchObject({ handoffReason: null, handoffStepId: null });
    expect(computerRow(s).executionStepId).toBeNull();
  });
});

describe('CloakBrowser license for VM computers', () => {
  const LICENSE = 'synthetic-cloak-license';
  const stealth = (toolCallId: string, name = 'browser_snapshot' as const) => ({
    computer: true as const,
    name,
    toolCallId,
    params: { stealth: true },
  });
  const kind = (s: TestServer, computerKind: 'host' | 'vm') =>
    s.db
      .update(machineTable)
      .set({
        capabilities: {
          mcpServers: [],
          skills: [],
          computer: true,
          browser: true,
          browserSecretFill: true,
          computerKind,
        },
      })
      .where(eq(machineTable.id, 'omarchy'))
      .run();
  const finish = (s: TestServer, call: ComputerCall, text = 'ok') =>
    receiveComputerFrames(
      s.db,
      s.hub,
      'omarchy',
      call.callId,
      [{ kind: 'done', seq: 1, text }],
      s.secretBox,
    );

  test('a stealth browser call on a VM machine carries the team license, never stored', async () => {
    const { s, deps, calls } = boot();
    kind(s, 'vm');
    createSecret(deps, { teamId: s.team.id, name: 'CLOAKBROWSER_LICENSE_KEY', value: LICENSE });
    const pending = forwardComputerCall(deps, 'sidecar', 'step-a', stealth('stealth-1'));
    const call = calls.at(-1)!;
    expect(call.browserLicense).toBe(LICENSE);
    finish(s, call);
    await pending;
    expect(JSON.stringify(s.db.select().from(computerCallTable).all())).not.toContain(LICENSE);
  });

  test('the license is absent for default browser calls, other tools and host machines', async () => {
    const { s, deps, calls } = boot();
    kind(s, 'vm');
    createSecret(deps, { teamId: s.team.id, name: 'CLOAKBROWSER_LICENSE_KEY', value: LICENSE });
    for (const body of [
      browser('browser_snapshot', 'plain'),
      {
        computer: true as const,
        name: 'shell' as const,
        toolCallId: 'sh',
        params: { command: 'true', stealth: true },
      },
    ]) {
      const pending = forwardComputerCall(deps, 'sidecar', 'step-a', body);
      const call = calls.at(-1)!;
      expect(call.browserLicense).toBeUndefined();
      finish(s, call);
      await pending;
    }
    kind(s, 'host');
    const pending = forwardComputerCall(deps, 'sidecar', 'step-a', stealth('host-stealth'));
    const call = calls.at(-1)!;
    expect(call.browserLicense).toBeUndefined();
    finish(s, call);
    await pending;
  });

  test('a stealth call on a VM machine without the secret is refused before dispatch', async () => {
    const { s, deps, calls } = boot();
    kind(s, 'vm');
    const result = await forwardComputerCall(deps, 'sidecar', 'step-a', stealth('no-license'));
    expect(result.text).toBe('No CloakBrowser license; set team secret CLOAKBROWSER_LICENSE_KEY');
    expect(calls).toHaveLength(0);
  });

  test('the license is redacted from any computer output of the team', async () => {
    const { s, deps, calls } = boot();
    kind(s, 'vm');
    createSecret(deps, { teamId: s.team.id, name: 'CLOAKBROWSER_LICENSE_KEY', value: LICENSE });
    const pending = forwardComputerCall(
      deps,
      'sidecar',
      'step-a',
      browser('browser_snapshot', 'leak'),
    );
    finish(s, calls.at(-1)!, `key is ${LICENSE}`);
    const result = await pending;
    expect(result.text).not.toContain(LICENSE);
    const shell = forwardComputerCall(deps, 'sidecar', 'step-a', {
      computer: true as const,
      name: 'shell' as const,
      toolCallId: 'cat-key',
      params: { command: 'cat /run/cairn/cloak.key' },
    });
    const call = calls.at(-1)!;
    receiveComputerFrames(
      s.db,
      s.hub,
      'omarchy',
      call.callId,
      [
        { kind: 'output', seq: 1, stream: 'stdout', text: `${LICENSE}\n` },
        { kind: 'done', seq: 2, text: '', exitCode: 0 },
      ],
      s.secretBox,
    );
    expect(JSON.stringify(await shell)).not.toContain(LICENSE);
    expect(JSON.stringify(s.db.select().from(computerCallTable).all())).not.toContain(LICENSE);
  });
});
