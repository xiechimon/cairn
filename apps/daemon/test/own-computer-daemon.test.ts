import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, utimesSync } from 'node:fs';
import type { ComputerCall, ComputerFrame } from '@cairn/shared';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createComputerDispatcher } from '../src/computer/dispatch.js';
import {
  AgentDesktopVerifier,
  agentDesktopBinary,
  createHostScreenFromEnv,
  type HostScreen,
  type ScreenOutcome,
} from '../src/computer/host-screen.js';
import {
  createHostPermissionsProbe,
  HOST_PERMISSIONS_DENIED_REFRESH_MS,
  HOST_PERMISSIONS_REFRESH_MS,
  HostPermissionsProbe,
} from '../src/host-permissions.js';
import { call, type FakeRule, type FakeScreen, fakeScreen } from './host-screen-fake.js';

const created: FakeScreen[] = [];
afterEach(() => {
  for (const fake of created.splice(0)) fake.cleanup();
});

function setup(rules: FakeRule[], options: Parameters<typeof fakeScreen>[1] = {}) {
  const fake = fakeScreen(rules, options);
  created.push(fake);
  return fake;
}

const status = (accessibility: string, screenRecording = 'granted') =>
  JSON.stringify({
    ok: true,
    data: {
      permissions: {
        accessibility: { state: accessibility },
        automation: { state: 'unknown' },
        screen_recording: { state: screenRecording },
      },
    },
  });

const listWindows: FakeRule = { command: 'list-windows', fixture: 'list-windows-wayland-gtk4' };
const snapshot: FakeRule = { command: 'snapshot', fixture: 'snapshot-wayland-gtk4' };

describe('one agent-desktop path', () => {
  test('CAIRN_AGENT_DESKTOP wins over HOME for the driver and the probe alike', async () => {
    const fake = setup([{ command: 'status', stdout: status('granted') }, listWindows, snapshot]);
    const env = { CAIRN_AGENT_DESKTOP: fake.binary, HOME: '/nonexistent-home', PATH: '' };
    expect(agentDesktopBinary(env)).toBe(fake.binary);
    const probe = createHostPermissionsProbe(env);
    probe.current();
    await probe.settled();
    expect(probe.current()?.accessibility).toBe('granted');
    const screen = createHostScreenFromEnv(env, { isOwnProcess: async () => false });
    expect(screen).toBeDefined();
    await screen?.observe(call({ app: 'nautilus' }));
    expect(fake.commands()).toEqual(expect.arrayContaining(['status', 'list-windows']));
  });

  test('without CAIRN_AGENT_DESKTOP no host screen is built', () => {
    expect(createHostScreenFromEnv({ CAIRN_OWN_COMPUTER: '1', HOME: '/h' })).toBeUndefined();
  });
});

describe('agent-desktop verification', () => {
  const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

  test('the pinned digest and version 1.1.0 verify; a tampered binary or another version does not', async () => {
    const fake = setup([]);
    const versions: string[] = ['1.1.0'];
    const verifier = new AgentDesktopVerifier({
      binary: fake.binary,
      expectedSha256: sha(fake.binary),
      runVersion: async () => versions[0] ?? null,
    });
    verifier.current();
    await verifier.settled();
    expect(verifier.current()).toBe(true);
    appendFileSync(fake.binary, '\n// tampered\n');
    const later = new Date(Date.now() + 5_000);
    utimesSync(fake.binary, later, later);
    verifier.current();
    await verifier.settled();
    expect(verifier.current()).toBe(false);

    const other = new AgentDesktopVerifier({
      binary: fake.binary,
      expectedSha256: sha(fake.binary),
      runVersion: async () => '1.0.9',
    });
    other.current();
    await other.settled();
    expect(other.current()).toBe(false);
  });

  test('a missing binary does not verify', async () => {
    const verifier = new AgentDesktopVerifier({
      binary: '/nonexistent/agent-desktop',
      expectedSha256: 'a'.repeat(64),
      runVersion: async () => '1.1.0',
    });
    verifier.current();
    await verifier.settled();
    expect(verifier.current()).toBe(false);
  });
});

