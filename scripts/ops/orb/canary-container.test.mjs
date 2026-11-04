import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { makeTestTempDir, releaseTestTempDir } from '../../test-tmpdir.mjs';
import { aggregateResult, plantSentinels, runCanary } from './canary.mjs';
import {
  attack,
  expectedTargets,
  isContainerConfig,
  networkTargets,
  publicDirectTargets,
  refusedTargets,
  rootReadRows,
} from './canary-attacker.mjs';
import { containerStackEnv } from './canary-stack.mjs';
import { cleanupCanaryContainer } from './container-cleanup.mjs';

const IMAGE = 'cairn-orb-base:eb01c9191591ca17';
const SOCKET = '/run/user/1000/d69pr6/egress.sock';

function containerConfig() {
  return {
    runtime: 'podman',
    hostUid: 1000,
    hostHome: '/home/private-owner',
    sentinels: [
      { path: '/home/private-owner/.ssh/.cairn-canary-fixture', hash: 'a'.repeat(64) },
      { path: '/home/private-owner/.cairn/.cairn-canary-fixture-key', hash: 'b'.repeat(64) },
    ],
    realPaths: ['/home/private-owner/.cairn/machine.json', '/run/user/1000'],
    serverPort: 34567,
  };
}

function green() {
  const config = containerConfig();
  const routes = Object.fromEntries(
    Object.entries(expectedTargets(config)).map(([name, targets]) => [
      name,
      targets.map((target) => ({ target, blocked: true, detail: 'ENOENT' })),
    ]),
  );
  return {
    config,
    orb: { executor: 'orb', routes, githubReach: { ok: true, ms: 1 }, sudo: { works: true } },
    negative: {
      executor: 'host',
      leaked: config.sentinels.map((entry) => entry.path),
      routes: {
        socketAndServer: networkTargets(config)
          .filter((target) => target !== 'http://127.0.0.1:8787')
          .map((target) => ({ target: `direct ${target}`, blocked: false, detail: 'connected' })),
      },
    },
    pushedObjectsClean: true,
    negativeObjectsContainMarker: true,
    orbName: 'cairn-orb-fixture',
    durationMs: 1,
  };
}

test('a container config is recognised only by the podman runtime', () => {
  assert.equal(isContainerConfig(containerConfig()), true);
  for (const runtime of [undefined, 'nspawn', 'docker'])
    assert.equal(isContainerConfig({ ...containerConfig(), runtime }), false);
});

test('container targets replace the nspawn bridge with refusal, public-direct and sudo routes', () => {
  const targets = expectedTargets(containerConfig());
  assert.ok(Object.keys(targets).includes('sudoRead'));
  const rows = targets.socketAndServer;
  assert.ok(!rows.some((row) => row.includes('10.203.0.1')));
  for (const target of refusedTargets(containerConfig()))
    assert.ok(rows.includes(`direct ${target}`) && rows.includes(`proxy ${target}`), target);
  for (const target of publicDirectTargets) assert.ok(rows.includes(`direct ${target}`), target);
  for (const socket of [
    '/var/run/docker.sock',
    '/run/docker.sock',
    '/run/podman/podman.sock',
    '/run/user/1000/podman/podman.sock',
    '/run/user/1000/docker.sock',
  ])
    assert.ok(rows.includes(socket), socket);
  assert.ok(rows.includes('direct dns github.com'));
  assert.deepEqual(targets.sudoRead, [
    ...containerConfig().sentinels.map((entry) => `sudo ${entry.path}`),
    ...containerConfig().realPaths.map((path) => `sudo ${path}`),
    'sudo /home/private-owner enumeration',
  ]);
});

test('the refusal list covers private, loopback, link-local, CGNAT, metadata and a disallowed port', () => {
  const list = refusedTargets(containerConfig());
  for (const expected of [
    'http://10.0.0.1:443',
    'http://192.168.1.1:80',
    'http://172.16.0.1:443',
    'http://169.254.169.254:80',
    'http://100.64.0.1:443',
    'http://127.0.0.1:443',
    'http://1.1.1.1:25',
  ])
    assert.ok(list.includes(expected), expected);
});

