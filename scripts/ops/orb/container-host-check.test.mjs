import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkContainerHost, parseContainerHostCheck } from './container-host-check.mjs';
import { checkHost } from './orb-host-check.mjs';

const IMAGE = 'cairn-orb-base:eb01c9191591ca17';
const SOCKET = '/run/user/1000/cairn-orb-egress/egress.sock';

const goodProbe = () => ({
  version: '6.1.4',
  rootless: true,
  capBnd: '00000000800000eb',
  capEff: '0000000000000000',
  capAmb: '0000000000000000',
  uid: 1000,
  interfaces: ['lo'],
  sudo: true,
  homeVisible: false,
  egress: {
    'github.com:443': 200,
    '10.0.0.1:443': 403,
    '169.254.169.254:80': 403,
    '100.64.0.1:443': 403,
    '127.0.0.1:443': 403,
    'github.com:25': 403,
  },
});

const goodInput = () => ({
  podman: { version: '6.1.4', rootless: true },
  subuid: true,
  subgid: true,
  cgroupControllers: 'cpuset cpu io memory hugetlb pids rdma misc',
  image: { tag: IMAGE, exists: true },
  relay: { directory: 'ok', socket: 'ok', boundary: 'ok', listening: true, unit: 'active' },
  probe: goodProbe(),
  probeError: null,
});

test('a host with every container prerequisite passes with the machine-readable record', () => {
  const result = parseContainerHostCheck(goodInput());
  assert.equal(result.ok, true);
  assert.deepEqual(
    {
      runtime: result.runtime,
      podman: result.podman,
      rootless: result.rootless,
      subuid: result.subuid,
      subgid: result.subgid,
      cgroupControllers: result.cgroupControllers,
      image: result.image,
      relay: result.relay,
      capBnd: result.capBnd,
      capEff: result.capEff,
      capAmb: result.capAmb,
      uid: result.uid,
      interfaces: result.interfaces,
      sudo: result.sudo,
      homeVisible: result.homeVisible,
      egress: result.egress,
      privateEgress: result.privateEgress,
      spawnRemove: result.spawnRemove,
    },
    {
      runtime: 'podman',
      podman: '6.1.4',
      rootless: true,
      subuid: 'ok',
      subgid: 'ok',
      cgroupControllers: 'ok',
      image: IMAGE,
      relay: 'ok',
      capBnd: '00000000800000eb',
      capEff: '0000000000000000',
      capAmb: '0000000000000000',
      uid: 1000,
      interfaces: ['lo'],
      sudo: true,
      homeVisible: false,
      egress: 'ok',
      privateEgress: 'denied',
      spawnRemove: 'ok',
    },
  );
});

test('the record carries no nspawn-only fields', () => {
  const result = parseContainerHostCheck(goodInput());
  for (const field of ['firewall', 'ufw', 'polkit', 'foreignRules', 'memoryMax', 'negativeControl'])
    assert.ok(!(field in result), field);
});

