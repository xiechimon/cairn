import {
  type ComputerCall,
  type ComputerRelayResult,
  type MachineCapabilities,
  type MachineComputerRelayBody,
  type MachineStreamEvent,
  OWN_COMPUTER_ALLOW_CONVERSATION,
  OWN_COMPUTER_APP_ACTION,
  OWN_COMPUTER_DENIED,
  OWN_COMPUTER_NO_ACCESSIBILITY,
  OWN_COMPUTER_NO_ANSWER,
  OWN_COMPUTER_NOT_INSTALLED,
  OWN_COMPUTER_NOT_ON,
  OWN_COMPUTER_NOT_OWNER_TURN,
} from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  actionProposal,
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  computerCall as computerCallTable,
  machine as machineTable,
  pairedDevice,
  step as stepTable,
  user as userTable,
} from '../src/db/schema.js';
import { answerProposal, type Decision } from '../src/services/action-proposals.js';
import { createApiKey } from '../src/services/api-keys.js';
import { issueBrowserSession } from '../src/services/browser-session.js';
import {
  dropComputerWaiters,
  forwardComputerCall,
  receiveComputerFrames,
} from '../src/services/machine-computer.js';
import type { MachineDeps } from '../src/services/machine-deps.js';
import {
  listOwnComputerGrants,
  OWN_COMPUTER_DISCONNECTED,
  OWN_COMPUTER_SEVERAL_MACS,
  revokeOwnComputerGrant,
} from '../src/services/own-computer.js';
import { bootServer, seedRoute, type TestServer } from './helpers.js';

vi.setConfig({ testTimeout: 30_000 });

const THREAD = 'chief-own-thread';
const READY: MachineCapabilities = {
  mcpServers: [],
  skills: [],
  ownComputerHost: true,
  ownComputer: true,
  ownComputerShell: true,
  hostPermissions: { accessibility: 'granted', automation: 'unknown', screenRecording: 'granted' },
};

let server: TestServer | null = null;
afterEach(() => {
  dropComputerWaiters();
  server?.dispose();
  server = null;
});

interface World {
  s: TestServer;
  deps: MachineDeps;
  pushed: ComputerCall[];
  cancels: string[];
}

function addMac(
  s: TestServer,
  id: string,
  capabilities: MachineCapabilities = READY,
  enabled = true,
): { pushed: ComputerCall[]; cancels: string[] } {
  s.db
    .insert(machineTable)
    .values({
      id,
      teamId: s.team.id,
      name: id,
      online: true,
      capabilities,
      ownComputerEnabled: enabled,
    })
    .run();
  const pushed: ComputerCall[] = [];
  const cancels: string[] = [];
  s.machineHub.subscribeMachine(s.team.id, id, (ev: MachineStreamEvent) => {
    if (ev.type === 'computer') pushed.push(ev.call);
    if (ev.type === 'computer.cancel') cancels.push(ev.callId);
  });
  return { pushed, cancels };
}

function addThread(s: TestServer, id: string, userId: string) {
  const chiefId = `chief-${userId}-${s.team.id}`;
  s.db
    .insert(chiefTable)
    .values({ id: chiefId, userId, teamId: s.team.id, createdAt: 1 })
    .onConflictDoNothing()
    .run();
  s.db
    .insert(chiefThreadTable)
    .values({
      id,
      chiefId,
      userId,
      teamId: s.team.id,
      title: id,
      createdAt: 1,
      updatedAt: 1,
      sessionId: '',
      sessionOpenedAt: 1,
      archivedAt: 1,
    })
    .run();
}

function addStep(
  s: TestServer,
  id: string,
  opts: { thread?: string; prompt?: string; ownerMessageIds?: string[] | null } = {},
) {
  s.db
    .insert(stepTable)
    .values({
      id,
      buildId: opts.thread ?? THREAD,
      kind: 'chief',
      machineId: 'sidecar',
      status: 'claimed',
      prompt: opts.prompt ?? 'open Finder for me',
      ownerMessageIds: opts.ownerMessageIds === undefined ? ['msg-1'] : opts.ownerMessageIds,
      createdAt: 2,
    })
    .run();
}

function world(macCapabilities: MachineCapabilities = READY, enabled = true): World {
  const s = bootServer();
  server = s;
  s.db.insert(machineTable).values({ id: 'sidecar', teamId: s.team.id, name: 'sidecar' }).run();
  seedRoute(s, 'coordinator', { provider: 'stub-gw', modelId: 'stub-model', machineId: 'sidecar' });
  addThread(s, THREAD, s.svc.user.id);
  addStep(s, 'step-1');
  const { pushed, cancels } = addMac(s, 'ians-mac', macCapabilities, enabled);
  const deps: MachineDeps = {
    ...s.svc,
    box: s.secretBox,
    reposDir: s.reposDir,
    attachmentsDir: s.attachmentsDir,
    skillsDir: s.skillsDir,
  };
  return { s, deps, pushed, cancels };
}