test('nspawn targets and routes are unchanged without a runtime', () => {
  const config = { hostHome: '/h', sentinels: [], realPaths: [], serverPort: 1234 };
  assert.deepEqual(networkTargets(config), [
    'http://127.0.0.1:8787',
    'http://127.0.0.1:1234',
    'http://10.203.0.1:1234',
    'http://tailnet-server:1234',
  ]);
  assert.deepEqual(Object.keys(expectedTargets(config)), [
    'directRead',
    'symlinkPush',
    'socketAndServer',
  ]);
});

test('an all-green container run passes and reports its runtime', () => {
  const result = aggregateResult(green());
  assert.equal(result.ok, true);
  assert.equal(result.runtime, 'podman');
  assert.ok(Array.isArray(result.routes.sudoRead));
});

test('an nspawn result carries no runtime field', async () => {
  const config = { hostHome: '/h', sentinels: [], realPaths: [], serverPort: 1234 };
  const routes = Object.fromEntries(
    Object.entries(expectedTargets(config)).map(([name, targets]) => [
      name,
      targets.map((target) => ({ target, blocked: true, detail: 'ENOENT' })),
    ]),
  );
  const result = aggregateResult({
    config,
    orb: { executor: 'orb', routes, githubReach: { ok: true, ms: 1 } },
    negative: { executor: 'host', leaked: [], routes: { socketAndServer: [] } },
    pushedObjectsClean: true,
    negativeObjectsContainMarker: true,
  });
  assert.ok(!('runtime' in result));
});

test('every container probe that succeeds when it should fail fails the whole canary', () => {
  const baseline = green();
  for (const [route, rows] of Object.entries(baseline.orb.routes)) {
    rows.forEach((row, index) => {
      const input = green();
      input.orb.routes[route][index].blocked = false;
      assert.equal(aggregateResult(input).ok, false, `${route}: ${row.target}`);
    });
  }
});

test('missing, duplicated or unknown container rows fail the canary', () => {
  for (const route of Object.keys(green().orb.routes)) {
    for (const mode of ['omitted', 'duplicate', 'unknown']) {
      const input = green();
      const rows = input.orb.routes[route];
      if (mode === 'omitted') rows.pop();
      if (mode === 'duplicate') rows.push(rows[0]);
      if (mode === 'unknown') rows[0].target = 'unknown';
      assert.equal(aggregateResult(input).ok, false, `${route} ${mode}`);
    }
  }
});

test('container root without working sudo proves nothing and fails the canary', () => {
  for (const sudo of [undefined, { works: false }, { works: 'yes' }]) {
    const input = green();
    input.orb.sudo = sudo;
    assert.equal(aggregateResult(input).ok, false, JSON.stringify(sudo));
  }
});

test('the public target must stay reachable through the proxy', () => {
  const input = green();
  input.orb.githubReach = { ok: false, ms: 0 };
  assert.equal(aggregateResult(input).ok, false);
});

test('the host negative control must still reach its listeners and leak the sentinels', () => {
  const noListeners = green();
  noListeners.negative.routes.socketAndServer = [];
  assert.equal(aggregateResult(noListeners).ok, false);
  const noLeak = green();
  noLeak.negative.leaked = [];
  assert.equal(aggregateResult(noLeak).ok, false);
});

function attackFixture(t) {
  const home = realpathSync(makeTestTempDir('orb-canary-container-'));
  t.after(() => releaseTestTempDir(home));
  mkdirSync(join(home, 'workspace'));
  return home;
}

const refusedErrors = (_options, request) =>
  request ? { blocked: true, detail: 'proxy HTTP 403' } : { blocked: true, detail: 'ENETUNREACH' };

