import { describe, expect, test } from 'vitest';
import { PodmanOrbRuntime } from '../src/orb/podman.js';
import { probeContainer } from '../src/orb/probe.js';
import type { OrbExecResult } from '../src/orb/provider.js';
import type { OrbRuntime, OrbSpawnSpec } from '../src/orb/runtime.js';
import { FakePodman } from './podman-fake.js';

const IMAGE = 'cairn-orb-base:0123456789ab';
const ORB = 'cairn-orb-check-abcd1234';

const STATUS = [
  'Name:\tsleep',
  'CapInh:\t0000000000000000',
  'CapPrm:\t0000000000000000',
  'CapEff:\t0000000000000000',
  'CapBnd:\t00000000800000eb',
  'CapAmb:\t0000000000000000',
  '',
].join('\n');

const ok = (stdout = ''): OrbExecResult => ({ code: 0, stdout, stderr: '' });

function fakeRuntime(handlers: Record<string, (argv: readonly string[]) => OrbExecResult> = {}) {
  const calls: string[] = [];
  const spawned: OrbSpawnSpec[] = [];
  const runtime: OrbRuntime = {
    name: 'podman',
    health: async () => {
      calls.push('health');
      return { version: '6.1.4', rootless: true };
    },
    buildImage: async () => {},
    imageExists: async () => true,
    spawn: async (spec) => {
      calls.push('spawn');
      spawned.push(spec);
    },
    pause: async () => {},
    remove: async (orbId) => {
      calls.push(`remove ${orbId}`);
    },
    list: async () => [],
    removeImage: async () => {},
    exec: async (_orbId, argv) => {
      calls.push(`exec ${argv.join(' ')}`);
      const key = argv[0] === 'sh' ? (argv.at(-1) ?? '') : argv.join(' ');
      const handler = handlers[key];
      if (handler) return handler(argv);
      switch (argv.join(' ')) {
        case 'cat /proc/self/status':
          return ok(STATUS);
        case 'id -u':
          return ok('1000\n');
        case 'ls /sys/class/net':
          return ok('lo\n');
        case 'sudo -n true':
        case 'test ! -e /home/ian':
          return ok();
        default:
          return { code: 1, stdout: '', stderr: 'unexpected' };
      }
    },
  };
  return { runtime, calls, spawned };
}

const options = { image: IMAGE, orbId: ORB, hostHome: '/home/ian' };