const failures = [
  ['the relay export has sibling files', (x) => (x.relay.boundary = 'siblings')],
  ['the relay export boundary is unknown', (x) => delete x.relay.boundary],
  ['podman is rootful', (x) => (x.podman.rootless = false)],
  ['podman is not installed', (x) => (x.podman = null)],
  ['the user has no subuid range', (x) => (x.subuid = false)],
  ['the user has no subgid range', (x) => (x.subgid = false)],
  ['memory is not delegated', (x) => (x.cgroupControllers = 'cpu pids')],
  ['cpu is not delegated', (x) => (x.cgroupControllers = 'memory pids')],
  ['pids is not delegated', (x) => (x.cgroupControllers = 'cpu memory')],
  ['the delegation file is unreadable', (x) => (x.cgroupControllers = null)],
  ['the expected image tag is missing', (x) => (x.image.exists = false)],
  ['the relay socket does not exist', (x) => (x.relay.socket = 'missing')],
  ['the relay socket mode is wrong', (x) => (x.relay.socket = 'mode')],
  ['the relay socket is not a socket', (x) => (x.relay.socket = 'not-socket')],
  ['the relay socket belongs to another user', (x) => (x.relay.socket = 'owner')],
  ['the relay directory mode is wrong', (x) => (x.relay.directory = 'mode')],
  ['the relay directory belongs to another user', (x) => (x.relay.directory = 'owner')],
  ['the relay directory is missing', (x) => (x.relay.directory = 'missing')],
  ['nothing listens on the relay socket', (x) => (x.relay.listening = false)],
  [
    'the probe container could not be spawned',
    (x) => {
      x.probe = null;
      x.probeError = 'boom';
    },
  ],
  ['the probe result is missing', (x) => (x.probe = null)],
  ['the refusal inventory is incomplete', (x) => delete x.probe.egress['100.64.0.1:443']],
  ['the bounding set differs', (x) => (x.probe.capBnd = '00000000a80425fb')],
  ['the bounding set is unknown', (x) => (x.probe.capBnd = null)],
  ['the bounding set lacks a capability', (x) => (x.probe.capBnd = '00000000000000eb')],
  ['the effective set is not empty', (x) => (x.probe.capEff = '00000000800000eb')],
  ['the ambient set is not empty', (x) => (x.probe.capAmb = '00000000800000eb')],
  ['the effective set is unknown', (x) => (x.probe.capEff = null)],
  ['the ambient set is unknown', (x) => (x.probe.capAmb = null)],
  ['the container user is not uid 1000', (x) => (x.probe.uid = 0)],
  ['the container user is unknown', (x) => (x.probe.uid = null)],
  ['a non-lo interface exists', (x) => (x.probe.interfaces = ['eth0', 'lo'])],
  ['a tap interface replaces lo', (x) => (x.probe.interfaces = ['tap0'])],
  ['no interface is reported', (x) => (x.probe.interfaces = [])],
  ['sudo does not work', (x) => (x.probe.sudo = false)],
  ['the host home is visible', (x) => (x.probe.homeVisible = true)],
  ['the probe is rootful per its own report', (x) => (x.probe.rootless = false)],
  ['the probe container could not be removed', (x) => (x.probe.removeError = 'rm failed')],
  ['the relay refuses the public target', (x) => (x.probe.egress['github.com:443'] = 403)],
  ['the relay is silent for the public target', (x) => (x.probe.egress['github.com:443'] = null)],
  ['the relay opens a private target', (x) => (x.probe.egress['10.0.0.1:443'] = 200)],
  ['the relay opens the metadata address', (x) => (x.probe.egress['169.254.169.254:80'] = 200)],
  ['the relay opens a disallowed port', (x) => (x.probe.egress['github.com:25'] = 200)],
  ['the relay is silent for a private target', (x) => (x.probe.egress['100.64.0.1:443'] = null)],
  ['the relay probe results are missing', (x) => (x.probe.egress = null)],
];

for (const [name, change] of failures) {
  test(`fails closed when ${name}`, () => {
    const input = goodInput();
    change(input);
    const result = parseContainerHostCheck(input);
    assert.equal(result.ok, false);
    assert.ok(result.errors.length > 0);
  });
}

test('a relay unit that is not running is informational while the socket is live', () => {
  const input = goodInput();
  input.relay.unit = 'inactive';
  const result = parseContainerHostCheck(input);
  assert.equal(result.ok, true);
  assert.equal(result.relayUnit, 'inactive');
});