function orbOptions(home, overrides = {}) {
  const calls = { connect: [], run: [] };
  return {
    calls,
    options: {
      cwd: join(home, 'workspace'),
      env: {
        HOME: join(home, 'guest'),
        CAIRN_ORB: '1',
        HTTP_PROXY: 'http://127.0.0.1:7890',
      },
      connectTarget: async (options, request) => {
        calls.connect.push({ options, request });
        return refusedErrors(options, request);
      },
      lookup: async () => {
        throw Object.assign(new Error('no resolver'), { code: 'EAI_AGAIN' });
      },
      run: (command, args) => {
        calls.run.push([command, ...args]);
        if (command === 'sudo' && args.includes('id'))
          return { status: 0, stdout: '0\n', stderr: '' };
        if (command === 'sudo')
          return {
            status: 0,
            stdout: JSON.stringify({ rows: [], leaked: [] }),
            stderr: '',
          };
        return { status: 0, stdout: `${'a'.repeat(40)}\tHEAD\n` };
      },
      rootProbe: (config) => ({
        rows: [
          ...config.sentinels.map((entry) => ({
            target: `sudo ${entry.path}`,
            blocked: true,
            detail: 'ENOENT',
          })),
          ...config.realPaths.map((path) => ({
            target: `sudo ${path}`,
            blocked: true,
            detail: 'ENOENT',
          })),
          { target: `sudo ${config.hostHome} enumeration`, blocked: true, detail: 'ENOENT' },
        ],
        leaked: [],
      }),
      ...overrides,
    },
  };
}

test('the container attacker probes exactly the expected targets and reports a clean Orb', async (t) => {
  const home = attackFixture(t);
  const config = { ...containerConfig(), hostHome: '/nonexistent-canary-home' };
  config.sentinels = [];
  config.realPaths = [];
  const { options, calls } = orbOptions(home);
  const result = await attack(config, options);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(result.routes).map(([name, rows]) => [name, rows.map((row) => row.target)]),
    ),
    expectedTargets(config),
  );
  assert.ok(
    Object.values(result.routes)
      .flat()
      .every((row) => row.blocked),
  );
  assert.equal(result.executor, 'orb');
  assert.deepEqual(result.sudo, { works: true });
  assert.equal(result.githubReach.ok, true);
  const git = calls.run.find((call) => call[0] === 'git');
  assert.ok(git.includes('http.proxy=http://127.0.0.1:7890/'));
});

test('proxy rows read 403 for every refused target and a 200 tunnel makes the row unblocked', async (t) => {
  const home = attackFixture(t);
  const config = {
    ...containerConfig(),
    hostHome: '/nonexistent-canary-home',
    sentinels: [],
    realPaths: [],
  };
  const { options } = orbOptions(home, {
    connectTarget: async (target, request) =>
      request?.startsWith('CONNECT 1.1.1.1:25 ')
        ? { blocked: false, detail: 'proxy HTTP 200' }
        : refusedErrors(target, request),
  });
  const result = await attack(config, options);
  const disallowed = result.routes.socketAndServer.find(
    (row) => row.target === 'proxy http://1.1.1.1:25',
  );
  assert.equal(disallowed.blocked, false);
});

test('HTTP targets on the default port are probed directly and through CONNECT on port 80', async (t) => {
  const home = attackFixture(t);
  const config = {
    ...containerConfig(),
    hostHome: '/nonexistent-canary-home',
    sentinels: [],
    realPaths: [],
  };
  const { options, calls } = orbOptions(home);
  await attack(config, options);
  for (const host of ['192.168.1.1', '169.254.169.254']) {
    assert.ok(
      calls.connect.some(
        ({ options, request }) =>
          options.host === host && options.port === 80 && request === undefined,
      ),
    );
    assert.ok(calls.connect.some(({ request }) => request?.startsWith(`CONNECT ${host}:80 `)));
  }
});

