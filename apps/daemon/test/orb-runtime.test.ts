import { describe, expect, test } from 'vitest';
import { ContainerOrbProvider } from '../src/orb/container-provider.js';
import { HostOrbProvider, NspawnOrbProvider } from '../src/orb/provider.js';
import type { OrbRuntime, OrbSpawnSpec } from '../src/orb/runtime.js';
import {
  COMPUTER_ENV,
  createComputerOrbProvider,
  createOrbProvider,
  ORB_RUNTIME_ENV,
  podmanProviderOptions,
  resolveOrbRuntime,
} from '../src/orb/select.js';
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
        `${ORB_RUNTIME_ENV} must be one of nspawn, podman, docker, apple, e2b`,
      );
    },
  );

  test('an unknown value names the variable, the value and the allowed values', () => {
    expect(() => resolveOrbRuntime({ CAIRN_ORB_RUNTIME: 'lxc' })).toThrow(
      'CAIRN_ORB_RUNTIME must be one of nspawn, podman, docker, apple, e2b (got "lxc")',
    );
  });
});

describe('createOrbProvider', () => {
  const home = '/nonexistent/cairn-home';
  const podmanEnv = {
    CAIRN_EXECUTOR: 'orb',
    CAIRN_ORB_RUNTIME: 'podman',
    CAIRN_ORB_IMAGE: 'cairn-orb-base:0123456789ab',
    XDG_RUNTIME_DIR: '/nonexistent/run',
  };

  test('executor orb with no runtime selects nspawn', () => {
    expect(createOrbProvider({ CAIRN_EXECUTOR: 'orb' }, home)).toBeInstanceOf(NspawnOrbProvider);
  });

  test('executor orb with an explicit nspawn selects nspawn', () => {
    expect(
      createOrbProvider({ CAIRN_EXECUTOR: 'orb', CAIRN_ORB_RUNTIME: 'nspawn' }, home),
    ).toBeInstanceOf(NspawnOrbProvider);
  });

  test('executor orb with podman selects the container provider', () => {
    expect(createOrbProvider(podmanEnv, home)).toBeInstanceOf(ContainerOrbProvider);
  });

  test('two daemon homes never share the transport runtime directory', () => {
    const first = createOrbProvider(podmanEnv, `${home}/first`) as ContainerOrbProvider;
    const second = createOrbProvider(podmanEnv, `${home}/second`) as ContainerOrbProvider;
    expect(first.runtimeRoot).not.toBe(second.runtimeRoot);
  });

  test.each([
    [
      'without an image',
      { CAIRN_ORB_IMAGE: undefined },
      'CAIRN_ORB_IMAGE must name the built image',
    ],
    [
      'with an unpinned image',
      { CAIRN_ORB_IMAGE: 'cairn-orb-base:latest' },
      'pinned cairn-orb-base',
    ],
    ['with a foreign image', { CAIRN_ORB_IMAGE: 'alpine:3' }, 'pinned cairn-orb-base'],
    ['without a runtime directory', { XDG_RUNTIME_DIR: undefined }, 'XDG_RUNTIME_DIR must be set'],
  ])('executor orb with podman %s fails instead of falling back', (_name, override, message) => {
    expect(() => createOrbProvider({ ...podmanEnv, ...override }, home)).toThrow(message);
  });

  test('the relay socket named by CAIRN_ORB_EGRESS_SOCKET reaches the provider options', () => {
    expect(
      podmanProviderOptions(
        { ...podmanEnv, CAIRN_ORB_EGRESS_SOCKET: '/run/user/1000/cairn-orb-egress/egress.sock' },
        home,
      ).egressSocketPath,
    ).toBe('/run/user/1000/cairn-orb-egress/egress.sock');
  });

  test.each([undefined, ''])(
    'without a relay socket (%j) the Orb gets no network at all',
    (value) => {
      expect(
        podmanProviderOptions({ ...podmanEnv, CAIRN_ORB_EGRESS_SOCKET: value }, home)
          .egressSocketPath,
      ).toBeUndefined();
    },
  );

  test('a relative relay socket path is refused before any Orb starts', () => {
    expect(() =>
      podmanProviderOptions({ ...podmanEnv, CAIRN_ORB_EGRESS_SOCKET: 'egress.sock' }, home),
    ).toThrow('CAIRN_ORB_EGRESS_SOCKET must be an absolute path');
  });

  test.each(['docker', 'apple'])(
    'executor orb with %s fails instead of falling back to nspawn',
    (runtime) => {
      expect(() =>
        createOrbProvider({ CAIRN_EXECUTOR: 'orb', CAIRN_ORB_RUNTIME: runtime }, home),
      ).toThrow(
        `CAIRN_ORB_RUNTIME=${runtime} is not implemented yet; only nspawn, podman and e2b are available`,
      );
    },
  );

  test('executor orb with an unknown runtime fails', () => {
    expect(() =>
      createOrbProvider({ CAIRN_EXECUTOR: 'orb', CAIRN_ORB_RUNTIME: 'lxc' }, home),
    ).toThrow('CAIRN_ORB_RUNTIME must be one of');
  });

  test.each([{}, { CAIRN_EXECUTOR: 'host' }])(
    'without the orb executor a garbage runtime is ignored (%j)',
    (env) => {
      expect(createOrbProvider({ ...env, CAIRN_ORB_RUNTIME: 'garbage' }, home)).toBeInstanceOf(
        HostOrbProvider,
      );
    },
  );
});

