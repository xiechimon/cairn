import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { ComputerCall, ComputerFrame, ComputerTool, MachineStreamEvent } from '@cairn/shared';
import { OWN_COMPUTER_NO_MAC } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { computerMachineName as daemonComputerMachineName } from '../../daemon/src/computer/host-desktop.js';
import { createCoordinatorServerApi } from '../src/coordinator/server-api.js';
import {
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  computerBrowserLease as computerBrowserLeaseTable,
  computerCall as computerCallTable,
  computer as computerTable,
  machine as machineTable,
  mcpConnector as mcpConnectorTable,
  step as stepTable,
  user as userTable,
} from '../src/db/schema.js';
import {
  COMPUTER_BROWSER_UNAVAILABLE,
  COMPUTER_BUSY,
  COMPUTER_EXECUTION_LEASE_MS,
  COMPUTER_NOT_CONNECTED,
  COMPUTER_SCREEN_DEADLINE_MS,
  COMPUTER_START_ALLOWANCE_MS,
  COMPUTER_USER_CONTROL,
  computerCallId,
  computerDeadlineMs,
  computerMachineName,
  dropComputerWaiters,
  forwardComputerCall,
  receiveComputerFrames,
  stopStepComputer,
  teamOffersDesktop,
} from '../src/services/machine-computer.js';
import { type MachineDeps, withFencedTransaction } from '../src/services/machine-deps.js';
import { executeRelayToolCall } from '../src/services/machine-relay.js';
import { markPresence } from '../src/services/machines.js';
import { bootServer, seedRoute, type TestServer } from './helpers.js';

vi.setConfig({ testTimeout: 30_000 });

const THREAD = 'chief-forward-thread';
const FAKE_TOKEN = `ghp_${'a1B2c3D4e5'.repeat(3)}`;

let server: TestServer | null = null;
afterEach(() => {
  vi.useRealTimers();
  dropComputerWaiters();
  server?.dispose();
  server = null;
});

function addMachine(
  s: TestServer,
  id: string,
  capabilities: { computer?: true; ownComputer?: true; browser?: true },
  lastSeenAt = 1,
) {
  s.db
    .insert(machineTable)
    .values({
      id,
      teamId: s.team.id,
      name: id,
      online: true,
      lastSeenAt,
      capabilities: { mcpServers: [], skills: [], ...capabilities },
    })
    .run();
}

const inCairnBrowser = (machine: string, text: string) =>
  `[Browser: Cairn's own browser on ${machine}, separate from the owner's Chrome and its sign-ins; nobody can watch or take it over.]\n${text}`;

const inOwnerChrome = (machine: string, text: string) =>
  `[Browser: the owner's own Chrome on ${machine}, through Browser MCP; the owner can watch it in Chrome, but there is no coordinated takeover handoff.]\n${text}`;

function connect(s: TestServer, machineId: string): ComputerCall[] {
  const calls: ComputerCall[] = [];
  s.machineHub.subscribeMachine(s.team.id, machineId, (ev: MachineStreamEvent) => {
    if (ev.type === 'computer') calls.push(ev.call);
  });
  return calls;
}

function watchFeed(s: TestServer): Record<string, unknown>[] {
  const events: Record<string, unknown>[] = [];
  s.hub.subscribe(
    s.team.id,
    {
      nextSeq: () => 1,
      send: async (payload) => {
        events.push(payload as Record<string, unknown>);
      },
    },
    s.user.id,
  );
  return events;
}

function addStep(s: TestServer, id: string, machineId: string, status = 'claimed') {
  s.db
    .insert(stepTable)
    .values({
      id,
      buildId: THREAD,
      kind: 'chief',
      machineId,
      status: status as 'claimed',
      prompt: 'work',
      createdAt: 2,
    })
    .run();
}