function deps(overrides = {}) {
  const calls = [];
  const files = {
    '/etc/subuid': 'root:100000:65536\nian:100000:65536\n',
    '/etc/subgid': 'ian:100000:65536\n',
    '/sys/fs/cgroup/user.slice/user-1000.slice/user@1000.service/cgroup.controllers':
      'cpuset cpu io memory pids\n',
  };
  const stats = {
    '/run/user/1000/cairn-orb-egress': {
      isDirectory: () => true,
      isSocket: () => false,
      isSymbolicLink: () => false,
      uid: 1000,
      mode: 0o40700,
    },
    [SOCKET]: {
      isDirectory: () => false,
      isSocket: () => true,
      isSymbolicLink: () => false,
      uid: 1000,
      mode: 0o140600,
    },
  };
  const base = {
    uid: 1000,
    username: 'ian',
    hostHome: '/home/ian',
    env: { CAIRN_ORB_IMAGE: IMAGE, CAIRN_ORB_EGRESS_SOCKET: SOCKET },
    run: (cmd, args) => {
      calls.push([cmd, ...args]);
      if (cmd === 'podman' && args[0] === 'info')
        return {
          status: 0,
          stdout: JSON.stringify({
            version: { Version: '6.1.4' },
            host: { security: { rootless: true } },
          }),
        };
      if (cmd === 'podman' && args[0] === 'image') return { status: 0, stdout: '' };
      if (cmd === 'systemctl') return { status: 0, stdout: 'active\n' };
      throw new Error(`unexpected ${cmd} ${args.join(' ')}`);
    },
    readFile: (path) => {
      if (!(path in files)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return files[path];
    },
    stat: (path) => {
      if (!(path in stats)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return stats[path];
    },
    entries: () => ['egress.sock'],
    realpath: (path) => path,
    connect: async () => true,
    probe: (options) => {
      calls.push(['probe', options.image, options.orbId, options.egressSocketPath]);
      return goodProbe();
    },
  };
  return { calls, files, stats, options: { ...base, ...overrides } };
}

test('the collector passes on a fully provisioned host and probes with the expected image', async () => {
  const { calls, options } = deps();
  const result = await checkContainerHost(options);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const probe = calls.find((call) => call[0] === 'probe');
  assert.equal(probe[1], IMAGE);
  assert.match(probe[2], /^cairn-orb-check-[a-f0-9]{8}$/);
  assert.equal(probe[3], SOCKET);
});

test('a missing image fails and never spawns the probe container', async () => {
  const { calls, options } = deps({
    run: (cmd, args) =>
      cmd === 'podman' && args[0] === 'image'
        ? { status: 1, stdout: '' }
        : deps().options.run(cmd, args),
  });
  const result = await checkContainerHost(options);
  assert.equal(result.ok, false);
  assert.equal(result.image, null);
  assert.ok(!calls.some((call) => call[0] === 'probe'));
});

test('a rootful podman fails and never spawns the probe container', async () => {
  const { calls, options } = deps({
    run: (cmd, args) =>
      cmd === 'podman' && args[0] === 'info'
        ? {
            status: 0,
            stdout: JSON.stringify({
              version: { Version: '6.1.4' },
              host: { security: { rootless: false } },
            }),
          }
        : { status: 0, stdout: '' },
  });
  const result = await checkContainerHost(options);
  assert.equal(result.ok, false);
  assert.equal(result.rootless, false);
  assert.ok(!calls.some((call) => call[0] === 'probe'));
});

for (const [name, mode, kind] of [
  ['socket mode 0644', 0o140644, 'socket'],
  ['socket mode 0666', 0o140666, 'socket'],
  ['socket mode 0700', 0o140700, 'socket'],
  ['directory mode 0755', 0o40755, 'directory'],
  ['directory mode 0750', 0o40750, 'directory'],
]) {
  test(`the collector fails closed on relay ${name}`, async () => {
    const context = deps();
    const path = kind === 'socket' ? SOCKET : '/run/user/1000/cairn-orb-egress';
    context.stats[path] = { ...context.stats[path], mode };
    const result = await checkContainerHost(context.options);
    assert.equal(result.ok, false);
    assert.notEqual(result.relay, 'ok');
  });
}

test('the collector fails when the socket is replaced by a symlink or another uid', async () => {
  for (const change of [{ isSocket: () => false, isSymbolicLink: () => true }, { uid: 0 }]) {
    const context = deps();
    context.stats[SOCKET] = { ...context.stats[SOCKET], ...change };
    assert.equal((await checkContainerHost(context.options)).ok, false);
  }
});

test('the collector fails when the relay does not accept connections', async () => {
  const { options } = deps({ connect: async () => false });
  const result = await checkContainerHost(options);
  assert.equal(result.ok, false);
  assert.equal(result.relay, 'not-listening');
});

test('the collector fails without a subuid or subgid entry for the user', async () => {
  for (const file of ['/etc/subuid', '/etc/subgid']) {
    const context = deps();
    context.files[file] = 'root:100000:65536\n';
    assert.equal((await checkContainerHost(context.options)).ok, false, file);
  }
  const small = deps();
  small.files['/etc/subuid'] = 'ian:100000:1000\n';
  assert.equal((await checkContainerHost(small.options)).ok, false);
});

test('the collector fails when cpu, memory or pids is not delegated', async () => {
  for (const controllers of ['cpuset cpu io pids\n', 'cpuset memory pids\n', 'cpu memory\n']) {
    const context = deps();
    context.files[
      '/sys/fs/cgroup/user.slice/user-1000.slice/user@1000.service/cgroup.controllers'
    ] = controllers;
    assert.equal((await checkContainerHost(context.options)).ok, false, controllers);
  }
});

test('the collector refuses root, a missing image setting and unpinned tags', async () => {
  assert.equal((await checkContainerHost(deps({ uid: 0 }).options)).ok, false);
  for (const image of [undefined, '', 'cairn-orb-base:latest', 'alpine:3', 'cairn-orb-base:x y']) {
    const context = deps({ env: { CAIRN_ORB_IMAGE: image, CAIRN_ORB_EGRESS_SOCKET: SOCKET } });
    const result = await checkContainerHost(context.options);
    assert.equal(result.ok, false, String(image));
    assert.ok(!context.calls.some((call) => call[0] === 'probe'));
  }
});

test('a probe that fails in the helper is reported and fails the check', async () => {
  const { options } = deps({ probe: () => ({ error: 'image missing' }) });
  const result = await checkContainerHost(options);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('image missing')));
});