test('a direct connection to a public address from the Orb is reported as not blocked', async (t) => {
  const home = attackFixture(t);
  const config = {
    ...containerConfig(),
    hostHome: '/nonexistent-canary-home',
    sentinels: [],
    realPaths: [],
  };
  const { options } = orbOptions(home, {
    connectTarget: async (target, request) =>
      !request && target.host === '1.1.1.1' && target.port === 443
        ? { blocked: false, detail: 'connected' }
        : refusedErrors(target, request),
  });
  const result = await attack(config, options);
  assert.equal(
    result.routes.socketAndServer.find((row) => row.target === 'direct http://1.1.1.1:443').blocked,
    false,
  );
});

test('a docker or podman socket that accepts a connection is reported as not blocked', async (t) => {
  const home = attackFixture(t);
  const config = {
    ...containerConfig(),
    hostHome: '/nonexistent-canary-home',
    sentinels: [],
    realPaths: [],
  };
  const { options } = orbOptions(home, {
    connectTarget: async (target, request) =>
      target.path === '/run/user/1000/podman/podman.sock'
        ? { blocked: false, detail: 'connected' }
        : refusedErrors(target, request),
  });
  const result = await attack(config, options);
  assert.equal(
    result.routes.socketAndServer.find((row) => row.target === '/run/user/1000/podman/podman.sock')
      .blocked,
    false,
  );
});

test('a resolver that answers inside the Orb is reported as not blocked', async (t) => {
  const home = attackFixture(t);
  const config = {
    ...containerConfig(),
    hostHome: '/nonexistent-canary-home',
    sentinels: [],
    realPaths: [],
  };
  const { options } = orbOptions(home, { lookup: async () => ({ address: '140.82.112.3' }) });
  const result = await attack(config, options);
  assert.equal(
    result.routes.socketAndServer.find((row) => row.target === 'direct dns github.com').blocked,
    false,
  );
});

test('container root that reads a sentinel is a leak and an unblocked row', async (t) => {
  const home = attackFixture(t);
  const config = { ...containerConfig(), hostHome: '/nonexistent-canary-home' };
  const path = config.sentinels[0].path;
  const { options } = orbOptions(home, {
    rootProbe: () => ({
      rows: [{ target: `sudo ${path}`, blocked: false, detail: 'sentinel marker read' }],
      leaked: [path],
    }),
  });
  const result = await attack(config, options);
  assert.deepEqual(result.leaked, [path]);
  assert.equal(result.routes.sudoRead[0].blocked, false);
});

test('without working sudo no sudo rows are reported and the result says so', async (t) => {
  const home = attackFixture(t);
  const config = {
    ...containerConfig(),
    hostHome: '/nonexistent-canary-home',
    sentinels: [],
    realPaths: [],
  };
  const { options } = orbOptions(home, {
    run: (command) =>
      command === 'sudo'
        ? { status: 1, stdout: '', stderr: 'sudo: a password is required' }
        : { status: 0, stdout: `${'a'.repeat(40)}\tHEAD\n` },
    rootProbe: () => assert.fail('root probe must not run without sudo'),
  });
  const result = await attack(config, options);
  assert.deepEqual(result.sudo, { works: false });
  assert.deepEqual(result.routes.sudoRead, []);
});

test('the host negative control never runs sudo, the proxy, git or DNS', async (t) => {
  const home = attackFixture(t);
  const config = {
    ...containerConfig(),
    hostHome: '/nonexistent-canary-home',
    sentinels: [],
    realPaths: [],
  };
  const connections = [];
  const result = await attack(config, {
    cwd: join(home, 'workspace'),
    env: { HOME: home },
    connectTarget: async (target, request) => {
      connections.push({ target, request });
      return { blocked: false, detail: 'connected' };
    },
    lookup: async () => assert.fail('host must not resolve'),
    run: () => assert.fail('host must not run commands'),
    rootProbe: () => assert.fail('host must not run the root probe'),
  });
  assert.equal(result.executor, 'host');
  assert.ok(connections.every(({ request }) => request === undefined));
  assert.deepEqual(result.routes.sudoRead, []);
});

