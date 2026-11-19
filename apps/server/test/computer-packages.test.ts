import { createHash } from 'node:crypto';
import {
  type ComputerCall,
  type MachineStreamEvent,
  PACKAGES_DECLINED,
  PACKAGES_INSTALLED_PREFIX,
  PACKAGES_NO_VM_COMPUTER,
  PACKAGES_NOT_ANSWERED,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  computerCall as computerCallTable,
  computer as computerTable,
  machine as machineTable,
  pairedDevice,
  step as stepTable,
} from '../src/db/schema.js';
import { issueBrowserSession } from '../src/services/browser-session.js';
import { composeChiefSystemPrompt } from '../src/services/chief.js';
import { acquireComputerControl } from '../src/services/computer-control.js';
import { sweepComputerHandoffs } from '../src/services/computer-handoff.js';
import {
  dropComputerWaiters,
  forwardComputerCall,
  receiveComputerFrames,
} from '../src/services/machine-computer.js';
import type { MachineDeps } from '../src/services/machine-deps.js';
import { bootServer, seedRoute, type TestServer } from './helpers.js';

vi.setConfig({ testTimeout: 30_000 });

const THREAD = 'chief-packages-thread';
const COMPUTER = 'packages-computer';
const FAST = { takeover: { timeoutMs: 60_000, pollMs: 5 } };

let server: TestServer | null = null;
afterEach(() => {
  vi.restoreAllMocks();
  dropComputerWaiters();
  server?.dispose();
  server = null;
});

function boot(options: { authToken?: string | null; computerKind?: 'host' | 'vm' } = {}) {
  const s = bootServer({ authToken: options.authToken ?? null });
  server = s;
  const chiefId = `chief-${s.svc.user.id}-${s.team.id}`;
  for (const id of ['sidecar', 'mac']) {
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
          ...(id === 'mac'
            ? { computer: true, browser: true, computerKind: options.computerKind ?? 'vm' }
            : {}),
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
      title: 'packages',
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
      machineId: 'mac',
      providerRef: 'packages',
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
  const calls: ComputerCall[] = [];
  s.machineHub.subscribeMachine(s.team.id, 'mac', (ev: MachineStreamEvent) => {
    if (ev.type === 'computer') calls.push(ev.call);
  });
  const deps: MachineDeps = {
    ...s.svc,
    box: s.secretBox,
    reposDir: s.reposDir,
    attachmentsDir: s.attachmentsDir,
    skillsDir: s.skillsDir,
  };
  return { s, deps, calls, scopeKey: `chief:${chiefId}` };
}

function install(packages: unknown, toolCallId = 'install-1') {
  return {
    computer: true as const,
    name: 'install_packages' as const,
    toolCallId,
    params: { packages },
  };
}

function decide(
  s: TestServer,
  packages: string[],
  decision: 'approve' | 'decline',
  headers: Record<string, string> = {},
) {
  return s.app.request('/api/computers/package-install', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ packages, decision }),
  });
}

function installRows(s: TestServer) {
  return s.db
    .select()
    .from(computerCallTable)
    .where(eq(computerCallTable.tool, 'install_packages'))
    .all();
}

async function waitForRequest(s: TestServer) {
  await vi.waitFor(() =>
    expect(installRows(s).some((row) => row.params.approval === 'pending')).toBe(true),
  );
}