function boot(): { s: TestServer; deps: MachineDeps; chiefId: string } {
  const s = bootServer();
  server = s;
  addMachine(s, 'sidecar', {});
  seedRoute(s, 'coordinator', { provider: 'stub-gw', modelId: 'stub-model', machineId: 'sidecar' });
  const chiefId = `chief-${s.svc.user.id}-${s.team.id}`;
  s.db
    .insert(chiefTable)
    .values({
      id: chiefId,
      userId: s.svc.user.id,
      teamId: s.team.id,
      createdAt: 1,
    })
    .onConflictDoNothing()
    .run();
  s.db
    .insert(chiefThreadTable)
    .values({
      id: THREAD,
      chiefId,
      userId: s.svc.user.id,
      teamId: s.team.id,
      title: 'forward',
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
  addStep(s, 'step-a', 'sidecar');
  const deps: MachineDeps = {
    ...s.svc,
    box: s.secretBox,
    reposDir: s.reposDir,
    attachmentsDir: s.attachmentsDir,
    skillsDir: s.skillsDir,
  };
  return { s, deps, chiefId };
}

function shell(command: string, toolCallId = 'tc-1') {
  return {
    computer: true as const,
    name: 'computer_act' as const,
    toolCallId,
    params: { command },
  };
}

function callRow(s: TestServer, id: string) {
  const row = s.db.select().from(computerCallTable).where(eq(computerCallTable.id, id)).get();
  if (!row) throw new Error('call row missing');
  return row;
}

function done(seq: number, text: string, exitCode: number | null = 0): ComputerFrame {
  return { kind: 'done', seq, text, exitCode };
}

test('every dispatched Orb tool has a server grant regression case', () => {
  const dispatcher = readFileSync(
    new URL('../../daemon/src/computer/dispatch.ts', import.meta.url),
    'utf8',
  );
  const inventory = dispatcher.match(/const ORB_TOOLS[^[]*\[([\s\S]*?)\]/)![1]!;
  const tools = [...inventory.matchAll(/'([^']+)'/g)].map((match) => match[1]);
  expect(tools).toEqual([
    'shell',
    'list_files',
    'read_file',
    'write_file',
    'computer_observe',
    'computer_act',
    'desktop_snapshot',
    'desktop_act',
    'browser_navigate',
    'browser_snapshot',
    'browser_act',
  ]);
});

describe('Coordinator desktop tools', () => {
  test('teamOffersDesktop follows the computer capability', () => {
    const { s, deps } = boot();
    expect(teamOffersDesktop(deps.db, s.team.id)).toBe(false);
    addMachine(s, 'omarchy', { computer: true });
    expect(teamOffersDesktop(deps.db, s.team.id)).toBe(true);
  });

  test('computer_observe reaches the scope computer and its screenshot comes back as an image', async () => {
    const { s, deps, chiefId } = boot();
    addMachine(s, 'omarchy', { computer: true });
    const calls = connect(s, 'omarchy');
    s.db.update(stepTable).set({ machineId: null }).where(eq(stepTable.id, 'step-a')).run();
    const image = { data: 'iVBORw0KGgo=', mimeType: 'image/png' as const };
    const result = createCoordinatorServerApi(deps).relayComputer(
      'step-a',
      'computer_observe',
      {},
      'tc-observe',
    );
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ tool: 'computer_observe', scopeKey: `chief:${chiefId}` });
    receiveComputerFrames(s.db, s.hub, 'omarchy', calls[0]!.callId, [
      { kind: 'done', seq: 1, text: 'screen 1600x1000', images: [image] },
    ]);
    expect(await result).toEqual({ text: 'screen 1600x1000', images: [image] });
  });

  test.each([
    ['user_computer_shell', { command: 'ls' }],
    ['user_computer_observe', { app: 'Finder' }],
    ['user_computer_act', { app: 'Finder', actions: [{ kind: 'wait', ms: 1 }] }],
  ] as const)(
    'relayTool routes %s to the own Mac instead of unknown chief tool',
    async (name, params) => {
      const { s, deps } = boot();
      s.db.update(stepTable).set({ machineId: null }).where(eq(stepTable.id, 'step-a')).run();
      await expect(
        createCoordinatorServerApi(deps).relayTool('step-a', name, params, 'tc-own'),
      ).resolves.toBe(OWN_COMPUTER_NO_MAC);
    },
  );
});

describe('Coordinator shell and desktop start-up', () => {
  test('the Coordinator VM shell channel is refused while desktop tools run through the relay', async () => {
    const { s, deps, chiefId } = boot();
    addMachine(s, 'omarchy', { computer: true });
    const calls = connect(s, 'omarchy');
    s.db.update(stepTable).set({ machineId: null }).where(eq(stepTable.id, 'step-a')).run();
    await expect(
      forwardComputerCall(deps, null, 'step-a', {
        computer: true,
        name: 'shell',
        toolCallId: 'tc-shell',
        params: { command: 'echo hi' },
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(calls).toHaveLength(0);
    const result = createCoordinatorServerApi(deps).relayTool(
      'step-a',
      'desktop_act',
      { actions: [] },
      'tc-desktop-act',
    );
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      tool: 'desktop_act',
      scopeKey: `chief:${chiefId}`,
      params: { actions: [] },
    });
    receiveComputerFrames(s.db, s.hub, 'omarchy', calls[0]!.callId, [done(1, '', 0)]);
    expect(await result).toBe('');
  });

  test.each([
    ['starting', COMPUTER_SCREEN_DEADLINE_MS + COMPUTER_START_ALLOWANCE_MS],
    ['running', COMPUTER_SCREEN_DEADLINE_MS],
  ] as const)(
    'desktop_snapshot on a %s computer gets a %i ms deadline',
    async (state, deadlineMs) => {
      const { s, deps, chiefId } = boot();
      addMachine(s, 'omarchy', { computer: true });
      s.db
        .insert(computerTable)
        .values({
          id: 'cold-computer',
          teamId: s.team.id,
          scopeKey: `chief:${chiefId}`,
          machineId: 'omarchy',
          providerRef: 'cold',
          state,
          createdAt: 1,
          updatedAt: 1,
        })
        .run();
      const calls = connect(s, 'omarchy');
      const before = Date.now();
      const pending = forwardComputerCall(deps, 'sidecar', 'step-a', {
        computer: true,
        name: 'desktop_snapshot',
        toolCallId: 'snap-cold',
        params: {},
      });
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      const granted = calls[0]!.deadlineAt - before;
      expect(granted).toBeGreaterThanOrEqual(deadlineMs);
      expect(granted).toBeLessThan(deadlineMs + 5_000);
      receiveComputerFrames(s.db, s.hub, 'omarchy', calls[0]!.callId, [done(1, 'ok')]);
      await pending;
    },
  );
});

describe('forwardComputerCall target and presence', () => {
  test.each(['shell', 'list_files', 'read_file', 'write_file'] as ComputerTool[])(
    'Coordinator chief steps refuse removed VM command/file tool %s before dispatch',
    async (name) => {
      const { s, deps } = boot();
      addMachine(s, 'omarchy', { computer: true, browser: true });
      const calls = connect(s, 'omarchy');
      await expect(
        forwardComputerCall(deps, 'sidecar', 'step-a', {
          computer: true,
          name,
          toolCallId: `refused-${name}`,
          params: {},
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect(calls).toEqual([]);
    },
  );

  test.each([
    'computer_observe',
    'computer_act',
    'desktop_snapshot',
    'desktop_act',
    'browser_navigate',
    'browser_snapshot',
    'browser_act',
  ] as ComputerTool[])(
    'capability gates %s before dispatch and survives presence',
    async (name) => {
      const { s, deps, chiefId } = boot();
      addMachine(s, 'omarchy', { computer: true, browser: true });
      s.db
        .insert(computerTable)
        .values({
          id: 'grant-computer',
          teamId: s.team.id,
          scopeKey: `chief:${chiefId}`,
          machineId: 'omarchy',
          providerRef: 'grant',
          createdAt: 1,
          updatedAt: 1,
        })
        .run();
      const calls = connect(s, 'omarchy');
      const body = { computer: true as const, name, toolCallId: 'grant', params: {} };
      s.db
        .update(machineTable)
        .set({ capabilities: { mcpServers: [], skills: [] } })
        .where(eq(machineTable.id, 'omarchy'))
        .run();
      await expect(forwardComputerCall(deps, 'sidecar', 'step-a', body)).rejects.toMatchObject({
        status: 403,
      });
      expect(calls).toEqual([]);
      markPresence(deps, 'omarchy', {
        capabilities: { mcpServers: [], skills: [], computer: true, browser: true },
      });
      const result = forwardComputerCall(deps, 'sidecar', 'step-a', body);
      expect(calls).toHaveLength(1);
      receiveComputerFrames(s.db, s.hub, 'omarchy', calls[0]!.callId, [done(1, 'granted')]);
      expect((await result).text).toBe(
        name.startsWith('browser_') ? inCairnBrowser('omarchy', 'granted') : 'granted',
      );
      markPresence(deps, 'omarchy', { capabilities: { mcpServers: [], skills: [] } });
      expect(
        s.db.select().from(machineTable).where(eq(machineTable.id, 'omarchy')).get()?.capabilities
          ?.browser,
      ).toBeUndefined();
    },
  );

  test.each([
    ['computer_observe', 'desktop'],
    ['computer_act', 'desktop'],
    ['desktop_snapshot', 'desktop'],
    ['desktop_act', 'desktop'],
    ['browser_navigate', 'browser'],
    ['browser_snapshot', 'browser'],
    ['browser_act', 'browser'],
  ] as const)('a granted %s call reaches the daemon stamped %s', async (name, grant) => {
    const { s, deps } = boot();
    addMachine(s, 'omarchy', { computer: true, browser: true });
    const calls = connect(s, 'omarchy');
    const pending = forwardComputerCall(deps, 'sidecar', 'step-a', {
      computer: true,
      name,
      toolCallId: `stamp-${name}`,
      params: name === 'browser_navigate' ? { url: 'https://example.com' } : {},
    });
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ tool: name, computerGrant: grant });
    receiveComputerFrames(s.db, s.hub, 'omarchy', calls[0]!.callId, [done(1, 'ok')]);
    await pending;
  });

  test('a new computer skips a newer ineligible machine and uses an eligible one', async () => {
    const { s, deps } = boot();
    addMachine(s, 'older', { computer: true, browser: true }, 1);
    addMachine(s, 'newer', { computer: true, browser: true }, 5);
    s.db
      .update(machineTable)
      .set({ capabilities: { mcpServers: [], skills: [], computer: true } })
      .where(eq(machineTable.id, 'newer'))
      .run();
    const olderCalls = connect(s, 'older');
    connect(s, 'newer');
    const browser = forwardComputerCall(deps, 'sidecar', 'step-a', {
      computer: true,
      name: 'browser_navigate',
      toolCallId: 'browser-pick',
      params: { url: 'https://example.com' },
    });
    expect(olderCalls).toHaveLength(1);
    receiveComputerFrames(s.db, s.hub, 'older', olderCalls[0]!.callId, [done(1, 'picked')]);
    expect((await browser).text).toBe(inCairnBrowser('older', 'picked'));
    expect(s.db.select().from(computerTable).get()?.machineId).toBe('older');
  });

  test('browser tools refuse when the pinned machine no longer reports browser capability', async () => {
    const { s, deps, chiefId } = boot();
    addMachine(s, 'omarchy', { computer: true, browser: true });
    connect(s, 'omarchy');
    addStep(s, 'step-stale-browser', 'omarchy');
    const now = Date.now();
    s.db
      .insert(computerTable)
      .values({
        id: 'comp-browser',
        teamId: s.team.id,
        scopeKey: `chief:${chiefId}`,
        machineId: 'omarchy',
        providerRef: computerMachineName(`chief:${chiefId}`),
        state: 'stopped',
        createdAt: now,
        updatedAt: now,
      })
      .run();
    s.db
      .update(machineTable)
      .set({ capabilities: { mcpServers: [], skills: [], computer: true } })
      .where(eq(machineTable.id, 'omarchy'))
      .run();
    await expect(
      forwardComputerCall(deps, 'omarchy', 'step-stale-browser', {
        computer: true,
        name: 'browser_navigate',
        toolCallId: 'browser-stale',
        params: { url: 'https://example.com' },
      }),
    ).rejects.toMatchObject({ status: 403, message: COMPUTER_BROWSER_UNAVAILABLE });
    expect(COMPUTER_BROWSER_UNAVAILABLE).toContain('Browser MCP');
    expect(COMPUTER_BROWSER_UNAVAILABLE).not.toContain('image');
    expect(s.db.select().from(computerCallTable).all()).toEqual([]);
  });

  test('an offline target fails at once, sends no stream event and writes no row', async () => {
    const { s, deps } = boot();
    addMachine(s, 'omarchy', { computer: true });
    const calls: ComputerCall[] = [];
    await expect(forwardComputerCall(deps, 'sidecar', 'step-a', shell('ls'))).rejects.toThrow(
      COMPUTER_NOT_CONNECTED,
    );
    expect(calls).toEqual([]);
    expect(s.db.select().from(computerCallTable).all()).toEqual([]);
    expect(s.db.select().from(computerTable).all()).toEqual([]);
  });

  test('a team with no computer-capable machine gets a clear error', async () => {
    const { deps } = boot();
    await expect(forwardComputerCall(deps, 'sidecar', 'step-a', shell('ls'))).rejects.toThrow(
      'no machine in this team offers a Coordinator computer',
    );
  });

  test('a step that is not the caller own, not chief or not claimed is refused', async () => {
    const { s, deps } = boot();
    addMachine(s, 'omarchy', { computer: true });
    const calls = connect(s, 'omarchy');
    addStep(s, 'step-pending', 'sidecar', 'pending');
    s.db
      .insert(stepTable)
      .values({
        id: 'step-build',
        buildId: THREAD,
        kind: 'build',
        machineId: 'sidecar',
        status: 'claimed',
        prompt: 'x',
        createdAt: 2,
      })
      .run();
    await expect(forwardComputerCall(deps, 'omarchy', 'step-a', shell('ls'))).rejects.toMatchObject(
      { name: 'NotFoundError' },
    );
    await expect(
      forwardComputerCall(deps, 'sidecar', 'step-pending', shell('ls')),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      forwardComputerCall(deps, 'sidecar', 'step-build', shell('ls')),
    ).rejects.toMatchObject({ status: 400 });
    expect(calls).toEqual([]);
  });

  test('the Coordinator computer is created on first use, bound to the connected machine, with the Orb name', async () => {
    const { s, deps, chiefId } = boot();
    addMachine(s, 'omarchy', { computer: true });
    const calls = connect(s, 'omarchy');
    void forwardComputerCall(deps, 'sidecar', 'step-a', shell('ls'));
    const row = s.db.select().from(computerTable).get();
    expect(row?.scopeKey).toBe(`chief:${chiefId}`);
    expect(row?.machineId).toBe('omarchy');
    expect(row?.providerRef).toBe(computerMachineName(`chief:${chiefId}`));
    expect(calls[0]?.scopeKey).toBe(`chief:${chiefId}`);
    expect(calls[0]?.callId).toBe(computerCallId('step-a', 'tc-1'));
  });

  test('the Orb machine name matches the daemon', () => {
    expect(computerMachineName('chief:abc')).toBe(daemonComputerMachineName('chief:abc'));
  });
});

describe('forwardComputerCall replay', () => {
  async function started(command = 'ls', toolCallId = 'tc-1') {
    const ctx = boot();
    addMachine(ctx.s, 'omarchy', { computer: true });
    const calls = connect(ctx.s, 'omarchy');
    const result = forwardComputerCall(ctx.deps, 'sidecar', 'step-a', shell(command, toolCallId));
    return { ...ctx, calls, result, id: computerCallId('step-a', toolCallId) };
  }

  test('the computer state follows the machine presence report, not the calls in flight', async () => {
    const { s, deps, result, id } = await started();
    const { scopeKey, providerRef } = s.db.select().from(computerTable).get() ?? {
      scopeKey: '',
      providerRef: '',
    };
    markPresence(deps, 'omarchy', { computers: [{ scopeKey, providerRef, state: 'running' }] });
    expect(s.db.select().from(computerTable).get()?.state).toBe('running');
    receiveComputerFrames(s.db, s.hub, 'omarchy', id, [
      { kind: 'output', seq: 1, stream: 'stdout', text: 'a' },
    ]);
    receiveComputerFrames(s.db, s.hub, 'omarchy', id, [done(2, 'done', 0)]);
    await result;
    expect(s.db.select().from(computerTable).get()?.state).toBe('running');
    markPresence(deps, 'omarchy', { computers: [{ scopeKey, providerRef, state: 'stopped' }] });
    expect(s.db.select().from(computerTable).get()?.state).toBe('stopped');
  });

  test('a finished unsafe call retried with the same toolCallId returns the stored result and dispatches nothing', async () => {
    const { s, deps, calls, result, id } = await started();
    receiveComputerFrames(s.db, s.hub, 'omarchy', id, [done(1, 'file-a', 0)]);
    expect(await result).toEqual({ text: 'file-a' });
    const again = await forwardComputerCall(deps, 'sidecar', 'step-a', shell('ls'));
    expect(again).toEqual({ text: 'file-a' });
    expect(calls).toHaveLength(1);
  });

  test('a non-zero exit code is part of the stored result', async () => {
    const { s, result, id } = await started();
    receiveComputerFrames(s.db, s.hub, 'omarchy', id, [done(1, 'boom', 2)]);
    expect((await result).text).toBe('boom\n[exit code 2]');
  });

  test('an unsafe call in flight whose waiter is gone is marked interrupted and not re-dispatched', async () => {
    const { s, deps, calls, id } = await started();
    const feed = watchFeed(s);
    dropComputerWaiters();
    const again = await forwardComputerCall(deps, 'sidecar', 'step-a', shell('ls'));
    expect(again.text).toContain('interrupted, may have partially run');
    expect(calls).toHaveLength(1);
    expect(callRow(s, id).state).toBe('interrupted');
    expect(feed.filter((event) => event.type === 'computer.state')).not.toEqual([]);
  });

  test('a terminal frame after the waiter is gone still tells the owner the computer changed', async () => {
    const { s, id } = await started();
    const feed = watchFeed(s);
    dropComputerWaiters();
    receiveComputerFrames(s.db, s.hub, 'omarchy', id, [
      { kind: 'output', seq: 1, stream: 'stdout', text: 'late ' },
    ]);
    receiveComputerFrames(s.db, s.hub, 'omarchy', id, [done(2, 'late-done', 0)]);
    expect(callRow(s, id).state).toBe('done');
    expect(feed.filter((event) => event.type === 'computer.state')).not.toEqual([]);
  });

  test('a toolCallId reused with a different tool is refused and the stored call is kept', async () => {
    const { s, deps } = boot();
    addMachine(s, 'omarchy', { computer: true });
    const calls = connect(s, 'omarchy');
    const first = forwardComputerCall(deps, 'sidecar', 'step-a', shell('rm -rf build', 'reuse'));
    const [sent] = calls;
    if (!sent) throw new Error('no dispatch');
    receiveComputerFrames(s.db, s.hub, 'omarchy', sent.callId, [
      { kind: 'done', seq: 1, text: 'ok', exitCode: 0 },
    ]);
    await first;
    await expect(
      forwardComputerCall(deps, 'sidecar', 'step-a', {
        computer: true,
        name: 'computer_observe',
        toolCallId: 'reuse',
        params: {},
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(calls).toHaveLength(1);
  });

  test('a safe call retried is re-dispatched under a new attempt id with fresh frame state', async () => {
    const ctx = boot();
    addMachine(ctx.s, 'omarchy', { computer: true });
    const calls = connect(ctx.s, 'omarchy');
    const read = {
      computer: true as const,
      name: 'computer_observe' as const,
      toolCallId: 'r1',
      params: {},
    };
    const first = forwardComputerCall(ctx.deps, 'sidecar', 'step-a', read);
    const id = computerCallId('step-a', 'r1');
    expect(calls[0]?.callId).toBe(createHash('sha256').update('step-a\0r1').digest('hex'));
    receiveComputerFrames(ctx.s.db, ctx.s.hub, 'omarchy', id, [done(1, 'first')]);
    expect((await first).text).toBe('first');
    const second = forwardComputerCall(ctx.deps, 'sidecar', 'step-a', read);
    expect(calls).toHaveLength(2);
    const rerunId = computerCallId('step-a', 'r1', 2);
    expect(calls[1]?.callId).toBe(rerunId);
    expect(rerunId).not.toBe(id);
    expect(callRow(ctx.s, rerunId)).toMatchObject({
      state: 'dispatched',
      lastSeq: 0,
      resultText: null,
    });
    receiveComputerFrames(ctx.s.db, ctx.s.hub, 'omarchy', rerunId, [done(1, 'second')]);
    expect((await second).text).toBe('second');
  });

  test('a late done from the superseded execution is refused and does not resolve the rerun', async () => {
    const ctx = boot();
    addMachine(ctx.s, 'omarchy', { computer: true });
    const calls = connect(ctx.s, 'omarchy');
    const read = {
      computer: true as const,
      name: 'computer_observe' as const,
      toolCallId: 'r1',
      params: {},
    };
    void forwardComputerCall(ctx.deps, 'sidecar', 'step-a', read);
    dropComputerWaiters();
    const rerun = forwardComputerCall(ctx.deps, 'sidecar', 'step-a', read);
    const [original, again] = calls;
    expect(again?.callId).not.toBe(original?.callId);
    expect(callRow(ctx.s, computerCallId('step-a', 'r1'))).toMatchObject({
      state: 'interrupted',
      errorMessage: 'superseded by a rerun',
    });
    expect(() =>
      receiveComputerFrames(ctx.s.db, ctx.s.hub, 'omarchy', computerCallId('step-a', 'r1'), [
        done(1, 'stale'),
      ]),
    ).toThrow(expect.objectContaining({ status: 409 }));
    receiveComputerFrames(ctx.s.db, ctx.s.hub, 'omarchy', computerCallId('step-a', 'r1', 2), [
      done(1, 'fresh'),
    ]);
    expect((await rerun).text).toBe('fresh');
  });

  test('concurrent duplicate requests for the same callId dispatch once and share the result', async () => {
    const { s, deps, calls, id } = await started();
    const dup = forwardComputerCall(deps, 'sidecar', 'step-a', shell('ls'));
    const dup2 = forwardComputerCall(deps, 'sidecar', 'step-a', shell('ls'));
    expect(calls).toHaveLength(1);
    receiveComputerFrames(s.db, s.hub, 'omarchy', id, [done(1, 'once')]);
    expect(await dup).toEqual({ text: 'once' });
    expect(await dup2).toEqual({ text: 'once' });
  });
});

describe('forwardComputerCall daemon errors and deadlines', () => {
  async function started() {
    const ctx = boot();
    addMachine(ctx.s, 'omarchy', { computer: true });
    const calls = connect(ctx.s, 'omarchy');
    const result = forwardComputerCall(ctx.deps, 'sidecar', 'step-a', shell('ls'));
    return { ...ctx, calls, result, id: computerCallId('step-a', 'tc-1') };
  }

  test('an error frame with not_delivered says the action did not run', async () => {
    const { s, result, id } = await started();
    receiveComputerFrames(s.db, s.hub, 'omarchy', id, [
      { kind: 'error', seq: 1, message: 'orb is down', delivery: 'not_delivered' },
    ]);
    const text = (await result).text;
    expect(text).toContain('orb is down');
    expect(text).toContain('did not run');
  });

  test('an error frame with unknown delivery says the action may have partially run', async () => {
    const { s, result, id } = await started();
    receiveComputerFrames(s.db, s.hub, 'omarchy', id, [
      { kind: 'error', seq: 1, message: 'socket closed', delivery: 'unknown' },
    ]);
    expect((await result).text).toContain('may have partially run');
  });

  test('a deadline with no frames marks an unsafe call interrupted and a safe call error', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    const { s, deps, result, id } = await started();
    const read = forwardComputerCall(deps, 'sidecar', 'step-a', {
      computer: true,
      name: 'computer_observe',
      toolCallId: 'r1',
      params: {},
    });
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    expect((await result).text).toContain('interrupted, may have partially run');
    expect(callRow(s, id).state).toBe('interrupted');
    expect((await read).text).toContain('timed out');
    expect(callRow(s, computerCallId('step-a', 'r1')).state).toBe('error');
  });

  test('deadlines follow Rakazo: shell timeout plus 30 s, screen 2 min, the rest 10 min', () => {
    expect(computerDeadlineMs('shell', { command: 'x' })).toBe(5 * 60_000 + 30_000);
    expect(computerDeadlineMs('user_computer_shell', { command: 'x', timeoutMs: 60_000 })).toBe(
      90_000,
    );
    expect(computerDeadlineMs('shell', { command: 'x', timeoutMs: 99 * 3_600_000 })).toBe(
      5 * 60_000 + 30_000,
    );
    expect(computerDeadlineMs('computer_act', {})).toBe(120_000);
    expect(computerDeadlineMs('computer_act', {}, true)).toBe(120_000 + 5 * 60_000);
    expect(computerDeadlineMs('open_path', {})).toBe(120_000);
    expect(computerDeadlineMs('read_file', {})).toBe(600_000);
    expect(computerDeadlineMs('browser_navigate', {})).toBe(600_000);
  });
});

describe('stop and finish', () => {
  test('a stopped step cancels its call: the row is cancelled, the waiter resolves and the frames post answers cancelled', async () => {
    const ctx = boot();
    addMachine(ctx.s, 'omarchy', { computer: true });
    connect(ctx.s, 'omarchy');
    const result = forwardComputerCall(ctx.deps, 'sidecar', 'step-a', shell('sleep 99'));
    const id = computerCallId('step-a', 'tc-1');
    ctx.s.machineHub.stopSignal(ctx.s.team.id, 'step-a');
    expect((await result).text).toContain('cancelled');
    expect(callRow(ctx.s, id).state).toBe('cancelled');
    const answer = receiveComputerFrames(ctx.s.db, ctx.s.hub, 'omarchy', id, [
      { kind: 'heartbeat', seq: 1 },
    ]);
    expect(answer).toEqual({ ok: true, cancelled: true });
    expect(ctx.s.db.select().from(computerTable).get()?.executionStepId).toBeNull();
  });

  test('rolling back a fenced stop leaves the live computer waiter and its lease in place', async () => {
    const ctx = boot();
    addMachine(ctx.s, 'omarchy', { computer: true });
    const calls = connect(ctx.s, 'omarchy');
    const result = forwardComputerCall(ctx.deps, 'sidecar', 'step-a', shell('ls'));
    const id = computerCallId('step-a', 'tc-1');
    expect(calls).toHaveLength(1);

    expect(() =>
      withFencedTransaction(ctx.deps, (deps) => {
        stopStepComputer(deps, 'step-a');
        throw new Error('rollback fenced stop');
      }),
    ).toThrow('rollback fenced stop');
    expect(callRow(ctx.s, id).state).toBe('dispatched');
    expect(ctx.s.db.select().from(computerTable).get()?.executionStepId).toBe('step-a');
    receiveComputerFrames(ctx.s.db, ctx.s.hub, 'omarchy', id, [done(1, 'still live')]);
    expect((await result).text).toContain('still live');
  });

  test('frames for a call whose step is no longer claimed are answered cancelled', async () => {
    const ctx = boot();
    addMachine(ctx.s, 'omarchy', { computer: true });
    connect(ctx.s, 'omarchy');
    const result = forwardComputerCall(ctx.deps, 'sidecar', 'step-a', shell('ls'));
    const id = computerCallId('step-a', 'tc-1');
    ctx.s.db.update(stepTable).set({ status: 'stopped' }).where(eq(stepTable.id, 'step-a')).run();
    const answer = receiveComputerFrames(ctx.s.db, ctx.s.hub, 'omarchy', id, [
      { kind: 'heartbeat', seq: 1 },
    ]);
    expect(answer.cancelled).toBe(true);
    expect((await result).text).toContain('cancelled');
  });

  test('stopStepComputer releases the lease of a finished step', async () => {
    const ctx = boot();
    addMachine(ctx.s, 'omarchy', { computer: true });
    connect(ctx.s, 'omarchy');
    void forwardComputerCall(ctx.deps, 'sidecar', 'step-a', shell('ls'));
    expect(ctx.s.db.select().from(computerTable).get()?.executionStepId).toBe('step-a');
    stopStepComputer(ctx.deps, 'step-a');
    expect(ctx.s.db.select().from(computerTable).get()?.executionStepId).toBeNull();
  });

  test('an in-server Coordinator turn that finishes releases the computer lease', async () => {
    const ctx = boot();
    addMachine(ctx.s, 'omarchy', { computer: true });
    connect(ctx.s, 'omarchy');
    void forwardComputerCall(ctx.deps, 'sidecar', 'step-a', shell('ls'));
    expect(ctx.s.db.select().from(computerTable).get()?.executionStepId).toBe('step-a');
    ctx.s.db.update(stepTable).set({ machineId: null }).where(eq(stepTable.id, 'step-a')).run();
    await createCoordinatorServerApi(ctx.deps).done('step-a', { status: 'success' });
    expect(ctx.s.db.select().from(computerTable).get()?.executionStepId).toBeNull();
  });

  test('aborting the relay signal cancels the dispatched call instead of abandoning it', async () => {
    const ctx = boot();
    addMachine(ctx.s, 'omarchy', { computer: true });
    connect(ctx.s, 'omarchy');
    const controller = new AbortController();
    const result = forwardComputerCall(ctx.deps, 'sidecar', 'step-a', shell('sleep 99'), {
      signal: controller.signal,
    });
    const id = computerCallId('step-a', 'tc-1');
    controller.abort();
    expect((await result).text).toContain('cancelled');
    expect(callRow(ctx.s, id).state).toBe('cancelled');
    expect(ctx.s.db.select().from(computerTable).get()?.executionStepId).toBeNull();
  });

  test('without a relay signal a transport abort does not cancel the dispatched call', async () => {
    const ctx = boot();
    addMachine(ctx.s, 'omarchy', { computer: true });
    connect(ctx.s, 'omarchy');
    const transport = new AbortController();
    const result = forwardComputerCall(ctx.deps, 'sidecar', 'step-a', shell('sleep 99'));
    const id = computerCallId('step-a', 'tc-1');
    transport.abort();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(callRow(ctx.s, id).state).toBe('dispatched');
    ctx.s.machineHub.stopSignal(ctx.s.team.id, 'step-a');
    expect((await result).text).toContain('cancelled');
  });
});

describe('leases', () => {
  async function twoSteps() {
    const ctx = boot();
    addMachine(ctx.s, 'omarchy', { computer: true });
    const calls = connect(ctx.s, 'omarchy');
    addStep(ctx.s, 'step-b', 'sidecar');
    void forwardComputerCall(ctx.deps, 'sidecar', 'step-a', shell('ls'));
    return { ...ctx, calls };
  }

  test('a second step is refused while the lease is held, and the holder keeps its fence', async () => {
    const { s, deps, calls } = await twoSteps();
    await expect(
      forwardComputerCall(deps, 'sidecar', 'step-b', shell('ls', 'tc-b')),
    ).rejects.toThrow(COMPUTER_BUSY);
    expect(calls).toHaveLength(1);
    expect(s.db.select().from(computerTable).get()?.executionFence).toBe(1);
    void forwardComputerCall(deps, 'sidecar', 'step-a', shell('pwd', 'tc-2'));
    expect(s.db.select().from(computerTable).get()?.executionFence).toBe(1);
  });

  test('a short call by the holder does not shorten a longer lease', async () => {
    const { s, deps } = await twoSteps();
    const long = s.db.select().from(computerTable).get()?.executionLeaseExpiresAt ?? 0;
    const hour = 3_600_000;
    s.db
      .update(computerTable)
      .set({ executionLeaseExpiresAt: Date.now() + hour })
      .run();
    void forwardComputerCall(deps, 'sidecar', 'step-a', {
      computer: true,
      name: 'computer_observe',
      toolCallId: 'obs',
      params: {},
    });
    const kept = s.db.select().from(computerTable).get()?.executionLeaseExpiresAt ?? 0;
    expect(kept).toBeGreaterThan(Date.now() + hour - 5_000);
    expect(kept).toBeGreaterThan(long);
    await expect(
      forwardComputerCall(deps, 'sidecar', 'step-b', shell('ls', 'tc-b')),
    ).rejects.toThrow(COMPUTER_BUSY);
  });

  test('an expired lease is taken over with the fence incremented', async () => {
    const { s, deps, calls } = await twoSteps();
    s.db
      .update(computerTable)
      .set({ executionLeaseExpiresAt: Date.now() - 1 })
      .run();
    void forwardComputerCall(deps, 'sidecar', 'step-b', shell('ls', 'tc-b'));
    const row = s.db.select().from(computerTable).get();
    expect(calls).toHaveLength(2);
    expect(row?.executionStepId).toBe('step-b');
    expect(row?.executionFence).toBe(2);
    expect(row?.executionLeaseExpiresAt).toBeGreaterThan(
      Date.now() + COMPUTER_EXECUTION_LEASE_MS - 5_000,
    );
  });

  test('while ian holds control every bot action is refused and screen observation returns owner-control refusal', async () => {
    const { s, deps, calls } = await twoSteps();
    s.db
      .update(computerTable)
      .set({ executionStepId: null, executionLeaseExpiresAt: null, controlHolder: 'user' })
      .run();
    await expect(
      forwardComputerCall(deps, 'sidecar', 'step-a', shell('rm x', 'tc-3')),
    ).rejects.toThrow(COMPUTER_USER_CONTROL);
    const obs = await forwardComputerCall(deps, 'sidecar', 'step-a', {
      computer: true,
      name: 'computer_observe',
      toolCallId: 'r1',
      params: {},
    });
    expect(obs.text).toContain('owner');
    expect(calls).toHaveLength(1);
  });
});

describe('per-thread browser scopes', () => {
  const THREAD_B = 'chief-second-thread';

  function addThreadStep(s: TestServer, threadId: string, stepId: string, chiefId: string) {
    s.db
      .insert(chiefThreadTable)
      .values({
        id: threadId,
        chiefId,
        userId: s.user.id,
        teamId: s.team.id,
        title: 'second',
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
        id: stepId,
        buildId: threadId,
        kind: 'chief',
        machineId: 'sidecar',
        status: 'claimed',
        prompt: 'work',
        createdAt: 2,
      })
      .run();
  }

  function browserCall(toolCallId: string) {
    return {
      computer: true as const,
      name: 'browser_navigate' as const,
      toolCallId,
      params: { url: 'https://example.com' },
    };
  }

  test('browser calls from two threads run concurrently, stamped with their own browserScope', async () => {
    const ctx = boot();
    addMachine(ctx.s, 'omarchy', { computer: true, browser: true });
    const calls = connect(ctx.s, 'omarchy');
    addThreadStep(ctx.s, THREAD_B, 'step-b', ctx.chiefId);
    void forwardComputerCall(ctx.deps, 'sidecar', 'step-a', browserCall('nav-a'));
    void forwardComputerCall(ctx.deps, 'sidecar', 'step-b', browserCall('nav-b'));
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    const byStep = new Map(calls.map((call) => [call.stepId, call]));
    expect(byStep.get('step-a')?.browserScope).toBe(THREAD);
    expect(byStep.get('step-a')?.tabScope).toBe('coordinator');
    expect(byStep.get('step-b')?.browserScope).toBe(THREAD_B);
    expect(ctx.s.db.select().from(computerTable).get()?.executionStepId).toBeNull();
    const leases = ctx.s.db.select().from(computerBrowserLeaseTable).all();
    expect(leases.map((lease) => `${lease.profileKey}:${lease.stepId}`).sort()).toEqual([
      `${THREAD}:step-a`,
      `${THREAD_B}:step-b`,
    ]);
  });

  test('a second step on the same thread profile is busy; the execution lease is untouched', async () => {
    const ctx = boot();
    addMachine(ctx.s, 'omarchy', { computer: true, browser: true });
    const calls = connect(ctx.s, 'omarchy');
    addStep(ctx.s, 'step-b', 'sidecar');
    void forwardComputerCall(ctx.deps, 'sidecar', 'step-a', browserCall('nav-a'));
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await expect(
      forwardComputerCall(ctx.deps, 'sidecar', 'step-b', browserCall('nav-b')),
    ).rejects.toThrow(COMPUTER_BUSY);
    expect(calls).toHaveLength(1);
    expect(ctx.s.db.select().from(computerTable).get()?.executionStepId).toBeNull();
    void forwardComputerCall(ctx.deps, 'sidecar', 'step-b', shell('ls', 'tc-b'));
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(ctx.s.db.select().from(computerTable).get()?.executionStepId).toBe('step-b');
  });

  test('an expired profile lease is taken over with the fence incremented', async () => {
    const ctx = boot();
    addMachine(ctx.s, 'omarchy', { computer: true, browser: true });
    const calls = connect(ctx.s, 'omarchy');
    addStep(ctx.s, 'step-b', 'sidecar');
    void forwardComputerCall(ctx.deps, 'sidecar', 'step-a', browserCall('nav-a'));
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    ctx.s.db
      .update(computerBrowserLeaseTable)
      .set({ expiresAt: Date.now() - 1 })
      .run();
    void forwardComputerCall(ctx.deps, 'sidecar', 'step-b', browserCall('nav-b'));
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    const lease = ctx.s.db.select().from(computerBrowserLeaseTable).get();
    expect(lease?.stepId).toBe('step-b');
    expect(lease?.fence).toBe(2);
  });

  test('stopStepComputer releases the browser lease of a finished step', async () => {
    const ctx = boot();
    addMachine(ctx.s, 'omarchy', { computer: true, browser: true });
    connect(ctx.s, 'omarchy');
    void forwardComputerCall(ctx.deps, 'sidecar', 'step-a', browserCall('nav-a'));
    await vi.waitFor(() =>
      expect(ctx.s.db.select().from(computerBrowserLeaseTable).all()).toHaveLength(1),
    );
    stopStepComputer(ctx.deps, 'step-a');
    expect(ctx.s.db.select().from(computerBrowserLeaseTable).all()).toEqual([]);
  });
});

describe('private computer events and redaction', () => {
  test('a token in the command and the output reaches neither the hub event nor the stored rows', async () => {
    const ctx = boot();
    addMachine(ctx.s, 'omarchy', { computer: true });
    const calls = connect(ctx.s, 'omarchy');
    const feed = watchFeed(ctx.s);
    const result = forwardComputerCall(
      ctx.deps,
      'sidecar',
      'step-a',
      shell(`curl -H "Authorization: Bearer ${FAKE_TOKEN}" x && echo ${FAKE_TOKEN}`),
    );
    const id = computerCallId('step-a', 'tc-1');
    expect(calls[0]?.params.command).toContain(FAKE_TOKEN);
    receiveComputerFrames(ctx.s.db, ctx.s.hub, 'omarchy', id, [
      { kind: 'output', seq: 1, stream: 'stdout', text: `token ${FAKE_TOKEN}\n` },
      done(2, `token ${FAKE_TOKEN}`),
    ]);
    await result;
    expect(JSON.stringify(feed)).not.toContain(FAKE_TOKEN);
    expect(JSON.stringify(callRow(ctx.s, id))).not.toContain(FAKE_TOKEN);
    expect(JSON.stringify(callRow(ctx.s, id))).toContain('[REDACTED]');
  });

  test('a call tells its owner the computer changed and nobody else', async () => {
    const ctx = boot();
    addMachine(ctx.s, 'omarchy', { computer: true });
    connect(ctx.s, 'omarchy');
    const feed = watchFeed(ctx.s);
    const stranger: Record<string, unknown>[] = [];
    ctx.s.hub.subscribe(
      ctx.s.team.id,
      {
        nextSeq: () => 1,
        send: async (payload) => {
          stranger.push(payload as Record<string, unknown>);
        },
      },
      'someone-else',
    );
    const result = forwardComputerCall(ctx.deps, 'sidecar', 'step-a', shell('ls'));
    const id = computerCallId('step-a', 'tc-1');
    receiveComputerFrames(ctx.s.db, ctx.s.hub, 'omarchy', id, [done(1, 'ok')]);
    await result;
    expect(feed.filter((event) => event.type === 'computer.state')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'computer.state',
          computerId: callRow(ctx.s, id).computerId,
        }),
      ]),
    );
    expect(stranger).toEqual([]);
  });
});

describe('Coordinator tool-name errors', () => {
  test('a mistyped own-Mac tool names the valid tools instead of unknown chief tool', async () => {
    const { deps } = boot();
    const err = await executeRelayToolCall(deps, 'sidecar', 'step-a', 'user_computer_click', {
      x: 1,
    }).then(
      () => {
        throw new Error('expected a refusal');
      },
      (e: unknown) => e as Error,
    );
    expect(err.message).not.toContain('unknown chief tool');
    expect(err.message).toContain('user_computer_shell');
    expect(err.message).toContain('user_computer_observe');
    expect(err.message).toContain('user_computer_act');
  });
});

describe('the owner’s own Chrome behind browser tools', () => {
  function ownerMachine(
    s: TestServer,
    capabilities: Record<string, unknown> = { computerKind: 'host', ownerChrome: true },
    kind: 'local' | 'remote' = 'local',
  ) {
    s.db
      .insert(machineTable)
      .values({
        id: 'owner-mac',
        teamId: s.team.id,
        name: 'owner-mac',
        online: true,
        lastSeenAt: 1,
        kind,
        capabilities: {
          mcpServers: [],
          skills: [],
          computer: true,
          browser: true,
          ...capabilities,
        },
      })
      .run();
  }

  function enableBrowserMcp(s: TestServer) {
    s.db
      .insert(mcpConnectorTable)
      .values({
        id: 'conn-browsermcp',
        teamId: s.team.id,
        slug: 'browsermcp',
        label: 'Browser MCP',
        catalogId: 'browsermcp',
        transport: 'stdio',
        url: null,
        headerNames: [],
        valuesCipher: null,
        authKind: 'none',
        status: 'local',
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
  }

  async function stampFor(
    setup: (s: TestServer) => void,
    params: Record<string, unknown> = { url: 'https://mail.example.com' },
    kind: 'local' | 'remote' = 'local',
    capabilities: Record<string, unknown> = { computerKind: 'host', ownerChrome: true },
  ): Promise<ComputerCall> {
    const { s, deps } = boot();
    ownerMachine(s, capabilities, kind);
    setup(s);
    const calls = connect(s, 'owner-mac');
    const pending = forwardComputerCall(deps, 'sidecar', 'step-a', {
      computer: true,
      name: 'browser_navigate',
      toolCallId: 'owner-chrome',
      params,
    });
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    receiveComputerFrames(s.db, s.hub, 'owner-mac', calls[0]!.callId, [done(1, 'ok')]);
    await pending;
    return calls[0]!;
  }

  test('a browser call opens the owner’s Chrome when the connector is on', async () => {
    const call = await stampFor(enableBrowserMcp);
    expect(call.ownerChrome).toBe('browsermcp');
  });

  test('the stealth browser and a remote machine never take the owner’s Chrome', async () => {
    expect(
      (
        await stampFor(enableBrowserMcp, { url: 'https://a.test', stealth: true }, 'local', {
          computerKind: 'host',
        })
      ).ownerChrome,
    ).toBeUndefined();
    expect(
      (
        await stampFor(enableBrowserMcp, { url: 'https://a.test' }, 'remote', {
          computerKind: 'host',
        })
      ).ownerChrome,
    ).toBeUndefined();
  });

  test('a browser-only machine without the owner-Chrome capability cannot be misreported as owner Chrome', async () => {
    const call = await stampFor(enableBrowserMcp, undefined, 'local', {
      computerKind: 'host',
    });
    expect(call.ownerChrome).toBeUndefined();
  });

  test('turning the connector off returns browser calls to Cairn’s own browser', async () => {
    expect((await stampFor(() => {})).ownerChrome).toBeUndefined();
  });
});

describe('browser calls on Macs', () => {
  function addMac(
    s: TestServer,
    id: string,
    capabilities: Record<string, unknown>,
    { kind = 'remote', lastSeenAt = 1 }: { kind?: 'local' | 'remote'; lastSeenAt?: number } = {},
  ) {
    s.db
      .insert(machineTable)
      .values({
        id,
        teamId: s.team.id,
        name: id,
        online: true,
        lastSeenAt,
        kind,
        capabilities: { mcpServers: [], skills: [], ...capabilities },
      })
      .run();
  }

  function browserMcp(s: TestServer) {
    s.db
      .insert(mcpConnectorTable)
      .values({
        id: 'conn-browsermcp',
        teamId: s.team.id,
        slug: 'browsermcp',
        label: 'Browser MCP',
        catalogId: 'browsermcp',
        transport: 'stdio',
        url: null,
        headerNames: [],
        valuesCipher: null,
        authKind: 'none',
        status: 'local',
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
  }

  function navigate(deps: MachineDeps, toolCallId: string) {
    return forwardComputerCall(deps, 'sidecar', 'step-a', {
      computer: true,
      name: 'browser_navigate',
      toolCallId,
      params: { url: 'https://example.com' },
    });
  }

  async function next(calls: ComputerCall[], count: number): Promise<ComputerCall> {
    await vi.waitFor(() => expect(calls).toHaveLength(count));
    return calls[count - 1]!;
  }

  function answer(s: TestServer, machineId: string, call: ComputerCall, text: string) {
    receiveComputerFrames(s.db, s.hub, machineId, call.callId, [done(1, text)]);
  }

  function fail(s: TestServer, machineId: string, call: ComputerCall, message: string) {
    receiveComputerFrames(s.db, s.hub, machineId, call.callId, [
      { kind: 'error', seq: 1, message, delivery: 'not_delivered' },
    ]);
  }

  const NO_EXTENSION = "Owner's Chrome unavailable: no Chrome is connected to Browser MCP";

  function pin(s: TestServer, chiefId: string, machineId: string) {
    s.db
      .insert(computerTable)
      .values({
        id: 'pinned',
        teamId: s.team.id,
        scopeKey: `chief:${chiefId}`,
        machineId,
        providerRef: computerMachineName(`chief:${chiefId}`),
        state: 'running',
        controlHolder: 'user',
        handoffReason: 'login',
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
  }

  function addSecondThread(s: TestServer, chiefId: string) {
    s.db
      .insert(chiefThreadTable)
      .values({
        id: 'chief-thread-b',
        chiefId,
        userId: s.user.id,
        teamId: s.team.id,
        title: 'second',
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
        id: 'step-b',
        buildId: 'chief-thread-b',
        kind: 'chief',
        machineId: 'sidecar',
        status: 'claimed',
        prompt: 'work',
        createdAt: 2,
      })
      .run();
  }

  test('a Mac that reports a browser and no computer gets browser_navigate', async () => {
    const { s, deps } = boot();
    addMac(s, 'mac', { browser: true });
    const calls = connect(s, 'mac');
    const pending = navigate(deps, 'mac-browser');
    pending.catch(() => {});
    const call = await next(calls, 1);
    expect(call).toMatchObject({ tool: 'browser_navigate', computerGrant: 'browser' });
    expect(call.ownerChrome).toBeUndefined();
    answer(s, 'mac', call, 'Example Domain');
    expect((await pending).text).toBe(inCairnBrowser('mac', 'Example Domain'));
    expect(s.db.select().from(computerTable).get()?.machineId).toBe('mac');
  });

  test('with Browser MCP on, a local Mac with no Cairn browser drives the owner’s Chrome', async () => {
    const { s, deps } = boot();
    addMac(s, 'mini', { ownerChrome: true }, { kind: 'local' });
    browserMcp(s);
    const calls = connect(s, 'mini');
    const pending = navigate(deps, 'mcp-local');
    pending.catch(() => {});
    const call = await next(calls, 1);
    expect(call.ownerChrome).toBe('browsermcp');
    answer(s, 'mini', call, 'their page');
    expect((await pending).text).toBe(inOwnerChrome('mini', 'their page'));
    expect(s.db.select().from(computerTable).all()).toEqual([]);
  });

  test('the next Mac is asked when one has no extension, and is asked first afterwards', async () => {
    const { s, deps } = boot();
    addMac(s, 'mini', { browser: true, ownerChrome: true }, { kind: 'local' });
    addMac(s, 'air', { ownerChrome: true });
    browserMcp(s);
    const mini = connect(s, 'mini');
    const air = connect(s, 'air');
    const first = navigate(deps, 'failover');
    first.catch(() => {});
    const onMini = await next(mini, 1);
    expect(onMini.ownerChrome).toBe('browsermcp');
    fail(s, 'mini', onMini, NO_EXTENSION);
    const onAir = await next(air, 1);
    expect(onAir.ownerChrome).toBe('browsermcp');
    expect(onAir.callId).not.toBe(onMini.callId);
    answer(s, 'air', onAir, 'their page');
    expect((await first).text).toBe(inOwnerChrome('air', 'their page'));
    const second = navigate(deps, 'remembered');
    second.catch(() => {});
    answer(s, 'air', await next(air, 2), 'again');
    expect((await second).text).toBe(inOwnerChrome('air', 'again'));
    expect(mini).toHaveLength(1);
  });

  test('the machine remembered in one thread does not steer another thread', async () => {
    const { s, deps, chiefId } = boot();
    addMac(s, 'mini', { browser: true, ownerChrome: true }, { kind: 'local' });
    addMac(s, 'air', { ownerChrome: true });
    browserMcp(s);
    addSecondThread(s, chiefId);
    const mini = connect(s, 'mini');
    const air = connect(s, 'air');
    const first = navigate(deps, 'thread-a-failover');
    first.catch(() => {});
    fail(s, 'mini', await next(mini, 1), NO_EXTENSION);
    answer(s, 'air', await next(air, 1), 'remote page');
    await first;
    const second = forwardComputerCall(deps, 'sidecar', 'step-b', {
      computer: true,
      name: 'browser_navigate',
      toolCallId: 'thread-b-open',
      params: { url: 'https://example.com' },
    });
    second.catch(() => {});
    const local = await next(mini, 2);
    expect(local.ownerChrome).toBe('browsermcp');
    answer(s, 'mini', local, 'local page');
    expect((await second).text).toBe(inOwnerChrome('mini', 'local page'));
    expect(air).toHaveLength(1);
  });

  test('an extension waiting for Allow ends the call on that Mac', async () => {
    const { s, deps } = boot();
    addMac(s, 'mini', { browser: true, ownerChrome: true }, { kind: 'local' });
    addMac(s, 'air', { ownerChrome: true });
    browserMcp(s);
    const mini = connect(s, 'mini');
    const air = connect(s, 'air');
    const pending = navigate(deps, 'pairing');
    pending.catch(() => {});
    fail(s, 'mini', await next(mini, 1), 'Click Allow, code 123456');
    expect((await pending).text).toContain('Click Allow, code 123456');
    expect(air).toEqual([]);
    expect(mini).toHaveLength(1);
  });

  test('with no extension anywhere the page comes from Cairn’s browser and says why', async () => {
    const { s, deps } = boot();
    addMac(s, 'mini', { browser: true, ownerChrome: true }, { kind: 'local' });
    browserMcp(s);
    const calls = connect(s, 'mini');
    const pending = navigate(deps, 'fallback');
    pending.catch(() => {});
    fail(s, 'mini', await next(calls, 1), NO_EXTENSION);
    const own = await next(calls, 2);
    expect(own.ownerChrome).toBeUndefined();
    answer(s, 'mini', own, 'Example Domain');
    const { text } = await pending;
    expect(text).toContain('instead of your own Chrome');
    expect(text).toContain('no Chrome is connected to Browser MCP');
    expect(text).toContain('Example Domain');
  });

  test('after a navigate fell back to Cairn’s browser, browser_act stays in that browser', async () => {
    const { s, deps } = boot();
    addMac(s, 'mini', { browser: true, ownerChrome: true }, { kind: 'local' });
    browserMcp(s);
    const calls = connect(s, 'mini');
    const opened = navigate(deps, 'fallback-then-act');
    opened.catch(() => {});
    fail(s, 'mini', await next(calls, 1), NO_EXTENSION);
    answer(s, 'mini', await next(calls, 2), 'Example Domain');
    await opened;
    const acting = forwardComputerCall(deps, 'sidecar', 'step-a', {
      computer: true,
      name: 'browser_act',
      toolCallId: 'click-in-cairn-browser',
      params: { actions: [{ kind: 'press', text: 'Enter' }] },
    });
    acting.catch(() => {});
    const act = await next(calls, 3);
    expect(act.ownerChrome).toBeUndefined();
    answer(s, 'mini', act, 'clicked');
    expect((await acting).text).toBe('clicked');
    expect(calls).toHaveLength(3);
  });

  test('after a stealth navigate, a plain browser_act stays in Cairn’s browser', async () => {
    const { s, deps } = boot();
    addMac(s, 'mini', { browser: true, ownerChrome: true }, { kind: 'local' });
    browserMcp(s);
    const calls = connect(s, 'mini');
    const opened = forwardComputerCall(deps, 'sidecar', 'step-a', {
      computer: true,
      name: 'browser_navigate',
      toolCallId: 'stealth-open',
      params: { url: 'https://example.com', stealth: true },
    });
    opened.catch(() => {});
    answer(s, 'mini', await next(calls, 1), 'Example Domain');
    await opened;
    const acting = forwardComputerCall(deps, 'sidecar', 'step-a', {
      computer: true,
      name: 'browser_act',
      toolCallId: 'plain-after-stealth',
      params: { actions: [{ kind: 'press', text: 'Enter' }] },
    });
    acting.catch(() => {});
    const act = await next(calls, 2);
    expect(act.ownerChrome).toBeUndefined();
    answer(s, 'mini', act, 'clicked');
    expect((await acting).text).toBe('clicked');
    expect(calls).toHaveLength(2);
  });

  test('a finished fill_secret action keeps later clicks in Cairn’s browser', async () => {
    const { s, deps, chiefId } = boot();
    addMac(s, 'mini', { browser: true, ownerChrome: true }, { kind: 'local' });
    browserMcp(s);
    s.db
      .insert(computerTable)
      .values({
        id: 'secret-browser-computer',
        teamId: s.team.id,
        scopeKey: `chief:${chiefId}`,
        machineId: 'mini',
        providerRef: computerMachineName(`chief:${chiefId}`),
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    s.db
      .insert(computerCallTable)
      .values({
        id: 'finished-fill-secret',
        teamId: s.team.id,
        stepId: 'step-a',
        toolCallId: 'fill-secret-before',
        machineId: 'mini',
        computerId: 'secret-browser-computer',
        tool: 'browser_act',
        replaySafe: false,
        params: {
          actions: [
            { kind: 'fill_secret', ref: '@e1', secret: 'SITE', origin: 'https://example.com' },
          ],
        },
        state: 'done',
        deadlineAt: Date.now() + 1_000,
        createdAt: Date.now(),
        finishedAt: Date.now(),
      })
      .run();
    const calls = connect(s, 'mini');
    const acting = forwardComputerCall(deps, 'sidecar', 'step-a', {
      computer: true,
      name: 'browser_act',
      toolCallId: 'after-fill-secret',
      params: { actions: [{ kind: 'press', text: 'Enter' }] },
    });
    acting.catch(() => {});
    const act = await next(calls, 1);
    expect(act.ownerChrome).toBeUndefined();
    answer(s, 'mini', act, 'clicked');
    expect((await acting).text).toBe('clicked');
    expect(calls).toHaveLength(1);
  });

  test('with no extension and no Cairn browser the answer says why and what to turn on', async () => {
    const { s, deps } = boot();
    addMac(s, 'mini', { ownerChrome: true }, { kind: 'local' });
    browserMcp(s);
    const calls = connect(s, 'mini');
    const pending = navigate(deps, 'nothing');
    const outcome = pending.then(
      (result) => result.text,
      (error: Error) => error.message,
    );
    fail(s, 'mini', await next(calls, 1), NO_EXTENSION);
    const text = await outcome;
    expect(text).toContain('no Chrome is connected to Browser MCP');
    expect(text).toContain('Browser MCP');
    expect(text).toContain('没有可用的浏览器');
  });

  test('a saved password is never sent toward the owner’s Chrome', async () => {
    const { s, deps } = boot();
    addMac(
      s,
      'mini',
      { browser: true, ownerChrome: true, browserSecretFill: true },
      { kind: 'local' },
    );
    browserMcp(s);
    const calls = connect(s, 'mini');
    const outcome = forwardComputerCall(deps, 'sidecar', 'step-a', {
      computer: true,
      name: 'browser_act',
      toolCallId: 'secret',
      params: {
        actions: [
          { kind: 'fill_secret', ref: '@e1', secret: 'SITE', origin: 'https://example.com' },
        ],
      },
    }).catch((error: Error) => error.message);
    expect(await outcome).toBe('Save this workspace secret in Secrets settings first.');
    expect(calls).toEqual([]);
  });

  test('fill_secret on an owner-Chrome page refuses instead of switching to Cairn’s browser', async () => {
    const { s, deps } = boot();
    addMac(
      s,
      'mini',
      { browser: true, ownerChrome: true, browserSecretFill: true },
      { kind: 'local' },
    );
    browserMcp(s);
    const calls = connect(s, 'mini');
    const opened = navigate(deps, 'owner-page-for-secret');
    opened.catch(() => {});
    answer(s, 'mini', await next(calls, 1), 'their page');
    await opened;
    await expect(
      forwardComputerCall(deps, 'sidecar', 'step-a', {
        computer: true,
        name: 'browser_act',
        toolCallId: 'secret-after-owner-open',
        params: {
          actions: [
            { kind: 'fill_secret', ref: '@e1', secret: 'SITE', origin: 'https://example.com' },
          ],
        },
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("owner's own Chrome"),
    });
    expect(calls).toHaveLength(1);
  });

  test('reusing an in-flight owner-Chrome toolCallId with a different tool is refused', async () => {
    const { s, deps } = boot();
    addMac(s, 'mini', { browser: true, ownerChrome: true }, { kind: 'local' });
    browserMcp(s);
    const calls = connect(s, 'mini');
    const first = navigate(deps, 'shared-call-id');
    first.catch(() => {});
    const dispatched = await next(calls, 1);
    await expect(
      forwardComputerCall(deps, 'sidecar', 'step-a', {
        computer: true,
        name: 'browser_snapshot',
        toolCallId: 'shared-call-id',
        params: {},
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('browser_navigate'),
    });
    answer(s, 'mini', dispatched, 'their page');
    await first;
  });

  test('browser_act for an owner-Chrome page never moves to another browser', async () => {
    const { s, deps } = boot();
    addMac(s, 'mini', { browser: true, ownerChrome: true }, { kind: 'local' });
    addMac(s, 'air', { ownerChrome: true });
    browserMcp(s);
    const mini = connect(s, 'mini');
    const air = connect(s, 'air');
    const opened = navigate(deps, 'open');
    opened.catch(() => {});
    answer(s, 'mini', await next(mini, 1), 'their page');
    await opened;
    const acting = forwardComputerCall(deps, 'sidecar', 'step-a', {
      computer: true,
      name: 'browser_act',
      toolCallId: 'press',
      params: { actions: [{ kind: 'press', text: 'Enter' }] },
    });
    acting.catch(() => {});
    fail(s, 'mini', await next(mini, 2), NO_EXTENSION);
    expect((await acting).text).toContain('no Chrome is connected to Browser MCP');
    expect(mini).toHaveLength(2);
    expect(air).toEqual([]);
  });

  test('another person’s thread never reaches a remote Mac’s Chrome', async () => {
    const { s, deps } = boot();
    addMac(s, 'air', { ownerChrome: true });
    browserMcp(s);
    s.db.insert(userTable).values({ id: 'guest', displayName: 'Guest' }).run();
    s.db
      .update(chiefThreadTable)
      .set({ userId: 'guest' })
      .where(eq(chiefThreadTable.id, THREAD))
      .run();
    const air = connect(s, 'air');
    await expect(navigate(deps, 'guest')).rejects.toMatchObject({ status: 403 });
    expect(air).toEqual([]);
  });

  test.each([
    ['Cairn’s browser', false, "Cairn's own browser on Ian’s Mac mini, separate from"],
    ['the owner’s Chrome', true, "the owner's own Chrome on Ian’s Mac mini"],
  ])(
    'the answer to browser_navigate names %s and the machine, so the owner can be told',
    async (_name, connector, expected) => {
      const { s, deps } = boot();
      addMac(
        s,
        'mini',
        { browser: true, ownerChrome: true, computerName: 'Ian’s Mac mini' },
        { kind: 'local' },
      );
      if (connector) browserMcp(s);
      const calls = connect(s, 'mini');
      const pending = navigate(deps, 'where');
      pending.catch(() => {});
      answer(s, 'mini', await next(calls, 1), 'Example Domain');
      expect((await pending).text).toContain(expected);
    },
  );

  test.each([
    ['browser_navigate', { url: 'https://example.com' }],
    ['browser_snapshot', {}],
    ['browser_act', { actions: [{ kind: 'wait', ms: 1 }] }],
  ] as const)(
    'the answer to %s names the machine, browser and whether anyone can take over',
    async (tool, params) => {
      const { s, deps } = boot();
      addMac(s, 'mini', { browser: true, computerName: 'Ian’s Mac mini' });
      const calls = connect(s, 'mini');
      const pending = forwardComputerCall(deps, 'sidecar', 'step-a', {
        computer: true,
        name: tool,
        toolCallId: `tc-${tool}`,
        params,
      });
      pending.catch(() => {});
      answer(s, 'mini', await next(calls, 1), 'Example Domain');
      const text = (await pending).text;
      expect(text).toContain("Cairn's own browser on Ian’s Mac mini");
      expect(text).toContain('nobody can watch or take it over');
    },
  );

  test('a browser that supports a screen handoff says the owner can watch and take it over', async () => {
    const { s, deps } = boot();
    addMac(s, 'mini', {
      browser: true,
      screenHandoff: true,
      computerName: 'Ian’s Mac mini',
    });
    const calls = connect(s, 'mini');
    const pending = navigate(deps, 'visible-browser');
    pending.catch(() => {});
    answer(s, 'mini', await next(calls, 1), 'Example Domain');
    expect((await pending).text).toContain('the owner can watch and take it over in Cairn');
  });

  test('the owner Chrome answer says where it can be watched and that no handoff coordinates it', async () => {
    const { s, deps } = boot();
    addMac(
      s,
      'mini',
      { browser: true, ownerChrome: true, computerName: 'Ian’s Mac mini' },
      { kind: 'local' },
    );
    browserMcp(s);
    const calls = connect(s, 'mini');
    const pending = navigate(deps, 'owner-visible-browser');
    pending.catch(() => {});
    answer(s, 'mini', await next(calls, 1), 'Example Domain');
    const text = (await pending).text;
    expect(text).toContain('the owner can watch it in Chrome');
    expect(text).toContain('no coordinated takeover handoff');
  });

  test.each([
    ['Cairn’s browser', false, "Cairn's own browser on Ian’s Mac mini"],
    ['the owner’s Chrome', true, "the owner's own Chrome on Ian’s Mac mini"],
  ])(
    'a replayed %s answer still names the browser facts exactly once',
    async (_name, connector, expected) => {
      const { s, deps } = boot();
      addMac(
        s,
        'mini',
        { browser: true, ownerChrome: true, computerName: 'Ian’s Mac mini' },
        { kind: 'local' },
      );
      if (connector) browserMcp(s);
      const calls = connect(s, 'mini');
      const body = {
        computer: true as const,
        name: 'browser_navigate' as const,
        toolCallId: 'replayed-browser',
        params: { url: 'https://example.com' },
      };
      const first = forwardComputerCall(deps, 'sidecar', 'step-a', body);
      first.catch(() => {});
      answer(s, 'mini', await next(calls, 1), 'Example Domain');
      await first;
      const replayed = await forwardComputerCall(deps, 'sidecar', 'step-a', body);
      expect(replayed.text).toContain(expected);
      expect(replayed.text.match(/\[Browser:/g)).toHaveLength(1);
    },
  );

  test('a pin on a Mac that can no longer run a browser moves to one that can', async () => {
    const { s, deps, chiefId } = boot();
    addMac(s, 'old-mac', {}, { lastSeenAt: 9 });
    addMac(s, 'new-mac', { browser: true });
    pin(s, chiefId, 'old-mac');
    connect(s, 'old-mac');
    const calls = connect(s, 'new-mac');
    const pending = navigate(deps, 'moved');
    pending.catch(() => {});
    answer(s, 'new-mac', await next(calls, 1), 'moved');
    expect((await pending).text).toBe(inCairnBrowser('new-mac', 'moved'));
    expect(s.db.select().from(computerTable).get()).toMatchObject({
      id: 'pinned',
      machineId: 'new-mac',
      controlHolder: 'none',
      handoffReason: null,
    });
  });

  test.each([
    ['a new pin', false],
    ['a pin the removed VM left running', true],
  ])('%s on a machine that reports no computer is never shown as starting', async (_n, left) => {
    const { s, deps, chiefId } = boot();
    addMac(s, 'mac', { browser: true });
    if (left) pin(s, chiefId, 'mac');
    if (left) s.db.update(computerTable).set({ handoffReason: null, controlHolder: 'none' }).run();
    const calls = connect(s, 'mac');
    const pending = navigate(deps, 'resting');
    pending.catch(() => {});
    answer(s, 'mac', await next(calls, 1), 'Example Domain');
    await pending;
    expect(s.db.select().from(computerTable).get()?.state).toBe('stopped');
  });

  test('a pin on a sleeping Mac that can run a browser stays', async () => {
    const { s, deps, chiefId } = boot();
    addMac(s, 'asleep', { browser: true });
    addMac(s, 'awake', { browser: true });
    pin(s, chiefId, 'asleep');
    s.db.update(computerTable).set({ handoffReason: null, controlHolder: 'none' }).run();
    const awake = connect(s, 'awake');
    await expect(navigate(deps, 'asleep')).rejects.toThrow(COMPUTER_NOT_CONNECTED);
    expect(awake).toEqual([]);
    expect(s.db.select().from(computerTable).get()?.machineId).toBe('asleep');
  });

  test.each([
    ['without a screen to hand over', {}, null],
    ['with one', { screenHandoff: true }, 'login'],
  ])(
    'a captcha on a machine %s opens a handoff only when somebody can close it',
    async (_n, extra, reason) => {
      const { s, deps } = boot();
      addMac(s, 'host', { browser: true, ...extra });
      const calls = connect(s, 'host');
      const pending = navigate(deps, 'captcha');
      pending.catch(() => {});
      const call = await next(calls, 1);
      receiveComputerFrames(s.db, s.hub, 'host', call.callId, [
        {
          kind: 'done',
          seq: 1,
          text: 'verify you are human',
          exitCode: 0,
          loginForm: { signals: ['challenge'] },
        } as ComputerFrame,
      ]);
      await pending;
      expect(s.db.select().from(computerTable).get()?.handoffReason).toBe(reason);
    },
  );

  test('asking for takeover on a browser nobody can see answers at once', async () => {
    const { s, deps } = boot();
    addMac(s, 'mac', { browser: true });
    const calls = connect(s, 'mac');
    const pending = navigate(deps, 'before-takeover');
    pending.catch(() => {});
    answer(s, 'mac', await next(calls, 1), 'ok');
    await pending;
    const result = await forwardComputerCall(
      deps,
      'sidecar',
      'step-a',
      {
        computer: true,
        name: 'request_takeover',
        toolCallId: 'take',
        params: { reason: 'captcha' },
      },
      { takeover: { timeoutMs: 200, pollMs: 5 } },
    );
    expect(result.text).toContain('Nobody can watch or take over');
    expect(s.db.select().from(computerTable).get()?.handoffReason).toBeNull();
  });
});