test('the root probe reads sentinels as bytes without exposing them and reports absence as blocked', (t) => {
  const home = attackFixture(t);
  for (const name of ['.cairn', '.ssh', '.codex', '.claude']) mkdirSync(join(home, name));
  const planted = plantSentinels(home, 'rootprobe');
  t.after(planted.cleanup);
  const config = {
    ...containerConfig(),
    hostHome: home,
    sentinels: planted.sentinels,
    realPaths: [],
  };
  const script = new URL('./canary-attacker.mjs', import.meta.url).pathname;
  const result = spawnSync(process.execPath, [script, '--root-read'], {
    input: JSON.stringify(config),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.leaked.sort(), planted.sentinels.map((entry) => entry.path).sort());
  for (const marker of planted.markers) assert.ok(!result.stdout.includes(marker));
  assert.ok(output.rows.some((row) => row.target === `sudo ${home} enumeration`));
});

test('a guest directory at the host home path is not host exposure', async (t) => {
  const home = attackFixture(t);
  writeFileSync(join(home, 'workdir'), 'guest');
  const config = {
    ...containerConfig(),
    hostHome: home,
    sentinels: [{ path: join(home, '.ssh', '.cairn-canary-guest'), hash: 'd'.repeat(64) }],
    realPaths: [],
  };
  const result = await attack(config, {
    cwd: join(home, 'workspace'),
    env: { HOME: home },
    network: false,
    connectTarget: async () => assert.fail('guest home must not open a socket'),
    run: () => assert.fail('guest home must not run a command'),
    lookup: async () => assert.fail('guest home must not resolve'),
    rootProbe: () => assert.fail('guest home must not sudo'),
  });
  for (const target of ['$HOME enumeration', `${home} enumeration`]) {
    const row = result.routes.directRead.find((entry) => entry.target === target);
    assert.equal(row?.blocked, true, target);
    assert.equal(row?.detail, 'guest home enumerable; no host sentinels');
  }
  const root = rootReadRows(config);
  const sudo = root.rows.find((entry) => entry.target === `sudo ${home} enumeration`);
  assert.equal(sudo?.blocked, true);
  assert.equal(sudo?.detail, 'guest home enumerable; no host sentinels');
  assert.deepEqual(root.leaked, []);
});

test('a sentinel name in the host home listing is host exposure', () => {
  const home = realpathSync(makeTestTempDir('orb-canary-home-witness-'));
  try {
    writeFileSync(join(home, '.cairn-canary-guest'), 'marker');
    const config = {
      ...containerConfig(),
      hostHome: home,
      sentinels: [{ path: join(home, '.cairn-canary-guest'), hash: 'e'.repeat(64) }],
      realPaths: [],
    };
    const row = rootReadRows(config).rows.find(
      (entry) => entry.target === `sudo ${home} enumeration`,
    );
    assert.equal(row?.blocked, false);
    assert.equal(row?.detail, 'host home enumerable');
  } finally {
    releaseTestTempDir(home);
  }
});

test('the root probe reports blocked rows for paths that do not exist', () => {
  const script = new URL('./canary-attacker.mjs', import.meta.url).pathname;
  const config = {
    ...containerConfig(),
    hostHome: '/nonexistent-canary-home',
    sentinels: [{ path: '/nonexistent-canary-home/.ssh/.cairn-canary-x', hash: 'c'.repeat(64) }],
    realPaths: ['/nonexistent-canary-home/.cairn/machine.json'],
  };
  const result = spawnSync(process.execPath, [script, '--root-read'], {
    input: JSON.stringify(config),
    encoding: 'utf8',
  });
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.leaked, []);
  assert.ok(output.rows.every((row) => row.blocked === true));
  assert.equal(output.rows.length, 3);
});