describe('install_packages asks the owner before anything runs', () => {
  test.each([
    ['a path', ['/tmp/evil.deb']],
    ['a URL', ['https://example.com/evil.deb']],
    ['an option', ['-oAPT::Get::AllowUnauthenticated=true']],
    ['an upper-case name', ['FFmpeg']],
    ['too many', Array.from({ length: 21 }, (_, index) => `pkg${index}`)],
    ['nothing', []],
  ])('%s is refused before a card or a call exists', async (_label, packages) => {
    const { s, deps, calls } = boot();
    const result = await forwardComputerCall(deps, 'sidecar', 'step-a', install(packages), FAST);
    expect(result.text).toContain('install_packages refused');
    expect(installRows(s)).toEqual([]);
    expect(calls).toEqual([]);
  });

  test('a team whose computer is not a VM gets a refusal and nothing runs', async () => {
    const { s, deps, calls } = boot({ computerKind: 'host' });
    const result = await forwardComputerCall(deps, 'sidecar', 'step-a', install(['ffmpeg']), FAST);
    expect(result.text).toBe(PACKAGES_NO_VM_COMPUTER);
    expect(installRows(s)).toEqual([]);
    expect(calls).toEqual([]);
  });

  test('approving sends exactly the named packages to the VM and returns the install summary', async () => {
    const { s, deps, calls, scopeKey } = boot();
    const pending = forwardComputerCall(deps, 'sidecar', 'step-a', install(['ffmpeg', 'jq']), FAST);
    await waitForRequest(s);
    expect(calls).toEqual([]);
    expect((await decide(s, ['jq'], 'approve')).status).toBe(409);
    expect((await decide(s, ['ffmpeg', 'jq'], 'approve')).status).toBe(200);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      tool: 'install_packages',
      params: { packages: ['ffmpeg', 'jq'] },
      scopeKey,
      computerGrant: 'desktop',
    });
    receiveComputerFrames(deps.db, deps.hub, 'mac', calls[0]!.callId, [
      { kind: 'output', seq: 1, stream: 'stdout', text: 'Setting up ffmpeg ...\n' },
      {
        kind: 'done',
        seq: 2,
        text: `${PACKAGES_INSTALLED_PREFIX} ffmpeg jq.\nSetting up ffmpeg ...`,
        exitCode: 0,
      },
    ]);
    const result = await pending;
    expect(result.text.startsWith(`${PACKAGES_INSTALLED_PREFIX} ffmpeg jq.`)).toBe(true);
    expect((await decide(s, ['ffmpeg', 'jq'], 'approve')).status).toBe(409);
  });

  test('declining runs nothing and tells the Coordinator', async () => {
    const { s, deps, calls } = boot();
    const pending = forwardComputerCall(deps, 'sidecar', 'step-a', install(['ffmpeg']), FAST);
    await waitForRequest(s);
    expect((await decide(s, ['ffmpeg'], 'decline')).status).toBe(200);
    expect((await pending).text).toBe(PACKAGES_DECLINED);
    expect(calls).toEqual([]);
    expect(installRows(s)[0]).toMatchObject({ state: 'done', resultText: PACKAGES_DECLINED });
  });

  test('a turn that ends before the owner answers installs nothing', async () => {
    const { s, deps, calls } = boot();
    const pending = forwardComputerCall(deps, 'sidecar', 'step-a', install(['ffmpeg']), FAST);
    await waitForRequest(s);
    s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.id, 'step-a')).run();
    expect((await pending).text).toBe(PACKAGES_NOT_ANSWERED);
    expect((await decide(s, ['ffmpeg'], 'approve')).status).toBe(409);
    expect(calls).toEqual([]);
  });

  test('the owner can still take over the screen while an install waits', async () => {
    const { s, deps } = boot();
    const pending = forwardComputerCall(deps, 'sidecar', 'step-a', install(['ffmpeg']), FAST);
    await waitForRequest(s);
    expect(() =>
      acquireComputerControl(s.db, s.machineHub, s.team.id, s.svc.user.id, COMPUTER),
    ).not.toThrow();
    await decide(s, ['ffmpeg'], 'decline');
    await pending;
  });

  test('a paired device cannot approve, the owner can', async () => {
    const ownerToken = 'synthetic-owner-token';
    const deviceToken = 'cairn_dev_synthetic-device-token';
    const { s, deps } = boot({ authToken: ownerToken });
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
    const pending = forwardComputerCall(deps, 'sidecar', 'step-a', install(['ffmpeg']), FAST);
    await waitForRequest(s);
    expect(
      (await decide(s, ['ffmpeg'], 'approve', { authorization: `Bearer ${deviceToken}` })).status,
    ).toBe(403);
    expect(
      (
        await decide(s, ['ffmpeg'], 'decline', {
          cookie: `cairn_auth=${issueBrowserSession(s.db, 'owner').token}`,
          'sec-fetch-site': 'same-origin',
        })
      ).status,
    ).toBe(200);
    expect((await pending).text).toBe(PACKAGES_DECLINED);
  });

  test('the Coordinator cannot start an owner computer action', async () => {
    const { deps, calls } = boot();
    await expect(
      forwardComputerCall(
        deps,
        'sidecar',
        'step-a',
        { computer: true, name: 'computer_manage', toolCallId: 'm-1', params: { action: 'reset' } },
        FAST,
      ),
    ).rejects.toThrow('Computers panel');
    expect(calls).toEqual([]);
  });
});

