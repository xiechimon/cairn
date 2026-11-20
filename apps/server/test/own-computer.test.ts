import {
  type ComputerCall,
  type ComputerRelayResult,
  type MachineCapabilities,
  type MachineComputerRelayBody,
  type MachineStreamEvent,
  OWN_COMPUTER_NO_ACCESSIBILITY,
  OWN_COMPUTER_NO_MAC,
  OWN_COMPUTER_NOT_OWNER,
} from '@cairn/shared';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  actionProposal,
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  computerCall as computerCallTable,
  machine as machineTable,
  step as stepTable,
  user as userTable,
} from '../src/db/schema.js';
import {
  dropComputerWaiters,
  forwardComputerCall,
  receiveComputerFrames,
} from '../src/services/machine-computer.js';
import type { MachineDeps } from '../src/services/machine-deps.js';
import { ownComputerOffered } from '../src/services/own-computer.js';
import { bootServer, seedRoute, type TestServer } from './helpers.js';

vi.setConfig({ testTimeout: 30_000 });

const THREAD = 'chief-own-thread';
const READY: MachineCapabilities = {
  mcpServers: [],
  skills: [],
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
}

function addMac(
  s: TestServer,
  id: string,
  capabilities: MachineCapabilities = READY,
  kind: 'local' | 'remote' = 'local',
) {
  s.db
    .insert(machineTable)
    .values({ id, teamId: s.team.id, name: id, kind, online: true, capabilities })
    .run();
  const pushed: ComputerCall[] = [];
  s.machineHub.subscribeMachine(s.team.id, id, (ev: MachineStreamEvent) => {
    if (ev.type === 'computer') pushed.push(ev.call);
  });
  return pushed;
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

function world(macCapabilities: MachineCapabilities = READY, authToken?: string): World {
  const s = bootServer(authToken === undefined ? {} : { authToken });
  server = s;
  s.db.insert(machineTable).values({ id: 'sidecar', teamId: s.team.id, name: 'sidecar' }).run();
  seedRoute(s, 'coordinator', { provider: 'stub-gw', modelId: 'stub-model', machineId: 'sidecar' });
  addThread(s, THREAD, s.svc.user.id);
  addStep(s, 'step-1');
  const pushed = addMac(s, 'users-mac', macCapabilities);
  const deps: MachineDeps = {
    ...s.svc,
    box: s.secretBox,
    reposDir: s.reposDir,
    attachmentsDir: s.attachmentsDir,
    skillsDir: s.skillsDir,
  };
  return { s, deps, pushed };
}

const observe = (app: string, toolCallId = 'tc-1', extra: Record<string, unknown> = {}) => ({
  computer: true as const,
  name: 'user_computer_observe' as const,
  toolCallId,
  params: { app, ...extra },
});

const shell = (command: string, toolCallId = 'tc-sh', extra: Record<string, unknown> = {}) => ({
  computer: true as const,
  name: 'user_computer_shell' as const,
  toolCallId,
  params: { command, ...extra },
});

function forward(
  w: World,
  body: MachineComputerRelayBody,
  stepId = 'step-1',
): Promise<ComputerRelayResult> {
  return forwardComputerCall(w.deps, 'sidecar', stepId, body);
}

async function until<T>(read: () => T | undefined | null | false): Promise<T> {
  for (let i = 0; i < 400; i += 1) {
    const value = read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('condition never held');
}

async function settled(w: World, result: Promise<ComputerRelayResult>, machineId = 'users-mac') {
  const call = await until(() => w.pushed.at(-1));
  receiveComputerFrames(w.s.db, w.s.hub, machineId, call.callId, [
    { kind: 'done', seq: 1, text: 'observed' },
  ]);
  return { call, result: await result };
}

function noDispatch(w: World) {
  expect(w.pushed).toEqual([]);
  expect(w.s.db.select().from(computerCallTable).all()).toEqual([]);
}

describe('calls run without an approval card', () => {
  test.each([
    ['an owner message', 'open Finder for me', ['msg-1']],
    ['a routine or watch wake', '[wake: routine daily] check the build', []],
    ['an orchestrated send', 'do the thing', []],
    ['a channel greeting', 'say hello', null],
  ])('%s dispatches at once', async (_label, prompt, ids) => {
    const w = world();
    addStep(w.s, 'step-x', { prompt, ownerMessageIds: ids as string[] | null });
    const { call, result } = await settled(w, forward(w, observe('Finder'), 'step-x'));
    expect(result.text).toContain('observed');
    expect(call.tool).toBe('user_computer_observe');
    expect(w.s.db.select().from(actionProposal).all()).toEqual([]);
  });

  test('Cairn and System Settings are driven like any other app', async () => {
    const w = world();
    for (const [index, app] of ['Cairn', 'System Settings'].entries()) {
      const { call } = await settled(w, forward(w, observe(app, `tc-${index}`)));
      expect(call.params).toEqual({ app });
    }
  });

  test('a shell call keeps its cwd and runs at once', async () => {
    const w = world();
    const { call } = await settled(w, forward(w, shell('ls', 'tc-cwd', { cwd: 'Code' })));
    expect(call.params).toEqual({ command: 'ls', cwd: 'Code' });
  });
});

describe('what still refuses before anything is created', () => {
  test("another person's conversation", async () => {
    const w = world();
    w.s.db.insert(userTable).values({ id: 'bob', displayName: 'Bob' }).run();
    addThread(w.s, 'chief-bob-thread', 'bob');
    addStep(w.s, 'step-bob', { thread: 'chief-bob-thread' });
    expect((await forward(w, observe('Finder'), 'step-bob')).text).toBe(OWN_COMPUTER_NOT_OWNER);
    noDispatch(w);
    expect(ownComputerOffered(w.s.db, 'chief-bob-thread')).toBe(false);
    expect(ownComputerOffered(w.s.db, THREAD)).toBe(true);
  });

  test('no connected Mac', async () => {
    const w = world();
    w.s.machineHub.releaseMachine('users-mac');
    expect((await forward(w, observe('Finder'))).text).toBe(OWN_COMPUTER_NO_MAC);
    noDispatch(w);
  });

  test('a Mac without agent-desktop serves the shell but not apps', async () => {
    const w = world({ ...READY, ownComputer: undefined });
    expect((await forward(w, observe('Finder'))).text).toBe(OWN_COMPUTER_NO_MAC);
    noDispatch(w);
    const { call } = await settled(w, forward(w, shell('uname')));
    expect(call.tool).toBe('user_computer_shell');
  });

  test('no Accessibility grant refuses apps', async () => {
    const w = world({ ...READY, hostPermissions: undefined });
    expect((await forward(w, observe('Finder'))).text).toBe(
      OWN_COMPUTER_NO_ACCESSIBILITY('users-mac'),
    );
    noDispatch(w);
  });
});

describe('only the Mac that runs this Cairn is used', () => {
  test('an enrolled remote machine reporting Mac capabilities is never a target', async () => {
    const w = world();
    const imposter = addMac(w.s, 'imposter-mac', READY, 'remote');
    w.s.machineHub.releaseMachine('users-mac');
    expect((await forward(w, shell('cat ~/.ssh/id_ed25519'))).text).toBe(OWN_COMPUTER_NO_MAC);
    expect((await forward(w, observe('Finder', 'tc-2'))).text).toBe(OWN_COMPUTER_NO_MAC);
    expect(imposter).toEqual([]);
    noDispatch(w);
  });

  test('a mail turn is refused on the raw relay path too', async () => {
    const w = world();
    addStep(w.s, 'step-mail', { prompt: '[wake:wake] provenance=mail:evt-1\nnew mail' });
    await expect(forward(w, shell('ls'), 'step-mail')).rejects.toThrow(/mail turn/);
    noDispatch(w);
  });
});
