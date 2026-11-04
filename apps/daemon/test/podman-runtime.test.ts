import { homedir } from 'node:os';
import { describe, expect, test } from 'vitest';
import { PodmanOrbRuntime } from '../src/orb/podman.js';
import type { OrbSpawnSpec } from '../src/orb/runtime.js';
import { FakePodman } from './podman-fake.js';

const IMAGE = 'cairn-orb-base:0123456789ab';
const ORB = 'cairn-orb-alpha';
const ORB_LABELS = { 'cairn.orb': '1', 'cairn.conversation': 'alpha' };
const FOREIGN_LABELS: Record<string, string>[] = [
  {},
  { 'cairn.orb': '1' },
  { 'cairn.orb': '0', 'cairn.conversation': 'alpha' },
  { 'cairn.orb': '1', 'cairn.conversation': 'someone-else' },
];

function spec(overrides: Partial<OrbSpawnSpec> = {}): OrbSpawnSpec {
  return {
    orbId: ORB,
    image: IMAGE,
    mounts: [
      { source: '/run/user/1000/cairn-orb/cairn-orb-alpha', target: '/run/cairn', readonly: false },
      { source: '/data/orb/dist', target: '/opt/cairn/daemon', readonly: true },
      { source: '/data/orb/seed', target: '/seed', readonly: true },
    ],
    env: { CAIRN_ORB: '1' },
    limits: { cpus: 4, memoryBytes: 4 * 1024 ** 3, pids: 4096 },
    egress: 'none',
    ...overrides,
  };
}

function fixture(options: { command?: readonly string[] } = {}) {
  const podman = new FakePodman();
  podman.images.add(IMAGE);
  const runtime = new PodmanOrbRuntime({ runner: podman.runner, ...options });
  return { podman, runtime };
}

describe('PodmanOrbRuntime orb ids', () => {
  const bad = [
    '',
    'alpha',
    'cairn-orb-',
    'cairn-orb--x',
    '--privileged',
    'cairn-orb-a b',
    'cairn-orb-a;rm',
    'cairn-orb-a/../x',
    'cairn-orb-a\nb',
    `cairn-orb-${'a'.repeat(55)}`,
  ];

  test.each(bad)('rejects %j before any podman call', async (orbId) => {
    const { podman, runtime } = fixture();
    const attempts = [
      runtime.spawn(spec({ orbId })),
      runtime.pause(orbId),
      runtime.remove(orbId),
      runtime.exec(orbId, ['true']),
    ];
    for (const attempt of attempts) await expect(attempt).rejects.toThrow('Invalid orb container');
    expect(podman.calls).toEqual([]);
  });

  test('rejects an invalid snapshot image, volume and environment name before any call', async () => {
    const { podman, runtime } = fixture();
    await expect(runtime.spawn(spec({ snapshotImage: '--rm' }))).rejects.toThrow(
      'Invalid image reference',
    );
    await expect(runtime.imageExists('-x')).rejects.toThrow('Invalid image reference');
    await expect(runtime.removeImage('--all')).rejects.toThrow('Invalid image reference');
    await expect(
      runtime.spawn(spec({ persistentHome: { volume: '../x', target: '/home/user' } })),
    ).rejects.toThrow('Invalid volume name');
    await expect(runtime.spawn(spec({ env: { 'A=B': 'x' } }))).rejects.toThrow(
      'Invalid environment variable name',
    );
    expect(podman.calls).toEqual([]);
  });
});