test('containerStackEnv hands the scratch daemons the runtime, image and relay and nothing else', () => {
  const env = containerStackEnv({
    hostHome: '/home/private-owner',
    env: {
      CAIRN_ORB_IMAGE: IMAGE,
      CAIRN_ORB_EGRESS_SOCKET: SOCKET,
      XDG_RUNTIME_DIR: '/run/user/1000',
      HOME: '/home/private-owner',
      SECRET_TOKEN: 'must-not-leak',
    },
  });
  assert.deepEqual(env, {
    CAIRN_ORB_RUNTIME: 'podman',
    CAIRN_ORB_IMAGE: IMAGE,
    CAIRN_ORB_EGRESS_SOCKET: SOCKET,
    XDG_RUNTIME_DIR: '/run/user/1000',
    XDG_DATA_HOME: '/home/private-owner/.local/share',
    XDG_CONFIG_HOME: '/home/private-owner/.config',
  });
});

test('containerStackEnv refuses a missing image, relay socket or runtime directory', () => {
  const full = {
    CAIRN_ORB_IMAGE: IMAGE,
    CAIRN_ORB_EGRESS_SOCKET: SOCKET,
    XDG_RUNTIME_DIR: '/run/user/1000',
  };
  for (const [name, value] of [
    ['CAIRN_ORB_IMAGE', undefined],
    ['CAIRN_ORB_IMAGE', 'cairn-orb-base:latest'],
    ['CAIRN_ORB_EGRESS_SOCKET', undefined],
    ['CAIRN_ORB_EGRESS_SOCKET', 'relative.sock'],
    ['XDG_RUNTIME_DIR', undefined],
  ])
    assert.throws(
      () => containerStackEnv({ hostHome: '/h', env: { ...full, [name]: value } }),
      new RegExp(name),
    );
});

test('runCanary under the podman runtime plants sentinels, passes the container config and cleans up', async (t) => {
  const home = realpathSync(makeTestTempDir('orb-canary-container-home-'));
  t.after(() => releaseTestTempDir(home));
  for (const name of ['.cairn', '.ssh', '.codex', '.claude']) mkdirSync(join(home, name));
  writeFileSync(join(home, '.cairn/machine.json'), '{}');
  let seen;
  let sentinels;
  await assert.rejects(
    runCanary({
      home,
      runtime: 'podman',
      egressSocketPath: SOCKET,
      preflight: async () => ({ tailnetAddress: '203.0.113.7' }),
      stackFactory: async (input) => {
        seen = input.config;
        sentinels = input.config.sentinels;
        return {
          port: 34567,
          run: async () => {
            throw new Error('stop here');
          },
        };
      },
    }),
    /stop here/,
  );
  assert.equal(seen.runtime, 'podman');
  assert.equal(seen.hostUid, process.getuid());
  assert.ok(!seen.realPaths.includes(`/run/user/${process.getuid()}`));
  assert.ok(seen.realPaths.includes(SOCKET));
  assert.ok(sentinels.every(({ path }) => !existsSync(path)));
});

test('container runtime isolation requires the actual host relay socket path before planting', async (t) => {
  const home = realpathSync(makeTestTempDir('orb-canary-container-home-'));
  t.after(() => releaseTestTempDir(home));
  mkdirSync(join(home, '.cairn'));
  for (const egressSocketPath of ['', 'relative.sock']) {
    await assert.rejects(
      runCanary({
        home,
        runtime: 'podman',
        egressSocketPath,
        preflight: async () => assert.fail('invalid relay path must fail before preflight'),
      }),
      /CAIRN_ORB_EGRESS_SOCKET/,
    );
  }
  assert.deepEqual(readdirSync(join(home, '.cairn')), []);
});

test('runCanary refuses an unknown runtime before planting anything', async (t) => {
  const home = realpathSync(makeTestTempDir('orb-canary-container-home-'));
  t.after(() => releaseTestTempDir(home));
  mkdirSync(join(home, '.cairn'));
  await assert.rejects(
    runCanary({
      home,
      runtime: 'lxc',
      preflight: async () => assert.fail('preflight must not run'),
      stackFactory: async () => assert.fail('no stack'),
    }),
    /CAIRN_ORB_RUNTIME/,
  );
});

