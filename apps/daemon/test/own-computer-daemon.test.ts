import { afterEach, describe, expect, test } from 'vitest';
import { createHostScreenFromEnv } from '../src/computer/host-screen.js';
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

describe('the bundled agent-desktop path', () => {
  test('CAIRN_AGENT_DESKTOP drives the screen and the permission probe alike', async () => {
    const fake = setup([{ command: 'status', stdout: status('granted') }, listWindows, snapshot]);
    const env = { CAIRN_AGENT_DESKTOP: fake.binary, HOME: '/nonexistent-home', PATH: '' };
    const probe = createHostPermissionsProbe(env);
    probe.current();
    await probe.settled();
    expect(probe.current()?.accessibility).toBe('granted');
    const screen = createHostScreenFromEnv(env, { stateDir: `${fake.dir}/state` });
    expect(screen).toBeDefined();
    await screen?.observe(call({ app: 'nautilus' }));
    expect(fake.commands()).toEqual(expect.arrayContaining(['status', 'list-windows']));
  });

  test('without CAIRN_AGENT_DESKTOP there is no screen and no permission report', async () => {
    const env = { CAIRN_OWN_COMPUTER: '1', HOME: '/h' };
    expect(createHostScreenFromEnv(env, { stateDir: '/h/state' })).toBeUndefined();
    const probe = createHostPermissionsProbe(env);
    probe.current();
    await probe.settled();
    expect(probe.current()).toBeUndefined();
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
