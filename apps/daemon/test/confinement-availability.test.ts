import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ConfinementReport } from '@cairn/shared';
import { expect, test, vi } from 'vitest';
import type { launchConfined } from '../src/backend/confine.js';
import { ConfinementAvailability } from '../src/backend/confinement-availability.js';
import { probeClaudeBin } from '../src/claude-code-bin.js';
import { boot } from './machine-loop-harness.js';
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