const observe = (app: string, toolCallId = 'tc-1') => ({
  computer: true as const,
  name: 'user_computer_observe' as const,
  toolCallId,
  params: { app },
});

const shell = (command: string, toolCallId = 'tc-sh') => ({
  computer: true as const,
  name: 'user_computer_shell' as const,
  toolCallId,
  params: { command },
});

const FAST = { ownComputer: { pollMs: 5, timeoutMs: 5_000 } };

function forward(
  w: World,
  body: MachineComputerRelayBody,
  stepId = 'step-1',
  extra: { signal?: AbortSignal; ownComputer?: { pollMs: number; timeoutMs: number } } = {},
): Promise<ComputerRelayResult> {
  return forwardComputerCall(w.deps, 'sidecar', stepId, body, { ...FAST, ...extra });
}

function pending(w: World) {
  return w.s.db.select().from(actionProposal).where(eq(actionProposal.status, 'pending')).all();
}

async function until<T>(read: () => T | undefined | null | false): Promise<T> {
  for (let i = 0; i < 400; i += 1) {
    const value = read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('condition never held');
}

function answer(w: World, proposalId: string, decision: Decision, decidedBy?: string) {
  return answerProposal(
    { db: w.s.db, reposDir: w.s.reposDir, hub: w.s.hub, user: w.s.svc.user },
    {
      proposalId,
      teamId: w.s.team.id,
      decision,
      decidedBy: decidedBy ?? w.s.svc.user.id,
      viaCard: true,
    },
  );
}

async function approveNext(w: World, decision: Decision) {
  const card = await until(() => pending(w)[0]);
  answer(w, card.id, decision);
  return card;
}

function settle(w: World, index = -1) {
  const call = w.pushed.at(index);
  if (!call) throw new Error('nothing pushed');
  receiveComputerFrames(w.s.db, w.s.hub, 'ians-mac', call.callId, [
    { kind: 'done', seq: 1, text: 'observed' },
  ]);
  return call;
}

function noDispatch(w: World) {
  expect(w.pushed).toEqual([]);
  expect(w.s.db.select().from(computerCallTable).all()).toEqual([]);
}

describe('gate checks 1-8 refuse before anything is created', () => {
  test('switch off', async () => {
    const w = world(READY, false);
    expect((await forward(w, observe('Finder'))).text).toBe(OWN_COMPUTER_NOT_ON);
    noDispatch(w);
  });

  test.each([
    ['a routine or watch wake', '[wake: routine daily] check mail', []],
    ['a mail wake', '[wake:mail] new message', []],
    ['an orchestrated send', 'do the thing', []],
    ['a channel greeting', 'say hello', null],
  ])('%s is not an owner turn', async (_label, prompt, ids) => {
    const w = world();
    addStep(w.s, 'step-x', { prompt, ownerMessageIds: ids as string[] | null });
    const result = await forward(w, observe('Finder'), 'step-x');
    expect(result.text).toContain(OWN_COMPUTER_NOT_OWNER_TURN);
    noDispatch(w);
    expect(pending(w)).toEqual([]);
  });

  test("another person's conversation", async () => {
    const w = world();
    w.s.db.insert(userTable).values({ id: 'bob', displayName: 'Bob' }).run();
    addThread(w.s, 'chief-bob-thread', 'bob');
    addStep(w.s, 'step-bob', { thread: 'chief-bob-thread' });
    const result = await forward(w, observe('Finder'), 'step-bob');
    expect(result.text).toContain('belongs to someone else');
    noDispatch(w);
  });

  test('two switched-on Macs connected', async () => {
    const w = world();
    addMac(w.s, 'studio-mac');
    expect((await forward(w, observe('Finder'))).text).toBe(
      OWN_COMPUTER_SEVERAL_MACS(['ians-mac', 'studio-mac']),
    );
    noDispatch(w);
  });

  test('switched-on Mac disconnected', async () => {
    const w = world();
    w.s.machineHub.releaseMachine('ians-mac');
    expect((await forward(w, observe('Finder'))).text).toBe(OWN_COMPUTER_DISCONNECTED('ians-mac'));
    noDispatch(w);
  });

  test('no verified agent-desktop', async () => {
    const w = world({ ...READY, ownComputer: undefined });
    expect((await forward(w, observe('Finder'))).text).toBe(OWN_COMPUTER_NOT_INSTALLED('ians-mac'));
    noDispatch(w);
  });

  test('no Accessibility grant, or no report yet', async () => {
    const w = world({
      ...READY,
      hostPermissions: {
        accessibility: 'denied',
        automation: 'unknown',
        screenRecording: 'granted',
      },
    });
    expect((await forward(w, observe('Finder'))).text).toBe(
      OWN_COMPUTER_NO_ACCESSIBILITY('ians-mac'),
    );
    w.s.db
      .update(machineTable)
      .set({ capabilities: { ...READY, hostPermissions: undefined } })
      .where(eq(machineTable.id, 'ians-mac'))
      .run();
    expect((await forward(w, observe('Finder', 'tc-2'))).text).toBe(
      OWN_COMPUTER_NO_ACCESSIBILITY('ians-mac'),
    );
    noDispatch(w);
  });

  test.each(['Cairn', 'Electron', 'System Settings', ' system preferences '])(
    '%s is never driven',
    async (app) => {
      const w = world();
      expect((await forward(w, observe(app))).text).toContain('is never driven');
      noDispatch(w);
      expect(pending(w)).toEqual([]);
    },
  );

  test('shell needs approval instead of being refused, and refuses a cwd', async () => {
    const w = world();
    const held = forward(w, shell('ls ~/Desktop'));
    const card = await until(() => pending(w)[0]);
    expect(card.actionId).toBe('user_computer.shell');
    expect(w.pushed).toEqual([]);
    answer(w, card.id, 'refuse');
    expect((await held).text).toBe(OWN_COMPUTER_DENIED('the command ls ~/Desktop'));
    const withCwd = await forward(w, {
      ...shell('ls', 'tc-cwd'),
      params: { command: 'ls', cwd: '/' },
    });
    expect(withCwd.text).toContain('put any cd inside the command');
    noDispatch(w);
  });
});

describe('gate check 9 holds the call until the owner answers', () => {
  test('nothing is pushed before approval; deny refuses', async () => {
    const w = world();
    const held = forward(w, observe('Finder'));
    await until(() => pending(w)[0]);
    expect(w.pushed).toEqual([]);
    answer(w, pending(w)[0]?.id ?? '', 'refuse');
    expect((await held).text).toBe(OWN_COMPUTER_DENIED('Finder'));
    noDispatch(w);
  });

  test('no answer before the timeout expires the card', async () => {
    const w = world();
    const result = await forward(w, observe('Finder'), 'step-1', {
      ownComputer: { pollMs: 5, timeoutMs: 50 },
    });
    expect(result.text).toBe(OWN_COMPUTER_NO_ANSWER('Finder'));
    expect(w.s.db.select().from(actionProposal).get()?.status).toBe('expired');
    noDispatch(w);
  });

  test('the turn stopping ends the hold', async () => {
    const w = world();
    const held = forward(w, observe('Finder'));
    await until(() => pending(w)[0]);
    w.s.db.update(stepTable).set({ status: 'stopped' }).where(eq(stepTable.id, 'step-1')).run();
    expect((await held).text).toBe(OWN_COMPUTER_NO_ANSWER('Finder'));
    noDispatch(w);
  });

  test('an aborted turn ends the hold', async () => {
    const w = world();
    const controller = new AbortController();
    const held = forward(w, observe('Finder'), 'step-1', { signal: controller.signal });
    await until(() => pending(w)[0]);
    controller.abort();
    expect((await held).text).toBe(OWN_COMPUTER_NO_ANSWER('Finder'));
    noDispatch(w);
  });

  test('the switch going off mid-hold ends it', async () => {
    const w = world();
    const held = forward(w, observe('Finder'));
    await until(() => pending(w)[0]);
    w.s.db
      .update(machineTable)
      .set({ ownComputerEnabled: false })
      .where(eq(machineTable.id, 'ians-mac'))
      .run();
    expect((await held).text).toBe(OWN_COMPUTER_NOT_ON);
    noDispatch(w);
  });
});

describe('allow once', () => {
  test('covers its own replay and not the next call', async () => {
    const w = world();
    const held = forward(w, observe('Finder'));
    const card = await approveNext(w, 'allow-once');
    await until(() => w.pushed.length === 1);
    expect(w.pushed[0]?.ownComputerGrant).toEqual({ proposalId: card.id, key: 'finder' });
    settle(w);
    expect((await held).text).toBe('observed');

    const replay = forward(w, observe('Finder'));
    await until(() => w.pushed.length === 2);
    settle(w);
    await replay;
    expect(pending(w)).toEqual([]);

    const next = forward(w, observe('Finder', 'tc-2'));
    await until(() => pending(w)[0]);
    expect(w.pushed).toHaveLength(2);
    answer(w, pending(w)[0]?.id ?? '', 'refuse');
    await next;
  });
});

describe('allow in this conversation', () => {
  async function grantFinder(w: World) {
    const held = forward(w, observe('Finder'));
    await approveNext(w, 'conversation');
    await until(() => w.pushed.length === 1);
    settle(w);
    await held;
  }

  test('later calls in the same conversation run, across a new session or step', async () => {
    const w = world();
    await grantFinder(w);
    addStep(w.s, 'step-2');
    w.s.db
      .update(chiefThreadTable)
      .set({ sessionId: 'fresh-session' })
      .where(eq(chiefThreadTable.id, THREAD))
      .run();
    const later = forward(w, observe('finder', 'tc-9'), 'step-2');
    await until(() => w.pushed.length === 2);
    settle(w);
    await later;
    expect(pending(w)).toEqual([]);
  });

  test('another conversation asks again', async () => {
    const w = world();
    await grantFinder(w);
    addThread(w.s, 'chief-other', w.s.svc.user.id);
    addStep(w.s, 'step-other', { thread: 'chief-other' });
    const other = forward(w, observe('Finder', 'tc-o'), 'step-other');
    await until(() => pending(w)[0]);
    expect(w.pushed).toHaveLength(1);
    answer(w, pending(w)[0]?.id ?? '', 'refuse');
    await other;
  });

  test('revoking on the panel asks again', async () => {
    const w = world();
    await grantFinder(w);
    const mac = w.s.db.select().from(machineTable).where(eq(machineTable.id, 'ians-mac')).get();
    if (!mac) throw new Error('mac missing');
    const [grant] = listOwnComputerGrants(w.s.db, mac);
    expect(grant).toMatchObject({ kind: 'app', key: 'finder', threadId: THREAD });
    revokeOwnComputerGrant(w.s.db, mac, grant?.proposalId ?? '');
    expect(listOwnComputerGrants(w.s.db, mac)).toEqual([]);
    const again = forward(w, observe('Finder', 'tc-3'));
    await until(() => pending(w)[0]);
    answer(w, pending(w)[0]?.id ?? '', 'refuse');
    await again;
  });
});

describe('always allow this command', () => {
  test('runs that exact command anywhere on this Mac; another command asks', async () => {
    const w = world();
    const first = forward(w, shell('git status'));
    await approveNext(w, 'always');
    await until(() => w.pushed.length === 1);
    expect(w.pushed[0]?.ownComputerGrant?.key).toBe('git status');
    settle(w);
    await first;
    addThread(w.s, 'chief-other', w.s.svc.user.id);
    addStep(w.s, 'step-other', { thread: 'chief-other' });
    const again = forward(w, shell('git status', 'tc-sh2'), 'step-other');
    await until(() => w.pushed.length === 2);
    settle(w);
    await again;
    const other = forward(w, shell('git status --short', 'tc-sh3'), 'step-other');
    await until(() => pending(w)[0]);
    answer(w, pending(w)[0]?.id ?? '', 'refuse');
    await other;
  });
});

describe('the card in chat', () => {
  test('its three buttons map to allow once, allow in this conversation and deny', async () => {
    const w = world();
    const held = forward(w, observe('Finder'));
    const card = await until(() => pending(w)[0]);
    const response = await w.s.app.request(
      `/api/teams/${w.s.team.id}/chief/threads/${THREAD}/questions/approval-${card.id}/answer`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          answers: [
            { header: '使用你的 Mac 上的应用', choices: [OWN_COMPUTER_ALLOW_CONVERSATION] },
          ],
        }),
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'answered',
      answers: [{ choices: [OWN_COMPUTER_ALLOW_CONVERSATION] }],
    });
    expect(
      w.s.db.select().from(actionProposal).where(eq(actionProposal.id, card.id)).get(),
    ).toMatchObject({ status: 'executed', decision: 'conversation' });
    await until(() => w.pushed.length === 1);
    settle(w);
    await held;
  });
});