describe('PodmanOrbRuntime.spawn argv', () => {
  test('creates then starts a missing container with the measured spike flags', async () => {
    const { podman, runtime } = fixture();
    await runtime.spawn(spec());
    expect(podman.calls.map((argv) => argv.slice(0, 3))).toEqual([
      ['podman', 'container', 'exists'],
      ['podman', 'create', '--name'],
      ['podman', 'start', ORB],
    ]);
    expect(podman.callsOf('create')[0]).toEqual([
      'podman',
      'create',
      '--name',
      ORB,
      '--label',
      'cairn.orb=1',
      '--label',
      'cairn.conversation=alpha',
      '--userns=keep-id:uid=1000,gid=1000',
      '--network',
      'none',
      '--cap-drop=FSETID',
      '--cap-drop=NET_BIND_SERVICE',
      '--cap-drop=SETPCAP',
      '--cap-drop=SYS_CHROOT',
      '--http-proxy=false',
      '--pull=never',
      '--cpus',
      '4',
      '--memory',
      String(4 * 1024 ** 3),
      '--memory-swap',
      String(4 * 1024 ** 3),
      '--pids-limit',
      '4096',
      '--ulimit',
      'core=0',
      '--init',
      '-v',
      '/run/user/1000/cairn-orb/cairn-orb-alpha:/run/cairn:rw',
      '-v',
      '/data/orb/dist:/opt/cairn/daemon:ro',
      '-v',
      '/data/orb/seed:/seed:ro',
      '-e',
      'CAIRN_ORB=1',
      IMAGE,
    ]);
  });

  test('never widens the sandbox', async () => {
    const { podman, runtime } = fixture();
    await runtime.spawn(
      spec({
        egress: { socketPath: '/run/user/1000/cairn-orb/egress.sock' },
        persistentHome: { volume: 'cairn-computer-a', target: '/home/user' },
      }),
    );
    const argv = podman.callsOf('create')[0] ?? [];
    const joined = argv.join(' ');
    expect(argv).not.toContain('--cap-drop=all');
    expect(argv).not.toContain('--cap-drop=ALL');
    expect(argv).not.toContain('--privileged');
    expect(argv).not.toContain('--cap-add');
    expect(argv.some((arg) => arg.startsWith('--cap-add'))).toBe(false);
    expect(joined).not.toContain('no-new-privileges');
    expect(joined).not.toContain('--network host');
    expect(joined).not.toContain('--net=host');
    expect(joined).not.toContain('--device');
    expect(joined).not.toContain('--add-host');
    expect(joined).not.toContain('unconfined');
    expect(joined).not.toContain('--read-only');
    expect(joined).not.toMatch(/docker\.sock|podman\.sock|containerd\.sock/);
    expect(joined).not.toContain(homedir());
    expect(argv.slice(argv.indexOf('--network'), argv.indexOf('--network') + 2)).toEqual([
      '--network',
      'none',
    ]);
    expect(argv.filter((arg) => arg.startsWith('--cap-drop='))).toEqual([
      '--cap-drop=FSETID',
      '--cap-drop=NET_BIND_SERVICE',
      '--cap-drop=SETPCAP',
      '--cap-drop=SYS_CHROOT',
    ]);
  });

  test('egress socket adds one mount and one variable, none adds nothing', async () => {
    const none = fixture();
    await none.runtime.spawn(spec({ env: {} }));
    const noneArgv = none.podman.callsOf('create')[0] ?? [];
    expect(noneArgv).not.toContain('-e');
    expect(noneArgv.filter((arg) => arg === '-v')).toHaveLength(3);

    const socket = fixture();
    await socket.runtime.spawn(
      spec({ env: {}, egress: { socketPath: '/run/egress/egress.sock' } }),
    );
    const argv = socket.podman.callsOf('create')[0] ?? [];
    const mounts = argv.flatMap((arg, index) => (argv[index - 1] === '-v' ? [arg] : []));
    expect(mounts.at(-1)).toBe('/run/egress/egress.sock:/run/cairn-egress/egress.sock:rw');
    expect(mounts).toHaveLength(4);
    expect(argv.slice(argv.indexOf('-e'), argv.indexOf('-e') + 2)).toEqual([
      '-e',
      'CAIRN_ORB_EGRESS_SOCKET=/run/cairn-egress/egress.sock',
    ]);
    expect(argv).toContain('none');
  });

  test('persistent home is a named volume mounted after the bind mounts', async () => {
    const { podman, runtime } = fixture();
    await runtime.spawn(
      spec({ persistentHome: { volume: 'cairn-computer-a', target: '/home/user' } }),
    );
    const argv = podman.callsOf('create')[0] ?? [];
    const mounts = argv.flatMap((arg, index) => (argv[index - 1] === '-v' ? [arg] : []));
    expect(mounts).toEqual([
      '/run/user/1000/cairn-orb/cairn-orb-alpha:/run/cairn:rw',
      '/data/orb/dist:/opt/cairn/daemon:ro',
      '/data/orb/seed:/seed:ro',
      'cairn-computer-a:/home/user:rw',
    ]);
  });

  test('an idle command is appended after the image when configured', async () => {
    const { podman, runtime } = fixture({ command: ['sleep', 'infinity'] });
    await runtime.spawn(spec());
    expect(podman.callsOf('create')[0]?.slice(-3)).toEqual([IMAGE, 'sleep', 'infinity']);
  });

  test('environment values are single argv items, never shell text', async () => {
    const { podman, runtime } = fixture();
    await runtime.spawn(spec({ env: { NOTE: 'a b; $(rm -rf /) "x" --privileged' } }));
    const argv = podman.callsOf('create')[0] ?? [];
    expect(argv).toContain('NOTE=a b; $(rm -rf /) "x" --privileged');
    expect(argv).not.toContain('--privileged');
  });

  test.each([
    ['relative source', { source: 'relative/dir', target: '/x', readonly: true }],
    ['relative target', { source: '/data/x', target: 'x', readonly: true }],
    ['colon in source', { source: '/data/a:b', target: '/x', readonly: true }],
    ['colon in target', { source: '/data/a', target: '/x:rw', readonly: true }],
    ['parent segment', { source: '/data/../etc', target: '/x', readonly: true }],
    ['root', { source: '/', target: '/x', readonly: true }],
    ['home directory', { source: homedir(), target: '/x', readonly: false }],
    ['parent of home', { source: '/home', target: '/x', readonly: false }],
    ['docker socket', { source: '/var/run/docker.sock', target: '/x', readonly: false }],
    [
      'podman socket',
      { source: '/run/user/1000/podman/podman.sock', target: '/x', readonly: false },
    ],
    ['runtime directory', { source: '/run/user/1000', target: '/x', readonly: false }],
  ])('refuses %s before any podman call', async (_name, mount) => {
    const { podman, runtime } = fixture();
    await expect(runtime.spawn(spec({ mounts: [mount] }))).rejects.toThrow(/mount/i);
    expect(podman.calls).toEqual([]);
  });

  test('refuses the egress socket when its path is unsafe', async () => {
    const { podman, runtime } = fixture();
    await expect(
      runtime.spawn(spec({ egress: { socketPath: '/var/run/docker.sock' } })),
    ).rejects.toThrow(/mount/i);
    expect(podman.calls).toEqual([]);
  });
});