describe('probeContainer', () => {
  test('reports the capability sets, uid, interfaces and sudo of the container user', async () => {
    const { runtime } = fakeRuntime();
    const probe = await probeContainer(runtime, options);
    expect(probe).toMatchObject({
      version: '6.1.4',
      rootless: true,
      capBnd: '00000000800000eb',
      capEff: '0000000000000000',
      capAmb: '0000000000000000',
      uid: 1000,
      interfaces: ['lo'],
      sudo: true,
      egress: null,
    });
  });

  test('spawns the probe container without mounts and without a network', async () => {
    const { runtime, spawned } = fakeRuntime();
    await probeContainer(runtime, options);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]).toMatchObject({ orbId: ORB, image: IMAGE, mounts: [], egress: 'none' });
  });

  test('removes the probe container after a successful probe', async () => {
    const { runtime, calls } = fakeRuntime();
    await probeContainer(runtime, options);
    expect(calls.at(-1)).toBe(`remove ${ORB}`);
  });

  test('removes the probe container when an exec throws, and surfaces the error', async () => {
    const { runtime, calls } = fakeRuntime();
    runtime.exec = async () => {
      throw new Error('exec exploded');
    };
    await expect(probeContainer(runtime, options)).rejects.toThrow('exec exploded');
    expect(calls.at(-1)).toBe(`remove ${ORB}`);
  });

  test('removes the probe container when spawn fails, and surfaces the error', async () => {
    const { runtime, calls } = fakeRuntime();
    runtime.spawn = async () => {
      throw new Error('image missing');
    };
    await expect(probeContainer(runtime, options)).rejects.toThrow('image missing');
    expect(calls).toContain(`remove ${ORB}`);
  });

  test('a failing remove does not hide the probe result but is reported', async () => {
    const { runtime } = fakeRuntime();
    runtime.remove = async () => {
      throw new Error('rm failed');
    };
    const probe = await probeContainer(runtime, options);
    expect(probe.removeError).toBe('rm failed');
  });

  test('a container with an extra interface reports it', async () => {
    const { runtime } = fakeRuntime({ 'ls /sys/class/net': () => ok('eth0\nlo\n') });
    expect((await probeContainer(runtime, options)).interfaces).toEqual(['eth0', 'lo']);
  });

  test('unparseable status output yields no capability values instead of a pass', async () => {
    const { runtime } = fakeRuntime({ 'cat /proc/self/status': () => ok('garbage') });
    const probe = await probeContainer(runtime, options);
    expect(probe.capBnd).toBeNull();
    expect(probe.capEff).toBeNull();
    expect(probe.capAmb).toBeNull();
  });

  test('a failed exec yields null values instead of a pass', async () => {
    const { runtime } = fakeRuntime({
      'id -u': () => ({ code: 126, stdout: '', stderr: 'denied' }),
      'sudo -n true': () => ({ code: 1, stdout: '', stderr: 'sudo: a password is required' }),
    });
    const probe = await probeContainer(runtime, options);
    expect(probe.uid).toBeNull();
    expect(probe.sudo).toBe(false);
  });

  test('a host home visible inside the container is reported', async () => {
    const { runtime } = fakeRuntime({
      'test ! -e /home/ian': () => ({ code: 1, stdout: '', stderr: '' }),
    });
    expect((await probeContainer(runtime, options)).homeVisible).toBe(true);
    const absent = fakeRuntime();
    expect((await probeContainer(absent.runtime, options)).homeVisible).toBe(false);
  });

  describe('through the relay socket', () => {
    const egressOptions = {
      ...options,
      egressSocketPath: '/run/user/1000/cairn-orb-egress/egress.sock',
    };

    function egressRuntime(statusByTarget: Record<string, string>) {
      const handlers: Record<string, (argv: readonly string[]) => OrbExecResult> = {};
      const fake = fakeRuntime(handlers);
      const base = fake.runtime.exec.bind(fake.runtime);
      fake.runtime.exec = async (orbId, argv, execOptions) => {
        if (argv[0] === 'sh' && argv.at(-2) === 'probe') {
          const target = argv.at(-1) ?? '';
          const line = statusByTarget[target];
          return ok(line === undefined || line === '' ? '' : `${line}\n`);
        }
        return base(orbId, argv, execOptions);
      };
      return fake;
    }

    test('mounts the relay socket and reads the relay verdict per target', async () => {
      const { runtime, spawned } = egressRuntime({
        'github.com:443': 'HTTP/1.1 200 Connection established',
        '10.0.0.1:443': 'HTTP/1.1 403 Forbidden',
        '169.254.169.254:80': 'HTTP/1.1 403 Forbidden',
        '100.64.0.1:443': 'HTTP/1.1 403 Forbidden',
        '127.0.0.1:443': 'HTTP/1.1 403 Forbidden',
        'github.com:25': 'HTTP/1.1 403 Forbidden',
      });
      const probe = await probeContainer(runtime, egressOptions);
      expect(spawned[0]?.egress).toEqual({ socketPath: egressOptions.egressSocketPath });
      expect(probe.egress).toEqual({
        'github.com:443': 200,
        '10.0.0.1:443': 403,
        '169.254.169.254:80': 403,
        '100.64.0.1:443': 403,
        '127.0.0.1:443': 403,
        'github.com:25': 403,
      });
    });

    test('a silent relay is reported as no status, never as a refusal', async () => {
      const { runtime } = egressRuntime({});
      const probe = await probeContainer(runtime, egressOptions);
      expect(Object.values(probe.egress ?? {}).every((status) => status === null)).toBe(true);
    });
  });
});

describe('probeContainer with the real PodmanOrbRuntime argv', () => {
  test('creates the probe with the Orb flags: keep-id, no network, dropped capabilities', async () => {
    const podman = new FakePodman();
    podman.images.add(IMAGE);
    const runtime = new PodmanOrbRuntime({
      ownerId: 'machine-alpha',
      runner: podman.runner,
      command: ['sleep', '120'],
    });
    await probeContainer(runtime, options);
    const create = podman.callsOf('create')[0] ?? [];
    expect(create).toContain('--userns=keep-id:uid=1000,gid=1000');
    expect(create).toContain('--network');
    expect(create[create.indexOf('--network') + 1]).toBe('none');
    for (const capability of ['FSETID', 'NET_BIND_SERVICE', 'SETPCAP', 'SYS_CHROOT'])
      expect(create).toContain(`--cap-drop=${capability}`);
    expect(create.slice(-3)).toEqual([IMAGE, 'sleep', '120']);
    expect(podman.callsOf('rm').length).toBeGreaterThan(0);
  });
});