test('a throwing probe is reported and fails the check', async () => {
  const { options } = deps({
    probe: () => {
      throw new Error('podman exploded');
    },
  });
  const result = await checkContainerHost(options);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('podman exploded')));
});

test('the real filesystem and connect checks accept a live 0600 socket and refuse a wider one', {
  skip: process.getuid() === 0,
}, async (t) => {
  const socketDirectory = join(realpathSync(tmpdir()), `cairn-orb-egress-${process.pid}`);
  mkdirSync(socketDirectory, { mode: 0o700 });
  t.after(() => rmSync(socketDirectory, { recursive: true, force: true }));
  const path = join(socketDirectory, 'egress.sock');
  const server = createServer((socket) => socket.destroy());
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, resolve);
  });
  t.after(() => server.close());
  const real = () =>
    deps({
      env: { CAIRN_ORB_IMAGE: IMAGE, CAIRN_ORB_EGRESS_SOCKET: path },
      uid: process.getuid(),
      stat: undefined,
      entries: undefined,
      realpath: undefined,
      connect: undefined,
    }).options;
  chmodSync(path, 0o600);
  assert.equal((await checkContainerHost(real())).relay, 'ok');
  const sibling = join(socketDirectory, 'private.pem');
  writeFileSync(sibling, 'synthetic private file', { mode: 0o600 });
  assert.notEqual((await checkContainerHost(real())).relay, 'ok');
  rmSync(sibling);
  chmodSync(path, 0o644);
  assert.equal((await checkContainerHost(real())).relay, 'mode');
  chmodSync(path, 0o600);
  chmodSync(socketDirectory, 0o755);
  assert.equal((await checkContainerHost(real())).relay, 'mode');
  chmodSync(socketDirectory, 0o700);
  server.close();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.notEqual((await checkContainerHost(real())).relay, 'ok');
});

test('CAIRN_ORB_RUNTIME=podman switches the CLI to the container check and nspawn stays the default', () => {
  const script = new URL('./orb-host-check.mjs', import.meta.url).pathname;
  const env = { ...process.env, CAIRN_ORB_RUNTIME: 'podman', CAIRN_ORB_IMAGE: '' };
  const podman = spawnSync(process.execPath, [script, '--json'], { encoding: 'utf8', env });
  const record = JSON.parse(podman.stdout);
  assert.equal(record.runtime, 'podman');
  assert.equal(record.ok, false);
  assert.equal(podman.status, 1);
  const unknown = spawnSync(process.execPath, [script, '--json'], {
    encoding: 'utf8',
    env: { ...process.env, CAIRN_ORB_RUNTIME: 'lxc' },
  });
  assert.equal(JSON.parse(unknown.stdout).ok, false);
  assert.match(JSON.parse(unknown.stdout).errors[0], /CAIRN_ORB_RUNTIME/);
});

test('the nspawn check function is untouched by the container runtime', () => {
  assert.equal(typeof checkHost, 'function');
  assert.throws(() => checkHost({ user: 'someone-else' }), /as ian without sudo/);
});
