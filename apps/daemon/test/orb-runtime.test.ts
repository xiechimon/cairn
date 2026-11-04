import { describe, expect, test } from 'vitest';
import { HostOrbProvider, NspawnOrbProvider } from '../src/orb/provider.js';
import type { OrbRuntime, OrbSpawnSpec } from '../src/orb/runtime.js';
import { createOrbProvider, ORB_RUNTIME_ENV, resolveOrbRuntime } from '../src/orb/select.js';
import { boot, FakeMachineApi, waitFor } from './machine-loop-harness.js';

describe('resolveOrbRuntime', () => {
  test.each([
    ['unset', {}],
    ['empty', { CAIRN_ORB_RUNTIME: '' }],
  ])('%s selects nspawn', (_name, env) => {
    expect(resolveOrbRuntime(env)).toBe('nspawn');
  });

  test.each(['nspawn', 'podman', 'docker', 'apple'] as const)('parses %s', (name) => {
    expect(resolveOrbRuntime({ CAIRN_ORB_RUNTIME: name })).toBe(name);
  });

  test.each(['Podman', 'PODMAN', ' podman', 'podman ', 'podman\n', ' '])(
    'rejects non-canonical value %j instead of normalizing it',
    (value) => {
      expect(() => resolveOrbRuntime({ CAIRN_ORB_RUNTIME: value })).toThrow(
        `${ORB_RUNTIME_ENV} must be one of nspawn, podman, docker, apple`,
      );
    },
  );

  test('an unknown value names the variable, the value and the allowed values', () => {
    expect(() => resolveOrbRuntime({ CAIRN_ORB_RUNTIME: 'lxc' })).toThrow(
      'CAIRN_ORB_RUNTIME must be one of nspawn, podman, docker, apple (got "lxc")',
    );
  });
});

describe('createOrbProvider', () => {
  const stateFile = '/nonexistent/orb-state/orbs.json';

  test('executor orb with no runtime selects nspawn', () => {
    expect(createOrbProvider({ CAIRN_EXECUTOR: 'orb' }, stateFile)).toBeInstanceOf(
      NspawnOrbProvider,
    );
  });

  test('executor orb with an explicit nspawn selects nspawn', () => {
    expect(
      createOrbProvider({ CAIRN_EXECUTOR: 'orb', CAIRN_ORB_RUNTIME: 'nspawn' }, stateFile),
    ).toBeInstanceOf(NspawnOrbProvider);
  });

  test.each(['podman', 'docker', 'apple'])(
    'executor orb with %s fails instead of falling back to nspawn',
    (runtime) => {
      expect(() =>
        createOrbProvider({ CAIRN_EXECUTOR: 'orb', CAIRN_ORB_RUNTIME: runtime }, stateFile),
      ).toThrow(`CAIRN_ORB_RUNTIME=${runtime} is not implemented yet; only nspawn is available`);
    },
  );

  test('executor orb with an unknown runtime fails', () => {
    expect(() =>
      createOrbProvider({ CAIRN_EXECUTOR: 'orb', CAIRN_ORB_RUNTIME: 'lxc' }, stateFile),
    ).toThrow('CAIRN_ORB_RUNTIME must be one of');
  });

  test.each([{}, { CAIRN_EXECUTOR: 'host' }])(
    'without the orb executor a garbage runtime is ignored (%j)',
    (env) => {
      expect(createOrbProvider({ ...env, CAIRN_ORB_RUNTIME: 'garbage' }, stateFile)).toBeInstanceOf(
        HostOrbProvider,
      );
    },
  );
});

describe('daemon startup', () => {
  test('executor orb with podman rejects startup before enrolling', async () => {
    const api = new FakeMachineApi();
    await expect(
      boot({ api, capEnv: { CAIRN_EXECUTOR: 'orb', CAIRN_ORB_RUNTIME: 'podman' } }),
    ).rejects.toThrow('CAIRN_ORB_RUNTIME=podman is not implemented yet');
    expect(api.calls).toEqual([]);
  });

  test('executor orb with an unknown runtime rejects startup', async () => {
    await expect(
      boot({ capEnv: { CAIRN_EXECUTOR: 'orb', CAIRN_ORB_RUNTIME: 'lxc' } }),
    ).rejects.toThrow('CAIRN_ORB_RUNTIME must be one of');
  });

  test('a host daemon ignores a garbage runtime and reports the host executor', async () => {
    const { handle, api } = await boot({
      capEnv: { CAIRN_ORB_RUNTIME: 'garbage' },
      capabilitiesProbe: () => ({ mcpServers: [], skills: [] }),
    });
    await waitFor(() => api.presenceBodies.length > 0);
    expect(
      (api.presenceBodies[0] as { capabilities?: { executor?: string } }).capabilities?.executor,
    ).toBe('host');
    await handle.stop();
    await handle.done;
  });
});

describe('OrbSpawnSpec', () => {
  test('carries an extra rw mount next to the read-only ones', async () => {
    const spec: OrbSpawnSpec = {
      orbId: 'cairn-orb-computer-a',
      image: 'cairn-orb-base:abc',
      mounts: [
        { source: '/run/cairn-orb/a', target: '/run/cairn', readonly: false },
        { source: '/orb/dist', target: '/opt/cairn/daemon', readonly: true },
        { source: '/run/cairn-orb/a/computer', target: '/run/cairn-computer', readonly: false },
      ],
      env: {},
      limits: { cpus: 4, memoryBytes: 4 * 1024 ** 3, pids: 4096 },
      egress: { socketPath: '/run/cairn-orb/egress.sock' },
      persistentHome: { volume: 'cairn-computer-a', target: '/home/user' },
    };
    const spawn: OrbRuntime['spawn'] = async () => {};
    await expect(spawn(spec)).resolves.toBeUndefined();
    expect(spec.mounts.filter((mount) => !mount.readonly)).toHaveLength(2);
  });
});