const NAME = 'cairn-orb-019a3f00-0000-7000-8000-000000000001';
const OWNER = 'scratch-machine';
const NAMESPACE = 'a'.repeat(16);
const CONTAINER_ID = 'b'.repeat(64);

function fakeCleanup({
  label = '1',
  owner = OWNER,
  conversation = NAME.slice(10),
  id = CONTAINER_ID,
  present = true,
  rmStatus = 0,
} = {}) {
  const calls = [];
  let exists = present;
  return {
    calls,
    run: (command, args) => {
      calls.push([command, ...args]);
      assert.equal(command, 'podman');
      if (args[0] === 'container' && args[1] === 'exists')
        return { status: exists ? 0 : 1, stdout: '' };
      if (args[0] === 'container' && args[1] === 'inspect')
        return {
          status: 0,
          stdout: args.includes('--format')
            ? `${label}\n`
            : JSON.stringify([
                {
                  Id: id,
                  Config: {
                    Labels: {
                      'cairn.orb': label,
                      'cairn.owner': owner,
                      'cairn.conversation': conversation,
                    },
                  },
                },
              ]),
        };
      if (args[0] === 'rm') {
        if (rmStatus === 0) exists = false;
        return { status: rmStatus, stdout: '', stderr: 'rm failed' };
      }
      throw new Error(`unexpected ${args.join(' ')}`);
    },
  };
}

test('container cleanup force-removes exactly the labelled scratch container and its runtime directory', (t) => {
  const runtime = makeTestTempDir('orb-container-cleanup-');
  t.after(() => releaseTestTempDir(runtime));
  const directory = join(runtime, 'cairn-orb', NAMESPACE, NAME);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'relay.sock.token'), 'x');
  const { run, calls } = fakeCleanup();
  const errors = [];
  assert.equal(
    cleanupCanaryContainer({
      name: NAME,
      ownerId: OWNER,
      runtimeNamespace: NAMESPACE,
      run,
      runtimeDirectory: runtime,
      errors,
    }),
    true,
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(
    calls.filter((call) => call[1] === 'rm'),
    [['podman', 'rm', '--force', '--ignore', '--time', '5', CONTAINER_ID]],
  );
  assert.equal(existsSync(directory), false);
});

test('container cleanup refuses a container without the cairn.orb label', () => {
  const { run, calls } = fakeCleanup({ label: '' });
  const errors = [];
  assert.equal(
    cleanupCanaryContainer({
      name: NAME,
      ownerId: OWNER,
      runtimeNamespace: NAMESPACE,
      run,
      runtimeDirectory: '/nonexistent',
      errors,
    }),
    false,
  );
  assert.ok(!calls.some((call) => call[1] === 'rm'));
  assert.ok(errors.length > 0);
});

test('container cleanup refuses names other than a scratch Thread container', () => {
  for (const name of [
    'cairn-orb-base',
    'cairn-orb-check-abcd1234',
    'cairn-orb-',
    '../cairn-orb-x',
    `${NAME}-other`,
    'cairn-orb-ABC',
  ])
    assert.throws(
      () =>
        cleanupCanaryContainer({
          name,
          ownerId: OWNER,
          runtimeNamespace: NAMESPACE,
          run: () => assert.fail('no command'),
          runtimeDirectory: '/x',
        }),
      /scratch Thread container/,
    );
});

test('container cleanup reports a failed removal and leaves the runtime directory', (t) => {
  const runtime = makeTestTempDir('orb-container-cleanup-');
  t.after(() => releaseTestTempDir(runtime));
  const directory = join(runtime, 'cairn-orb', NAMESPACE, NAME);
  mkdirSync(directory, { recursive: true });
  const { run } = fakeCleanup({ rmStatus: 1 });
  const errors = [];
  assert.equal(
    cleanupCanaryContainer({
      name: NAME,
      ownerId: OWNER,
      runtimeNamespace: NAMESPACE,
      run,
      runtimeDirectory: runtime,
      errors,
    }),
    false,
  );
  assert.ok(errors.length > 0);
  assert.equal(existsSync(directory), true);
});