describe('owner computer actions', () => {
  function act(s: TestServer, action: unknown, headers: Record<string, string> = {}) {
    return s.app.request(`/api/computers/${COMPUTER}/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ action }),
    });
  }

  test.each([
    ['stop', 'stopped'],
    ['update', 'current'],
    ['recover', 'recovered'],
    ['reset', 'reset'],
  ] as const)('%s is forwarded to the VM and its outcome returned', async (action, outcome) => {
    const { s, deps, calls, scopeKey } = boot();
    const response = act(s, action);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ tool: 'computer_manage', params: { action }, scopeKey });
    receiveComputerFrames(deps.db, deps.hub, 'mac', calls[0]!.callId, [
      { kind: 'done', seq: 1, text: outcome },
    ]);
    const res = await response;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outcome });
  });

  test('a failed action comes back as a conflict with its reason', async () => {
    const { s, deps, calls } = boot();
    const response = act(s, 'reset');
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    receiveComputerFrames(deps.db, deps.hub, 'mac', calls[0]!.callId, [
      {
        kind: 'error',
        seq: 1,
        message: 'The computer home could not be deleted',
        delivery: 'unknown',
      },
    ]);
    const res = await response;
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'The computer home could not be deleted' });
  });

  test('an unknown action, a host computer and an unknown computer are refused', async () => {
    const { s, calls } = boot({ computerKind: 'host' });
    expect((await act(s, 'wipe')).status).toBe(400);
    expect((await act(s, 'stop')).status).toBe(409);
    const missing = await s.app.request('/api/computers/nope/actions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'stop' }),
    });
    expect(missing.status).toBe(404);
    expect(calls).toEqual([]);
  });

  test('a paired device cannot run an action', async () => {
    const ownerToken = 'synthetic-owner-token';
    const deviceToken = 'cairn_dev_synthetic-device-token';
    const { s, calls } = boot({ authToken: ownerToken });
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
    expect((await act(s, 'reset', { authorization: `Bearer ${deviceToken}` })).status).toBe(403);
    expect(calls).toEqual([]);
  });
});

describe('after a server restart', () => {
  test('an install or computer action left past its deadline is closed as an error', async () => {
    const { s } = boot();
    for (const [id, tool] of [
      ['a'.repeat(64), 'install_packages'],
      ['b'.repeat(64), 'computer_manage'],
    ] as const)
      s.db
        .insert(computerCallTable)
        .values({
          id,
          teamId: s.team.id,
          stepId: 'step-a',
          toolCallId: id,
          machineId: 'mac',
          computerId: COMPUTER,
          tool,
          replaySafe: false,
          params: {},
          state: 'running',
          deadlineAt: 10,
          createdAt: 1,
        })
        .run();
    sweepComputerHandoffs(s.db, 100);
    expect(
      s.db
        .select({ state: computerCallTable.state })
        .from(computerCallTable)
        .all()
        .map((row) => row.state),
    ).toEqual(['error', 'error']);
  });
});

describe('the Coordinator prompt', () => {
  test('names install_packages and the no-approval Python and Node installs only with a VM computer', () => {
    const vm = boot();
    const withVm = composeChiefSystemPrompt(vm.deps, vm.s.team.id, THREAD);
    expect(withVm).toContain('调 install_packages');
    expect(withVm).toContain('pip install --user');
    server?.dispose();
    const host = boot({ computerKind: 'host' });
    expect(composeChiefSystemPrompt(host.deps, host.s.team.id, THREAD)).not.toContain(
      'install_packages',
    );
  });
});