describe('PodmanOrbRuntime.spawn lifecycle', () => {
  test.each(FOREIGN_LABELS)(
    'refuses a same-name container with mismatched ownership labels %j',
    async (labels) => {
      const { podman, runtime } = fixture();
      podman.containers.set(ORB, {
        name: ORB,
        image: IMAGE,
        state: 'running',
        labels,
        create: [],
      });
      await expect(runtime.spawn(spec())).rejects.toThrow('Orb ownership labels do not match');
      expect(podman.callsOf('start')).toEqual([]);
      expect(podman.callsOf('unpause')).toEqual([]);
      expect(podman.callsOf('rm')).toEqual([]);
    },
  );

  test('refuses a foreign container that wins the create race without modifying it', async () => {
    const { podman } = fixture();
    const original = podman.runner;
    const runtime = new PodmanOrbRuntime({
      runner: async (argv, options) => {
        if (argv[1] === 'create') {
          podman.containers.set(ORB, {
            name: ORB,
            image: IMAGE,
            state: 'exited',
            labels: {},
            create: [],
          });
          return { code: 125, stdout: '', stderr: 'container name is already in use' };
        }
        return original(argv, options);
      },
    });
    await expect(runtime.spawn(spec())).rejects.toThrow('Orb ownership labels do not match');
    expect(podman.callsOf('start')).toEqual([]);
    expect(podman.callsOf('rm')).toEqual([]);
    expect(podman.containers.get(ORB)?.state).toBe('exited');
  });

  test('a running container is a no-op', async () => {
    const { podman, runtime } = fixture();
    await runtime.spawn(spec());
    podman.calls.length = 0;
    await runtime.spawn(spec());
    expect(podman.callsOf('create')).toEqual([]);
    expect(podman.callsOf('start')).toEqual([]);
    expect(podman.containers.size).toBe(1);
  });

  test.each(['created', 'exited'] as const)(
    'a %s container is started, not created',
    async (state) => {
      const { podman, runtime } = fixture();
      podman.containers.set(ORB, {
        name: ORB,
        image: IMAGE,
        state,
        labels: ORB_LABELS,
        create: [],
      });
      await runtime.spawn(spec());
      expect(podman.callsOf('create')).toEqual([]);
      expect(podman.callsOf('start')).toEqual([['podman', 'start', ORB]]);
      expect(podman.containers.get(ORB)?.state).toBe('running');
    },
  );

  test('a paused container is unpaused', async () => {
    const { podman, runtime } = fixture();
    podman.containers.set(ORB, {
      name: ORB,
      image: IMAGE,
      state: 'paused',
      labels: ORB_LABELS,
      create: [],
    });
    await runtime.spawn(spec());
    expect(podman.callsOf('unpause')).toEqual([['podman', 'unpause', ORB]]);
    expect(podman.callsOf('start')).toEqual([]);
  });

  test('an existing container keeps its image even when the spec names another', async () => {
    const { podman, runtime } = fixture();
    podman.containers.set(ORB, {
      name: ORB,
      image: 'cairn-orb-base:old',
      state: 'exited',
      labels: ORB_LABELS,
      create: [],
    });
    await runtime.spawn(spec());
    expect(podman.callsOf('create')).toEqual([]);
    expect(podman.containers.get(ORB)?.image).toBe('cairn-orb-base:old');
  });

  test('creates from the snapshot image when it exists', async () => {
    const { podman, runtime } = fixture();
    podman.images.add('cairn-orb-snap:p1');
    await runtime.spawn(spec({ snapshotImage: 'cairn-orb-snap:p1' }));
    expect(podman.containers.get(ORB)?.image).toBe('cairn-orb-snap:p1');
    expect(podman.calls.some((argv) => argv.slice(1, 3).join(' ') === 'image exists')).toBe(true);
  });

  test('falls back to the image when the snapshot image is missing', async () => {
    const { podman, runtime } = fixture();
    await runtime.spawn(spec({ snapshotImage: 'cairn-orb-snap:gone' }));
    expect(podman.containers.get(ORB)?.image).toBe(IMAGE);
    expect(podman.containers.get(ORB)?.state).toBe('running');
  });

  test('concurrent spawns of one orb create one container', async () => {
    const { podman, runtime } = fixture();
    await Promise.all([runtime.spawn(spec()), runtime.spawn(spec()), runtime.spawn(spec())]);
    expect(podman.callsOf('create')).toHaveLength(1);
    expect(podman.callsOf('start')).toHaveLength(1);
  });

  test('losing a create race adopts the winner and starts it', async () => {
    const { podman } = fixture();
    podman.failWhen((argv) => argv[1] === 'create', {
      code: 125,
      stdout: '',
      stderr: `the container name "${ORB}" is already in use by abc`,
    });
    podman.containers.set(ORB, {
      name: ORB,
      image: IMAGE,
      state: 'exited',
      labels: ORB_LABELS,
      create: [],
    });
    const original = podman.runner;
    let first = true;
    const racing = new PodmanOrbRuntime({
      runner: async (argv, options) => {
        if (first && argv[1] === 'container' && argv[2] === 'exists') {
          first = false;
          return { code: 1, stdout: '', stderr: '' };
        }
        return original(argv, options);
      },
    });
    await racing.spawn(spec());
    expect(podman.containers.get(ORB)?.state).toBe('running');
    expect(podman.callsOf('start')).toHaveLength(1);
  });

  test('a failing create carries stderr, starts nothing and leaves nothing behind', async () => {
    const { podman, runtime } = fixture();
    podman.failWhen((argv) => argv[1] === 'create', {
      code: 125,
      stdout: '',
      stderr: 'Error: crun: cannot set memory limit',
    });
    await expect(runtime.spawn(spec())).rejects.toThrow(
      'podman create failed (125): Error: crun: cannot set memory limit',
    );
    expect(podman.callsOf('start')).toEqual([]);
    expect(podman.containers.size).toBe(0);
  });

  test('a failing start removes the container this call created', async () => {
    const { podman, runtime } = fixture();
    podman.failWhen((argv) => argv[1] === 'start', {
      code: 125,
      stdout: '',
      stderr: 'Error: runtime: cgroup not delegated',
    });
    await expect(runtime.spawn(spec())).rejects.toThrow(
      'podman start failed (125): Error: runtime: cgroup not delegated',
    );
    expect(podman.containers.size).toBe(0);
  });

  test('a failing start keeps a container that existed before this call', async () => {
    const { podman, runtime } = fixture();
    podman.containers.set(ORB, {
      name: ORB,
      image: IMAGE,
      state: 'exited',
      labels: ORB_LABELS,
      create: [],
    });
    podman.failWhen((argv) => argv[1] === 'start', { code: 125, stdout: '', stderr: 'boom' });
    await expect(runtime.spawn(spec())).rejects.toThrow('boom');
    expect(podman.containers.has(ORB)).toBe(true);
    expect(podman.callsOf('rm')).toEqual([]);
  });

  test('an unexpected existence-check failure surfaces stderr and creates nothing', async () => {
    const { podman, runtime } = fixture();
    podman.failWhen((argv) => argv[1] === 'container', {
      code: 125,
      stdout: '',
      stderr: 'cannot connect to the podman store',
    });
    await expect(runtime.spawn(spec())).rejects.toThrow('cannot connect to the podman store');
    expect(podman.callsOf('create')).toEqual([]);
  });

  test('malformed inspect JSON is a clear error and starts nothing', async () => {
    const { podman, runtime } = fixture();
    podman.containers.set(ORB, {
      name: ORB,
      image: IMAGE,
      state: 'exited',
      labels: ORB_LABELS,
      create: [],
    });
    podman.failWhen((argv) => argv[1] === 'container' && argv[2] === 'inspect', {
      code: 0,
      stdout: '<html>not json',
      stderr: '',
    });
    await expect(runtime.spawn(spec())).rejects.toThrow(
      'podman container inspect returned malformed JSON',
    );
    expect(podman.callsOf('start')).toEqual([]);
  });

  test('an unknown container status is refused instead of guessed', async () => {
    const { podman, runtime } = fixture();
    podman.containers.set(ORB, {
      name: ORB,
      image: IMAGE,
      state: 'exited',
      labels: ORB_LABELS,
      create: [],
    });
    podman.failWhen((argv) => argv[1] === 'container' && argv[2] === 'inspect', {
      code: 0,
      stdout: JSON.stringify([{ State: { Status: 'removing' }, Config: { Labels: ORB_LABELS } }]),
      stderr: '',
    });
    await expect(runtime.spawn(spec())).rejects.toThrow('unexpected container state');
    expect(podman.callsOf('start')).toEqual([]);
  });

  test('an aborted signal stops before any podman call', async () => {
    const { podman, runtime } = fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(runtime.spawn(spec(), { signal: controller.signal })).rejects.toThrow();
    expect(podman.calls).toEqual([]);
  });

  test('the abort signal reaches every podman call, halts the sequence and removes the fresh container', async () => {
    const { podman, runtime } = fixture();
    const controller = new AbortController();
    podman.failWhen((argv) => {
      if (argv[1] === 'create') controller.abort();
      return false;
    }, new Error('unused'));
    await expect(runtime.spawn(spec(), { signal: controller.signal })).rejects.toThrow();
    expect(podman.callsOf('start')).toEqual([]);
    podman.calls.forEach((argv, index) => {
      if (argv[1] !== 'rm') expect(podman.execOptions[index]?.signal).toBe(controller.signal);
    });
    expect(podman.containers.size).toBe(0);
  });
});

