import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ConfinementReport } from '@cairn/shared';
import { expect, test, vi } from 'vitest';
import {
  ConfinementExitedError,
  ConfinementOwnerError,
  type launchConfined,
} from '../src/backend/confine.js';
import {
  ConfinementAvailability,
  confinementCauseOf,
  fuseMountUnder,
} from '../src/backend/confinement-availability.js';
import { probeClaudeBin } from '../src/claude-code-bin.js';
import { MachineApiError } from '../src/machine-client.js';
import { boot, FakeMachineApi } from './machine-loop-harness.js';
import { testTempDir } from './test-temp-dir.js';

vi.mock('../src/claude-code-bin.js', () => ({ probeClaudeBin: vi.fn(async () => null) }));

const successfulLaunch = vi.fn<typeof launchConfined>(async (options) => {
  const child = spawn(process.execPath, [
    '-e',
    'process.stdin.resume(); process.stdin.on("end", () => process.exit(0));',
  ]);
  options.reserve?.({
    unit: 'cairn-confine-123.service',
    eventsPath: '/sys/fs/cgroup/user.slice/test/app.slice/cairn-confine-123.service/cgroup.events',
  });
  const completed = new Promise<void>((resolve) => {
    child.once('close', () => {
      options.released?.();
      resolve();
    });
  });
  return {
    unit: 'cairn-confine-123.service',
    process: child,
    completed,
    stop: async () => {},
  };
});

test('failed Linux preflight keeps presence online and skips probes, recovery and claims until explicit repair', async () => {
  vi.mocked(probeClaudeBin).mockClear();
  const auth = vi.fn(async () => ({ state: 'unknown' as const, reason: 'test' }));
  const launch = vi
    .fn<typeof launchConfined>()
    .mockRejectedValueOnce(new Error('startup'))
    .mockImplementation(successfulLaunch);
  const { api, handle } = await boot({
    confinementPlatform: 'linux',
    confinementPreflight: launch,
    claudeCodeAuthProbe: auth,
  });
  expect(api.presenceBodies.at(-1)).toMatchObject({
    capabilities: {
      osPlatform: 'linux',
      confinement: { state: 'unavailable', reason: 'startup-failed' },
    },
  });
  expect(auth).not.toHaveBeenCalled();
  expect(probeClaudeBin).not.toHaveBeenCalled();
  expect(api.calls).not.toContain('recover');
  expect(api.claimCalls).toBe(0);
  const generation = (await api.me()).capabilities?.confinement?.generation;
  expect(generation).toBeDefined();
  await handle.recheckConfinement();
  expect(auth).toHaveBeenCalledOnce();
  expect(probeClaudeBin).toHaveBeenCalledOnce();
  expect(api.calls).toContain('recover');
  expect(api.claimCalls).toBe(1);
  expect(api.claimBodies[0]).toMatchObject({
    confinement: { state: 'ready', generation: (generation ?? 0) + 1 },
  });
  await handle.stop();
});

test('cleanup reservation survives a restart and failed reconciliation prevents another launch', async () => {
  const home = testTempDir('availability-');
  let persisted: ConfinementReport | undefined;
  const launch = vi.fn<typeof launchConfined>(async (options) => {
    options.reserve?.({
      unit: 'cairn-confine-123.service',
      eventsPath:
        '/sys/fs/cgroup/user.slice/test/app.slice/cairn-confine-123.service/cgroup.events',
    });
    throw new Error('uncertain stop');
  });
  const reconcile = vi
    .fn()
    .mockRejectedValueOnce(new Error('events unreadable'))
    .mockResolvedValue(undefined);
  const create = () => {
    const availability = new ConfinementAvailability({
      home,
      platform: 'linux',
      owner: 'test.service',
      launch,
      reconcile,
      me: async () => ({ capabilities: { mcpServers: [], skills: [], confinement: persisted } }),
      send: async () => {
        persisted = availability.observation();
      },
    });
    return availability;
  };
  await create().recheck();
  expect(persisted).toMatchObject({ state: 'unavailable', reason: 'cleanup-failed' });
  expect(existsSync(join(home, 'confinement/reservation.json'))).toBe(true);
  const restarted = create();
  await restarted.recheck();
  expect(launch).toHaveBeenCalledOnce();
  expect(restarted.ready).toBe(false);
  launch.mockImplementation(successfulLaunch);
  await restarted.recheck();
  expect(reconcile).toHaveBeenCalledTimes(2);
  expect(restarted.ready).toBe(true);
  expect(existsSync(join(home, 'confinement/reservation.json'))).toBe(false);
});