describe('permission probe schedule', () => {
  test('rechecks every 30 s while a grant is missing and every 10 min once both are granted', async () => {
    let clock = 0;
    let runs = 0;
    let stdout = status('denied');
    const probe = new HostPermissionsProbe(
      async () => {
        runs++;
        return stdout;
      },
      () => clock,
    );
    probe.current();
    await probe.settled();
    clock = HOST_PERMISSIONS_DENIED_REFRESH_MS;
    probe.current();
    await probe.settled();
    expect(runs).toBe(2);
    stdout = status('granted');
    clock += HOST_PERMISSIONS_DENIED_REFRESH_MS;
    probe.current();
    await probe.settled();
    expect(runs).toBe(3);
    clock += HOST_PERMISSIONS_DENIED_REFRESH_MS;
    probe.current();
    expect(runs).toBe(3);
    clock += HOST_PERMISSIONS_REFRESH_MS;
    probe.current();
    await probe.settled();
    expect(runs).toBe(4);
  });

  test('Screen Recording missing also keeps the short schedule', async () => {
    let clock = 0;
    let runs = 0;
    const probe = new HostPermissionsProbe(
      async () => {
        runs++;
        return status('granted', 'denied');
      },
      () => clock,
    );
    probe.current();
    await probe.settled();
    clock = HOST_PERMISSIONS_DENIED_REFRESH_MS;
    probe.current();
    await probe.settled();
    expect(runs).toBe(2);
  });

  test('a PERM_DENIED from agent-desktop refreshes at once and names Accessibility', async () => {
    let runs = 0;
    const probe = new HostPermissionsProbe(
      async () => {
        runs++;
        return status('granted');
      },
      () => 0,
    );
    probe.current();
    await probe.settled();
    const fake = setup(
      [
        {
          command: 'list-windows',
          stdout: JSON.stringify({
            ok: false,
            error: { code: 'PERM_DENIED', message: 'Accessibility permission not granted' },
          }),
        },
      ],
      { onPermissionDenied: () => probe.refreshNow() },
    );
    const outcome = await fake.screen.observe(call({ app: 'Finder' }));
    expect(outcome).toMatchObject({ kind: 'error', delivery: 'not_delivered' });
    expect(outcome.kind === 'error' ? outcome.message : '').toContain('Accessibility');
    await probe.settled();
    expect(runs).toBe(2);
  });
});

describe('self protection', () => {
  test("a window owned by the daemon's parent is refused", async () => {
    const fake = setup(
      [
        {
          command: 'list-windows',
          fixture: 'list-windows-wayland-gtk4',
          override: (value) => {
            const listed = value as { data: Record<string, unknown>[] };
            return {
              ...listed,
              data: listed.data.map((window) => ({ ...window, pid: process.ppid })),
            };
          },
        },
        snapshot,
      ],
      { isOwnProcess: undefined },
    );
    const outcome = await fake.screen.observe(call({ app: 'nautilus' }));
    expect(outcome).toMatchObject({ kind: 'error', delivery: 'not_delivered' });
    expect(fake.commands()).toEqual(['list-windows']);
  });
});

const finished: ScreenOutcome = { kind: 'done', text: 'observed', images: [] };

function dispatcherWith(screen: HostScreen) {
  const frames: ComputerFrame[] = [];
  const dispatcher = createComputerDispatcher({
    cairnOrigins: [],
    client: {
      computerFrames: async (_id, body) => {
        frames.push(...body.frames);
        return { ok: true, cancelled: false };
      },
    },
    screen,
    heartbeatMs: 10,
  });
  return { dispatcher, frames };
}

const ownCall = (
  tool: 'user_computer_observe' | 'user_computer_act',
  params: Record<string, unknown>,
  grant?: { proposalId: string; key: string },
  id = 'b',
): ComputerCall => ({
  callId: id.repeat(64),
  stepId: 'own-step',
  tool,
  params,
  deadlineAt: Date.now() + 60_000,
  ...(grant === undefined ? {} : { ownComputerGrant: grant }),
});

describe('owner grant stamp', () => {
  test.each([
    ['an unstamped call', undefined],
    ['a call stamped for another app', { proposalId: 'p-1', key: 'notes' }],
  ])('%s never starts agent-desktop', async (_label, grant) => {
    const screen: HostScreen = {
      observe: vi.fn(async () => finished),
      act: vi.fn(async () => finished),
      killAll: vi.fn(async () => {}),
    };
    const { dispatcher, frames } = dispatcherWith(screen);
    await dispatcher.dispatch(ownCall('user_computer_observe', { app: 'Finder' }, grant));
    expect(screen.observe).not.toHaveBeenCalled();
    expect(frames.at(-1)).toMatchObject({ kind: 'error', delivery: 'not_delivered' });
    await dispatcher.close();
  });

  test('a call stamped for its own app runs', async () => {
    const screen: HostScreen = {
      observe: vi.fn(async () => finished),
      act: vi.fn(async () => finished),
      killAll: vi.fn(async () => {}),
    };
    const { dispatcher } = dispatcherWith(screen);
    await dispatcher.dispatch(
      ownCall('user_computer_observe', { app: ' Finder ' }, { proposalId: 'p-1', key: 'finder' }),
    );
    expect(screen.observe).toHaveBeenCalledOnce();
    await dispatcher.close();
  });
});

describe('cancel frame', () => {
  test('agent-desktop is killed mid-batch when the server cancels the call', async () => {
    const fake = setup([listWindows, { command: 'press', delayMs: 30_000, stdout: '{"ok":true}' }]);
    const { dispatcher, frames } = dispatcherWith(fake.screen);
    const act = ownCall(
      'user_computer_act',
      { app: 'nautilus', actions: [{ kind: 'key', key: 'a' }] },
      { proposalId: 'p-1', key: 'nautilus' },
      'c',
    );
    const started = Date.now();
    const pending = dispatcher.dispatch(act);
    for (let i = 0; i < 200 && !fake.commands().includes('press'); i += 1)
      await new Promise((resolve) => setTimeout(resolve, 25));
    expect(fake.commands()).toContain('press');
    dispatcher.cancel(act.callId);
    await pending;
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(frames.at(-1)).toMatchObject({ kind: 'error' });
    expect(frames.at(-1)?.kind === 'error' ? frames.at(-1) : null).toMatchObject({
      message: expect.stringContaining('cancelled'),
    });
    await dispatcher.close();
  });
});