describe('PodmanOrbRuntime.pause', () => {
  test('stops with a five second grace', async () => {
    const { podman, runtime } = fixture();
    await runtime.spawn(spec());
    await runtime.pause(ORB);
    expect(podman.callsOf('stop')).toEqual([['podman', 'stop', '--time', '5', ORB]]);
    expect(podman.callsOf('commit')).toEqual([]);
    expect(podman.containers.get(ORB)?.state).toBe('exited');
  });

  test('commits the snapshot image after the stop', async () => {
    const { podman, runtime } = fixture();
    await runtime.spawn(spec());
    await runtime.pause(ORB, { snapshotImage: 'cairn-orb-snap:p1' });
    expect(podman.calls.slice(-2).map((argv) => argv[1])).toEqual(['stop', 'commit']);
    expect(podman.callsOf('commit')[0]).toEqual([
      'podman',
      'commit',
      '--quiet',
      ORB,
      'cairn-orb-snap:p1',
    ]);
    expect(podman.images.has('cairn-orb-snap:p1')).toBe(true);
  });

  test('a failing stop commits nothing', async () => {
    const { podman, runtime } = fixture();
    await runtime.spawn(spec());
    podman.failWhen((argv) => argv[1] === 'stop', {
      code: 125,
      stdout: '',
      stderr: 'stop exploded',
    });
    await expect(runtime.pause(ORB, { snapshotImage: 'cairn-orb-snap:p1' })).rejects.toThrow(
      'podman stop failed (125): stop exploded',
    );
    expect(podman.callsOf('commit')).toEqual([]);
  });

  test('pausing an absent container is a no-op, but never fakes a snapshot', async () => {
    const { podman, runtime } = fixture();
    await expect(runtime.pause(ORB)).resolves.toBeUndefined();
    await expect(runtime.pause(ORB, { snapshotImage: 'cairn-orb-snap:p1' })).rejects.toThrow(
      'no such container',
    );
    expect(podman.callsOf('commit')).toEqual([]);
  });
});