describe('approver', () => {
  async function pendingCard(w: World) {
    void forward(w, observe('Finder'));
    return until(() => pending(w)[0]);
  }

  test('a paired device and a non-owner cannot approve', async () => {
    const w = world();
    const card = await pendingCard(w);
    expect(() => answer(w, card.id, 'allow-once', 'device:phone')).toThrow(
      expect.objectContaining({ status: 403 }),
    );
    w.s.db.insert(userTable).values({ id: 'bob', displayName: 'Bob' }).run();
    expect(() => answer(w, card.id, 'allow-once', 'bob')).toThrow(
      expect.objectContaining({ status: 403 }),
    );
    answer(w, card.id, 'refuse');
  });

  test('a standing decision is refused where it is not offered', async () => {
    const w = world();
    const card = await pendingCard(w);
    expect(card.actionId).toBe(OWN_COMPUTER_APP_ACTION);
    expect(() => answer(w, card.id, 'always')).toThrow(expect.objectContaining({ status: 409 }));
    answer(w, card.id, 'refuse');
    const command = forward(w, shell('pwd'));
    const shellCard = await until(() => pending(w)[0]);
    expect(() => answer(w, shellCard.id, 'conversation')).toThrow(
      expect.objectContaining({ status: 409 }),
    );
    answer(w, shellCard.id, 'refuse');
    await command;
  });
});