test('container cleanup of an absent container only removes a leftover runtime directory', (t) => {
  const runtime = makeTestTempDir('orb-container-cleanup-');
  t.after(() => releaseTestTempDir(runtime));
  const { run, calls } = fakeCleanup({ present: false });
  assert.equal(
    cleanupCanaryContainer({
      name: NAME,
      ownerId: OWNER,
      runtimeNamespace: NAMESPACE,
      run,
      runtimeDirectory: runtime,
      errors: [],
    }),
    true,
  );
  assert.ok(!calls.some((call) => call[1] === 'rm'));
});

test('a recorded container is accepted by the inventory, cleaned through podman, and bad names are rejected', (t) => {
  const home = realpathSync(makeTestTempDir('orb-canary-container-recover-'));
  const bin = makeTestTempDir('orb-canary-podman-stub-');
  t.after(() => {
    releaseTestTempDir(home);
    releaseTestTempDir(bin);
  });
  for (const name of ['.cairn', '.ssh', '.codex', '.claude']) mkdirSync(join(home, name));
  writeFileSync(join(bin, 'podman'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$0.log"\nexit 1\n', {
    mode: 0o755,
  });
  const saved = { PATH: process.env.PATH, XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR };
  t.after(() => {
    process.env.PATH = saved.PATH;
    if (saved.XDG_RUNTIME_DIR === undefined) delete process.env.XDG_RUNTIME_DIR;
    else process.env.XDG_RUNTIME_DIR = saved.XDG_RUNTIME_DIR;
  });
  process.env.PATH = `${bin}:${saved.PATH}`;
  process.env.XDG_RUNTIME_DIR = bin;
  const planted = plantSentinels(home, 'recovery');
  planted.record({ kind: 'container', name: NAME, ownerId: OWNER, runtimeNamespace: NAMESPACE });
  for (const name of ['cairn-orb-base', `${NAME};rm`, 'cairn-orb-check-abcd1234', undefined])
    assert.throws(
      () =>
        planted.record({ kind: 'container', name, ownerId: OWNER, runtimeNamespace: NAMESPACE }),
      /inventory/,
    );
  planted.cleanup();
  assert.match(
    readFileSync(join(bin, 'podman.log'), 'utf8'),
    new RegExp(`container exists ${NAME}`),
  );
  assert.deepEqual(readdirSync(join(home, '.cairn')), ['orb-canary-runs']);
});

for (const mismatch of [
  { owner: 'foreign-machine' },
  { owner: '' },
  { conversation: 'foreign-conversation' },
  { id: 'invalid' },
]) {
  test(`container cleanup preserves foreign or unverifiable container ${JSON.stringify(mismatch)}`, () => {
    const { run, calls } = fakeCleanup(mismatch);
    const errors = [];
    assert.equal(
      cleanupCanaryContainer({
        name: NAME,
        ownerId: OWNER,
        runtimeNamespace: NAMESPACE,
        run,
        errors,
      }),
      false,
    );
    assert.ok(!calls.some((call) => call[1] === 'rm'));
  });
}

test('container cleanup requires owner and bounded transport namespace before commands', () => {
  for (const invalid of [
    { ownerId: '' },
    { ownerId: '../owner' },
    { runtimeNamespace: '../escape' },
    { runtimeNamespace: '' },
  ]) {
    assert.throws(
      () =>
        cleanupCanaryContainer({
          name: NAME,
          ownerId: OWNER,
          runtimeNamespace: NAMESPACE,
          ...invalid,
          run: () => assert.fail('no command'),
        }),
      /owner|namespace/,
    );
  }
});