describe('PodmanOrbRuntime.remove', () => {
  test('force-removes with a grace period and keeps volumes', async () => {
    const { podman, runtime } = fixture();
    await runtime.spawn(spec());
    await runtime.remove(ORB);
    expect(podman.callsOf('rm')).toEqual([
      ['podman', 'rm', '--force', '--ignore', '--time', '5', ORB],
    ]);
    expect(podman.callsOf('rm')[0]).not.toContain('--volumes');
    expect(podman.containers.size).toBe(0);
  });

  test('removing an absent container succeeds', async () => {
    const { podman, runtime } = fixture();
    podman.failWhen((argv) => argv[1] === 'rm', {
      code: 125,
      stdout: '',
      stderr: 'Error: no container with name or ID "x" found: no such container',
    });
    await expect(runtime.remove(ORB)).resolves.toBeUndefined();
  });

  test('any other failure carries stderr', async () => {
    const { podman, runtime } = fixture();
    podman.failWhen((argv) => argv[1] === 'rm', { code: 125, stdout: '', stderr: 'device busy' });
    await expect(runtime.remove(ORB)).rejects.toThrow('podman rm failed (125): device busy');
  });
});

describe('PodmanOrbRuntime.list', () => {
  test('excludes a labelled container whose conversation label does not match its name', async () => {
    const { podman, runtime } = fixture();
    podman.containers.set(ORB, {
      name: ORB,
      image: IMAGE,
      state: 'running',
      labels: { 'cairn.orb': '1', 'cairn.conversation': 'someone-else' },
      create: [],
    });
    expect(await runtime.list()).toEqual([]);
  });
  test('filters on the orb label and maps states', async () => {
    const { podman, runtime } = fixture();
    const labels = { 'cairn.orb': '1' };
    podman.containers.set('cairn-orb-a', {
      name: 'cairn-orb-a',
      image: IMAGE,
      state: 'running',
      labels: { ...labels, 'cairn.conversation': 'a' },
      create: [],
    });
    podman.containers.set('cairn-orb-b', {
      name: 'cairn-orb-b',
      image: IMAGE,
      state: 'exited',
      labels: { ...labels, 'cairn.conversation': 'b' },
      create: [],
    });
    podman.containers.set('cairn-orb-c', {
      name: 'cairn-orb-c',
      image: IMAGE,
      state: 'created',
      labels: { ...labels, 'cairn.conversation': 'c' },
      create: [],
    });
    podman.containers.set('unrelated', {
      name: 'unrelated',
      image: 'x',
      state: 'running',
      labels: ORB_LABELS,
      create: [],
    });
    expect(await runtime.list()).toEqual([
      { orbId: 'cairn-orb-a', image: IMAGE, state: 'running' },
      { orbId: 'cairn-orb-b', image: IMAGE, state: 'paused' },
      { orbId: 'cairn-orb-c', image: IMAGE, state: 'paused' },
    ]);
    expect(podman.callsOf('ps')).toEqual([
      ['podman', 'ps', '--all', '--filter', 'label=cairn.orb=1', '--format', 'json'],
    ]);
  });

  test('an empty list parses', async () => {
    const { runtime } = fixture();
    expect(await runtime.list()).toEqual([]);
  });

  test('ignores a labelled container whose name is outside the orb namespace', async () => {
    const { podman, runtime } = fixture();
    podman.containers.set('foreign', {
      name: 'foreign',
      image: IMAGE,
      state: 'running',
      labels: { 'cairn.orb': '1' },
      create: [],
    });
    expect(await runtime.list()).toEqual([]);
  });

  test.each([
    ['not json', 'Error: boom', 'returned malformed JSON'],
    ['an object instead of an array', '{}', 'returned unexpected shape'],
    ['rows without names', '[{"State":"running"}]', 'returned unexpected shape'],
    ['empty output', '', 'returned malformed JSON'],
  ])('%s is a clear error', async (_name, stdout, message) => {
    const { podman, runtime } = fixture();
    podman.psOutput = stdout;
    await expect(runtime.list()).rejects.toThrow(`podman ps ${message}`);
  });

  test('a failing ps carries stderr', async () => {
    const { podman, runtime } = fixture();
    podman.failWhen((argv) => argv[1] === 'ps', {
      code: 125,
      stdout: '',
      stderr: 'database locked',
    });
    await expect(runtime.list()).rejects.toThrow('podman ps failed (125): database locked');
  });
});