describe('createComputerOrbProvider', () => {
  test('a host executor with the computer switch gets its own nspawn provider', () => {
    expect(
      createComputerOrbProvider({ [COMPUTER_ENV]: 'orb' }, new HostOrbProvider()),
    ).toBeInstanceOf(NspawnOrbProvider);
  });

  test('an nspawn executor shares its provider with the computer', () => {
    const executor = new NspawnOrbProvider();
    expect(createComputerOrbProvider({ CAIRN_EXECUTOR: 'orb' }, executor)).toBe(executor);
  });

  test.each([{}, { [COMPUTER_ENV]: '' }])(
    'a host executor without the switch has no computer (%j)',
    (env) => {
      expect(createComputerOrbProvider(env, new HostOrbProvider())).toBeUndefined();
    },
  );

  test('an unknown computer value fails instead of silently running without one', () => {
    expect(() =>
      createComputerOrbProvider({ [COMPUTER_ENV]: 'podman' }, new HostOrbProvider()),
    ).toThrow(`${COMPUTER_ENV} must be orb`);
  });
});

describe('daemon startup', () => {
  test.each([
    ['docker', 'CAIRN_ORB_RUNTIME=docker is not implemented yet'],
    ['podman', 'CAIRN_ORB_IMAGE must name the built image'],
  ])(
    'executor orb with %s that cannot start rejects startup before enrolling',
    async (runtime, message) => {
      const api = new FakeMachineApi();
      await expect(
        boot({ api, capEnv: { CAIRN_EXECUTOR: 'orb', CAIRN_ORB_RUNTIME: runtime } }),
      ).rejects.toThrow(message);
      expect(api.calls).toEqual([]);
    },
  );

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
  test('a host daemon with the computer switch reports a computer and keeps the host executor', async () => {
    const { handle, api } = await boot({
      capEnv: { [COMPUTER_ENV]: 'orb' },
      capabilitiesProbe: () => ({ mcpServers: [], skills: [] }),
    });
    await waitFor(() => api.presenceBodies.length > 0);
    const capabilities = (
      api.presenceBodies[0] as { capabilities?: { executor?: string; computer?: boolean } }
    ).capabilities;
    expect(capabilities?.executor).toBe('host');
    expect(capabilities?.computer).toBe(true);
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