test('macOS reports not-applicable without a Linux launch and keeps claiming', async () => {
  const launch = vi.fn<typeof launchConfined>();
  const { api, handle } = await boot({
    confinementPlatform: 'darwin',
    confinementPreflight: launch,
  });
  expect(launch).not.toHaveBeenCalled();
  expect(api.presenceBodies.at(-1)).toMatchObject({
    capabilities: { osPlatform: 'darwin', confinement: { state: 'not-applicable' } },
  });
  expect(api.claimCalls).toBe(1);
  await handle.stop();
});

const T3_MOUNT =
  '412 35 0:61 / /home/ian/.cache/lane-tmp/.mount_T3\\040Cod ro,nosuid,nodev,relatime shared:220 - fuse.T3-Code.AppImage T3-Code.AppImage ro,user_id=1000,group_id=1000';
const OTHER_HOME_MOUNT =
  '413 35 0:62 / /home/ian2/.mount_x ro,relatime shared:221 - fuse.x x ro,user_id=1000';
const OVERLAY_STDERR =
  "bwrap: Can't make overlay mount on (null) with options upperdir=/tmp-overlay-upper-0,workdir=/tmp-overlay-work-0,lowerdir=/proc/self/fd/8,userxattr: Invalid argument\n";
const inspect = (mountinfo: string, home = '/home/ian') => ({
  mountinfo: () => mountinfo,
  home: () => home,
});

test('the cause comes from the failure itself, and a FUSE mount alone names nothing', () => {
  expect(
    confinementCauseOf(
      new ConfinementExitedError('Failed to find executable bwrap: No such file or directory\n'),
      inspect(T3_MOUNT),
    ),
  ).toEqual({ kind: 'bwrap-missing' });
  expect(confinementCauseOf(new ConfinementExitedError(OVERLAY_STDERR), inspect(T3_MOUNT))).toEqual(
    { kind: 'home-overlay-failed', mountPoint: '/home/ian/.cache/lane-tmp/.mount_T3 Cod' },
  );
  expect(
    confinementCauseOf(new ConfinementExitedError(OVERLAY_STDERR), inspect(OTHER_HOME_MOUNT)),
  ).toEqual({ kind: 'home-overlay-failed' });
  expect(
    confinementCauseOf(new ConfinementExitedError(OVERLAY_STDERR), {
      mountinfo: () => {
        throw new Error('EACCES');
      },
      home: () => '/home/ian',
    }),
  ).toEqual({ kind: 'home-overlay-failed' });
  for (const [stderr, kind] of [
    ['bwrap: Unknown option --overlay-src\n', 'bwrap-too-old'],
    ['bwrap: Unknown option --tmp-overlay\n', 'bwrap-too-old'],
    ['bwrap: setting up uid map: Permission denied\n', 'userns-denied'],
    [
      'bwrap: No permissions to creating new namespace, likely because the kernel does not allow non-privileged user namespaces.\n',
      'userns-denied',
    ],
    [
      "bwrap: No permissions to create a new namespace, likely because the kernel does not allow non-privileged user namespaces. On e.g. debian this can be enabled with 'sysctl kernel.unprivileged_userns_clone=1'.\n",
      'userns-denied',
    ],
  ] as const)
    expect(confinementCauseOf(new ConfinementExitedError(stderr), inspect(T3_MOUNT))).toEqual({
      kind,
    });
  expect(
    confinementCauseOf(
      new ConfinementExitedError('bwrap: Creating new namespace failed: Invalid argument\n'),
      inspect(T3_MOUNT),
    ),
  ).toBeUndefined();
  expect(
    confinementCauseOf(
      new ConfinementExitedError('bwrap: Unknown option --share-net\n'),
      inspect(T3_MOUNT),
    ),
  ).toBeUndefined();
  expect(confinementCauseOf(new Error('startup'), inspect(T3_MOUNT))).toBeUndefined();
  expect(
    confinementCauseOf(new ConfinementOwnerError('Invalid confinement owner'), inspect('')),
  ).toEqual({
    kind: 'not-own-unit',
  });
});