describe('PodmanOrbRuntime health', () => {
  test('reads version and rootless from podman info', async () => {
    const { podman, runtime } = fixture();
    expect(await runtime.health()).toEqual({ version: '6.1.4', rootless: true });
    expect(podman.calls[0]).toEqual(['podman', 'info', '--format', 'json']);
    podman.info = { version: { Version: '6.1.4' }, host: { security: { rootless: false } } };
    expect(await runtime.health()).toEqual({ version: '6.1.4', rootless: false });
  });

  test.each([
    ['missing fields', { host: {} }],
    ['wrong types', { version: { Version: 6 }, host: { security: { rootless: 'yes' } } }],
  ])('%s is a clear error', async (_name, info) => {
    const { podman, runtime } = fixture();
    podman.info = info;
    await expect(runtime.health()).rejects.toThrow('podman info returned unexpected shape');
  });

  test('malformed output and failures are clear errors', async () => {
    const { podman, runtime } = fixture();
    podman.failWhen((argv) => argv[1] === 'info', { code: 0, stdout: 'nope', stderr: '' });
    await expect(runtime.health()).rejects.toThrow('podman info returned malformed JSON');
    const broken = fixture();
    broken.podman.failWhen((argv) => argv[1] === 'info', {
      code: 125,
      stdout: '',
      stderr: 'cannot find newuidmap',
    });
    await expect(broken.runtime.health()).rejects.toThrow(
      'podman info failed (125): cannot find newuidmap',
    );
  });
});