describe('the switch', () => {
  function request(w: World, body: unknown, kind: 'owner' | 'device' | 'agent' = 'owner') {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'sec-fetch-site': 'same-origin',
    };
    if (kind === 'agent')
      headers.authorization = `Bearer ${createApiKey(w.s, { teamId: w.s.team.id, gitAccess: false, mcpAccess: true, machineAccess: true, toolGrants: { read: [], write: [] } }).plaintext}`;
    else
      headers.cookie = `cairn_auth=${issueBrowserSession(w.s.db, kind, kind === 'device' ? 'paired' : null).token}`;
    return w.s.app.request('/api/machines/ians-mac', {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
    });
  }

  function authed(macCapabilities: MachineCapabilities = READY, enabled = false): World {
    const s = bootServer({ authToken: 'own-computer-switch' });
    server = s;
    s.db
      .insert(pairedDevice)
      .values({
        id: 'paired',
        teamId: s.team.id,
        name: 'phone',
        tokenHash: 'synthetic',
        masked: 'phone',
        createdAt: 1,
      })
      .run();
    const { pushed, cancels } = addMac(s, 'ians-mac', macCapabilities, enabled);
    return {
      s,
      deps: { ...s.svc, box: s.secretBox, reposDir: s.reposDir } as MachineDeps,
      pushed,
      cancels,
    };
  }

  const enabledOf = (w: World) =>
    w.s.db.select().from(machineTable).where(eq(machineTable.id, 'ians-mac')).get()
      ?.ownComputerEnabled;

  test('a paired device and an agent credential cannot turn it on', async () => {
    const w = authed();
    expect((await request(w, { ownComputerEnabled: true }, 'device')).status).toBe(403);
    expect((await request(w, { ownComputerEnabled: true }, 'agent')).status).toBe(401);
    expect(enabledOf(w)).toBe(false);
  });

  test('a machine that is not a Mac host cannot be turned on', async () => {
    const w = authed({ ...READY, ownComputerHost: undefined });
    expect((await request(w, { ownComputerEnabled: true })).status).toBe(409);
    expect(enabledOf(w)).toBe(false);
  });

  test('the owner turns it on', async () => {
    const w = authed();
    const response = await request(w, { ownComputerEnabled: true });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ownComputerEnabled: true });
    expect(enabledOf(w)).toBe(true);
  });

  test('turning off supersedes grants and pending cards, cancels an open call and pushes the cancel frame', async () => {
    const w = world();
    const first = forward(w, observe('Finder'));
    await approveNext(w, 'conversation');
    await until(() => w.pushed.length === 1);
    const open = w.pushed[0];
    const second = forward(w, observe('Notes', 'tc-notes'));
    await until(() => pending(w)[0]);
    const response = await w.s.app.request('/api/machines/ians-mac', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ownComputerEnabled: false }),
    });
    expect(response.status).toBe(200);
    expect(w.cancels).toEqual([open?.callId]);
    expect(
      w.s.db
        .select()
        .from(computerCallTable)
        .where(eq(computerCallTable.id, open?.callId ?? ''))
        .get()?.state,
    ).toBe('cancelled');
    expect((await first).text).toContain('cancelled');
    expect((await second).text).not.toContain('observed');
    expect(
      w.s.db
        .select()
        .from(actionProposal)
        .where(and(eq(actionProposal.status, 'executed')))
        .all(),
    ).toEqual([]);
    expect(pending(w)).toEqual([]);
    expect(w.pushed).toHaveLength(1);
  });
});