test('a home on another path is matched by its real path', () => {
  const mount = '414 35 0:63 / /var/home/ian/.mount_y ro shared:9 - fuse.y y ro';
  expect(fuseMountUnder(mount, '/var/home/ian')).toBe('/var/home/ian/.mount_y');
  expect(fuseMountUnder(mount, '/home/ian')).toBeUndefined();
});

test('only a daemon that can never be its own unit stops rechecking', async () => {
  const notOwn = (owner: string, invocationId: string) => {
    const availability = new ConfinementAvailability({
      home: testTempDir('availability-'),
      platform: 'linux',
      owner,
      invocationId,
      launch: vi.fn<typeof launchConfined>().mockRejectedValue(new ConfinementOwnerError('x')),
      me: async () => ({ capabilities: { mcpServers: [], skills: [], confinement: persisted } }),
      send: async () => {
        persisted = availability.observation();
      },
    });
    let persisted: ConfinementReport | undefined;
    return availability;
  };
  const detached = notOwn('session-2.scope', '');
  await detached.recheck();
  expect(detached.cause).toEqual({ kind: 'not-own-unit' });
  expect(detached.recoverable).toBe(false);
  const unit = notOwn('cairn-daemon-1.service', 'abc');
  await unit.recheck();
  expect(unit.recoverable).toBe(true);
});

test.each([
  ['Failed to find executable bwrap: No such file or directory\n', 'bwrap-missing'],
  ['bwrap: Unknown option --overlay-src\n', 'bwrap-too-old'],
  ['bwrap: setting up uid map: Permission denied\n', 'userns-denied'],
])(
  'a Runner whose sandbox fails with %j reports %s, rechecks on its own and starts claiming once fixed',
  async (stderr, kind) => {
    const launch = vi
      .fn<typeof launchConfined>()
      .mockRejectedValueOnce(new ConfinementExitedError(stderr))
      .mockImplementation(successfulLaunch);
    const { api, handle } = await boot({
      confinementPlatform: 'linux',
      confinementPreflight: launch,
      confinementRecheckMs: 20,
    });
    expect(api.presenceBodies.at(-1)).toMatchObject({
      capabilities: {
        confinement: { state: 'unavailable', reason: 'startup-failed' },
        confinementCause: { kind },
      },
    });
    expect(api.claimCalls).toBe(0);
    await vi.waitFor(() => expect(api.claimCalls).toBeGreaterThan(0), { timeout: 5000 });
    expect(launch).toHaveBeenCalledTimes(2);
    expect(
      (api.presenceBodies.at(-1) as { capabilities?: object } | undefined)?.capabilities,
    ).not.toHaveProperty('confinementCause');
    await handle.stop();
  },
);

test('a ready Runner invalidated by a stale-report 409 is rechecked by the timer', async () => {
  const api = new FakeMachineApi();
  const presence = api.presence.bind(api);
  let rejectNext = false;
  api.presence = async (...args) => {
    if (rejectNext) {
      rejectNext = false;
      throw new MachineApiError(409, 'Stale confinement report');
    }
    return presence(...args);
  };
  const launch = vi.fn<typeof launchConfined>().mockImplementation(successfulLaunch);
  const { handle } = await boot({
    api,
    confinementPlatform: 'linux',
    confinementPreflight: launch,
    confinementRecheckMs: 20,
    presenceIntervalMs: 20,
  });
  await vi.waitFor(() => expect(api.claimCalls).toBeGreaterThan(0), { timeout: 5000 });
  expect(launch).toHaveBeenCalledOnce();
  rejectNext = true;
  await vi.waitFor(() => expect(launch).toHaveBeenCalledTimes(2), { timeout: 5000 });
  await handle.stop();
});