describe('PodmanOrbRuntime images', () => {
  test('buildImage disables proxy forwarding and passes build args as argv', async () => {
    const { podman, runtime } = fixture();
    await runtime.buildImage({
      contextDir: '/src/orb-image',
      tag: 'cairn-orb-base:abc',
      buildArgs: { NODE_MAJOR: '24', NOTE: 'a b; rm -rf /' },
    });
    expect(podman.callsOf('build')).toEqual([
      [
        'podman',
        'build',
        '--http-proxy=false',
        '--tag',
        'cairn-orb-base:abc',
        '--build-arg',
        'NODE_MAJOR=24',
        '--build-arg',
        'NOTE=a b; rm -rf /',
        '/src/orb-image',
      ],
    ]);
  });

  test('buildImage failure carries stderr', async () => {
    const { podman, runtime } = fixture();
    podman.failWhen((argv) => argv[1] === 'build', {
      code: 1,
      stdout: '',
      stderr: 'pacman: failed',
    });
    await expect(
      runtime.buildImage({ contextDir: '/src', tag: 'cairn-orb-base:abc', buildArgs: {} }),
    ).rejects.toThrow('podman build failed (1): pacman: failed');
  });

  test('buildImage refuses bad tags and build argument names', async () => {
    const { podman, runtime } = fixture();
    await expect(
      runtime.buildImage({ contextDir: '/src', tag: '--squash', buildArgs: {} }),
    ).rejects.toThrow('Invalid image reference');
    await expect(
      runtime.buildImage({
        contextDir: '/src',
        tag: 'cairn-orb-base:abc',
        buildArgs: { 'A B': '1' },
      }),
    ).rejects.toThrow('Invalid build argument name');
    expect(podman.calls).toEqual([]);
  });

  test('imageExists maps exit codes and surfaces real failures', async () => {
    const { podman, runtime } = fixture();
    expect(await runtime.imageExists(IMAGE)).toBe(true);
    expect(await runtime.imageExists('cairn-orb-base:nope')).toBe(false);
    podman.failWhen((argv) => argv[1] === 'image', {
      code: 125,
      stdout: '',
      stderr: 'store locked',
    });
    await expect(runtime.imageExists(IMAGE)).rejects.toThrow(
      'podman image failed (125): store locked',
    );
  });

  test('removeImage ignores a missing image', async () => {
    const { podman, runtime } = fixture();
    await runtime.removeImage(IMAGE);
    expect(podman.callsOf('rmi')).toEqual([['podman', 'rmi', '--ignore', IMAGE]]);
    expect(podman.images.has(IMAGE)).toBe(false);
  });
});

