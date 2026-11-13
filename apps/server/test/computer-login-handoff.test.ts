import type { ComputerCall, ComputerFrame, MachineStreamEvent } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test, vi } from 'vitest';
import webpush from 'web-push';
import {
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  computerCall as computerCallTable,
  computer as computerTable,
  machine as machineTable,
  pushSubscription,
  step as stepTable,
} from '../src/db/schema.js';
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
import { bootServer, seedRoute, type TestServer } from './helpers.js';

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

function boot() {
  const s = bootServer();
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
          ...(id === 'omarchy' ? { computer: true, browser: true } : {}),
        },
      })
      .run();
  }
  seedRoute(s, 'coordinator', { provider: 'stub-gw', modelId: 'stub-model', machineId: 'sidecar' });
  s.db
    .insert(chiefTable)
    .values({ id: chiefId, userId: s.svc.user.id, teamId: s.team.id, charter: '', createdAt: 1 })
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
      browserEnabled: true,
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
  test('a done frame with loginForm on a browser call sets the handoff', async () => {
    const { s, deps, calls } = boot();
    const pending = forwardComputerCall(
      deps,
      'sidecar',
      'step-a',
      browser('browser_snapshot', 'a'),
    );
    receiveComputerFrames(s.db, s.hub, 'omarchy', calls[0]!.callId, [
      done(1, { signals: ['password'] }),
    ]);
    await pending;
    expect(computerRow(s)).toMatchObject({
      handoffReason: 'login',
      handoffStepId: 'step-a',
      handoffRequestedAt: expect.any(Number),
    });
  });

  test('a done frame without loginForm, or from a shell call, sets nothing', async () => {
    const { s, deps, calls } = boot();
    const snapshot = forwardComputerCall(
      deps,
      'sidecar',
      'step-a',
      browser('browser_snapshot', 'a'),
    );
    receiveComputerFrames(s.db, s.hub, 'omarchy', calls[0]!.callId, [done(1)]);
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

  test('sends exactly one push that opens the live screen', async () => {
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
    expect(payload.title).toBe('Login needed');
    expect(payload.body).toContain('log in to the job board');
    expect(payload.navigate).toContain('/app?pane=machines&machine=omarchy&screen=1');
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