describe('PodmanOrbRuntime.exec', () => {
  test('runs the argv inside the container with env, cwd and input passed as flags', async () => {
    const { podman, runtime } = fixture();
    const result = await runtime.exec(ORB, ['id', '-u'], {
      env: { A: '1', B: undefined, PATH: '/usr/bin' },
      cwd: '/home/user',
      input: 'hello',
    });
    expect(result).toEqual({ code: 0, stdout: '1000\n', stderr: '' });
    expect(podman.callsOf('exec')[0]).toEqual([
      'podman',
      'exec',
      '--interactive',
      '--env',
      'A=1',
      '--env',
      'PATH=/usr/bin',
      '--workdir',
      '/home/user',
      ORB,
      'id',
      '-u',
    ]);
    expect(podman.execOptions.at(-1)?.env).toBeUndefined();
    expect(podman.execOptions.at(-1)?.input).toBe('hello');
  });

  test('without input there is no stdin flag, and the signal is passed on', async () => {
    const { podman, runtime } = fixture();
    const controller = new AbortController();
    await runtime.exec(ORB, ['true'], { signal: controller.signal });
    expect(podman.callsOf('exec')[0]).toEqual(['podman', 'exec', ORB, 'true']);
    expect(podman.execOptions.at(-1)?.signal).toBe(controller.signal);
  });

  test('refuses an empty command and a bad environment name', async () => {
    const { podman, runtime } = fixture();
    await expect(runtime.exec(ORB, [])).rejects.toThrow('Orb exec command is empty');
    await expect(runtime.exec(ORB, ['true'], { env: { 'A B': '1' } })).rejects.toThrow(
      'Invalid environment variable name',
    );
    expect(podman.calls).toEqual([]);
  });
});
