import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { makeTestTempDir, releaseTestTempDir } from '../../test-tmpdir.mjs';

const imageDirectory = join(import.meta.dirname, '../../../apps/daemon/computer-container-image');
const credentialNames = [
  'CAIRN_TOKEN',
  'CAIRN_API_TOKEN',
  'CAIRN_MACHINE_TOKEN',
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'UNRECOGNIZED_VENDOR_TOKEN',
  'CAIRN_FUTURE_SECRET',
];

async function until(predicate, description, timeout = 5_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await delay(15);
  }
  assert.fail(`Timed out waiting for ${description}`);
}

function running(pid) {
  try {
    return !/\) Z /.test(readFileSync(`/proc/${pid}/stat`, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function fixture(t) {
  const allocated = makeTestTempDir('ce-');
  const root = realpathSync(allocated);
  const bin = join(root, 'bin');
  const socket = join(root, 'computer.sock');
  const daemonEntry = join(root, 'cli.mjs');
  const entryPath = join(root, 'entry.sh');
  const desktopPath = join(root, 'desktop.sh');
  const log = join(root, 'events');
  const configPath = join(root, 'fake-config.json');
  const children = [];
  const servers = [];
  mkdirSync(bin);
  const source = readFileSync(join(imageDirectory, 'entry.sh'), 'utf8');
  assert.ok(source.includes('readonly COMPUTER_SOCKET=/run/cairn-computer/computer.sock'));
  assert.ok(source.includes('readonly DAEMON_ENTRY=/opt/cairn/daemon/cli.mjs'));
  assert.ok(source.includes('readonly NODE_BINARY=/usr/bin/node'));
  writeFileSync(
    entryPath,
    source
      .replace(
        'readonly COMPUTER_SOCKET=/run/cairn-computer/computer.sock',
        `readonly COMPUTER_SOCKET=${socket}`,
      )
      .replace(
        'readonly DAEMON_ENTRY=/opt/cairn/daemon/cli.mjs',
        `readonly DAEMON_ENTRY=${daemonEntry}`,
      )
      .replace('readonly NODE_BINARY=/usr/bin/node', `readonly NODE_BINARY=${join(bin, 'node')}`),
  );
  writeFileSync(desktopPath, readFileSync(join(imageDirectory, 'desktop.sh'), 'utf8'));
  const fakeCommand = `#!${process.execPath}
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
const kind = basename(process.argv[1]);
const root = dirname(dirname(process.argv[1]));
const config = JSON.parse(readFileSync(join(root, 'fake-config.json'), 'utf8'));
const { control } = config;
const emit = (event, extra = {}) => appendFileSync(config.log, JSON.stringify({ event, kind, pid: process.pid, ...extra }) + '\\n');
const hold = (duration) => {
  const timer = setInterval(() => {}, 1000);
  process.on('SIGTERM', () => {
    emit('term');
    clearInterval(timer);
    setTimeout(() => process.exit(0), duration);
  });
};
if (kind === 'id') { console.log(control.FAKE_UID ?? '1000'); process.exit(0); }
if (kind === 'sleep') {
  emit('sleep', { duration: process.argv[2] });
  setTimeout(() => process.exit(0), Number(process.argv[2]) * 1000);
} else if (kind === 'ss') {
  const bridgePid = existsSync(config.bridgeReady) ? readFileSync(config.bridgeReady, 'utf8') : '';
  if (control.FAKE_OTHER_LISTENER === '1') console.log('LISTEN 0 5 127.0.0.1:7890 0.0.0.0:* users:(("other",pid=1,fd=3))');
  else if (control.FAKE_BRIDGE_FAIL !== '1' && bridgePid) console.log('LISTEN 0 5 127.0.0.1:7890 0.0.0.0:* users:(("socat",pid=' + bridgePid + ',fd=3))');
} else if (kind === 'socat') {
  emit('start', { args: process.argv.slice(2) });
  if (control.FAKE_BRIDGE_FAIL === '1') process.exit(9);
  writeFileSync(config.bridgeReady, String(process.pid));
  hold(Number(control.FAKE_BRIDGE_TERM_DELAY ?? 0));
} else if (kind === 'node') {
  const countFile = config.count;
  const count = existsSync(countFile) ? Number(readFileSync(countFile, 'utf8')) + 1 : 1;
  writeFileSync(countFile, String(count));
  emit('start', {
    count,
    args: process.argv.slice(2),
    credentials: config.credentialNames.filter((name) => name in process.env),
    environmentNames: Object.keys(process.env).sort(),
    orb: process.env.CAIRN_ORB,
    proxies: Object.fromEntries(['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'NO_PROXY', 'no_proxy'].map((name) => [name, process.env[name] ?? null])),
  });
  if (control.FAKE_AGENT_HOLD === '1') hold(Number(control.FAKE_AGENT_TERM_DELAY ?? 0));
  else process.exit(Number((control.FAKE_CODES ?? '0').split(',')[count - 1] ?? '0'));
} else throw new Error('Unexpected FAKE command: ' + kind);
`;
  for (const command of ['id', 'node', 'socat', 'ss', 'sleep']) {
    const path = join(bin, command);
    writeFileSync(path, fakeCommand);
    chmodSync(path, 0o755);
  }
  const events = () =>
    existsSync(log)
      ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
      : [];
  const agents = () => events().filter(({ event, kind }) => event === 'start' && kind === 'node');
  const ownedPids = () =>
    new Set([...children.map(({ pid }) => pid), ...events().map(({ pid }) => pid)]);
  const signalOwned = (pid, signal) => {
    if (!running(pid)) return;
    assert.equal(readlinkSync(`/proc/${pid}/cwd`), root);
    assert.ok(readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes(`${root}/`));
    process.kill(pid, signal);
  };
  t.after(async () => {
    try {
      for (const pid of ownedPids()) signalOwned(pid, 'SIGTERM');
      const deadline = Date.now() + 1_500;
      while ([...ownedPids()].some(running) && Date.now() < deadline) await delay(15);
      for (const pid of ownedPids()) signalOwned(pid, 'SIGKILL');
      await until(
        () => [...ownedPids()].every((pid) => !running(pid)),
        'owned FAKE commands to exit',
      );
      await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
    } finally {
      assert.equal(releaseTestTempDir(allocated), true);
    }
  });
  const listen = () =>
    new Promise((resolve, reject) => {
      const server = createServer();
      servers.push(server);
      server.once('error', reject);
      server.listen(socket, () => resolve(server));
    });
  const start = (extra = {}, script = entryPath, args = []) => {
    writeFileSync(
      configPath,
      JSON.stringify({
        log,
        count: join(root, 'count'),
        bridgeReady: join(root, 'bridge-ready'),
        credentialNames,
        control: Object.fromEntries(
          Object.entries(extra).filter(([key]) => key.startsWith('FAKE_')),
        ),
      }),
    );
    const child = spawn('/bin/bash', [script, ...args], {
      cwd: root,
      env: {
        PATH: `${bin}:/usr/bin:/bin`,
        HOME: root,
        USER: 'user',
        LOGNAME: 'user',
        LANG: 'C',
        DISPLAY: ':1',
        ...Object.fromEntries(Object.entries(extra).filter(([key]) => !key.startsWith('FAKE_'))),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
    let stderr = '';
    child.stdout.resume();
    child.stderr.on('data', (data) => {
      stderr += data;
    });
    return {
      child,
      async exited() {
        await until(() => child.exitCode !== null || child.signalCode !== null, 'entry exit');
        return { code: child.exitCode, signal: child.signalCode, stderr };
      },
    };
  };
  return {
    root,
    socket,
    daemonEntry,
    desktopPath,
    events,
    agents,
    listen,
    start,
    ownedPids,
    signalOwned,
  };
}

test('FAKE commands, not container proof: incorrect agent and desktop UIDs never launch', async (t) => {
  for (const uid of ['0', '1001']) {
    const f = fixture(t);
    for (const script of [undefined, f.desktopPath]) {
      const result = await f.start({ FAKE_UID: uid }, script).exited();
      assert.equal(result.code, 1, result.stderr);
      assert.match(result.stderr, /must run as uid 1000/);
    }
    assert.deepEqual(f.events(), []);
  }
});

test('FAKE commands, real Unix socket: regular files cannot trigger the fixed orb-computer argv', async (t) => {
  const f = fixture(t);
  writeFileSync(f.socket, 'not a socket');
  const run = f.start();
  await until(
    () => f.events().filter(({ event }) => event === 'sleep').length >= 2,
    'socket readiness probes',
  );
  assert.deepEqual(f.agents(), []);
  unlinkSync(f.socket);
  await f.listen();
  assert.equal((await run.exited()).code, 0);
  assert.deepEqual(
    f.agents().map(({ args }) => args),
    [[f.daemonEntry, 'orb-computer', '--socket', f.socket]],
  );
  assert.equal(f.agents()[0].orb, '1');
});

test('FAKE commands: Cairn, machine, and provider API credentials cannot reach the agent', async (t) => {
  const f = fixture(t);
  await f.listen();
  const result = await f
    .start({
      ...Object.fromEntries(credentialNames.map((name) => [name, 'FAKE-CREDENTIAL-SENTINEL'])),
      UNLISTED_METADATA: 'FAKE-NONSECRET-SENTINEL',
    })
    .exited();
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(f.agents()[0].credentials, []);
  assert.deepEqual(
    f.agents()[0].environmentNames,
    ['CAIRN_ORB', 'DISPLAY', 'HOME', 'LANG', 'LOGNAME', 'PATH', 'USER'].sort(),
  );
});

test('FAKE commands: only exit 75 restarts and every other exit code is propagated once', async (t) => {
  for (const codes of ['75,75,0', '0', '1', '2', '74', '76', '143']) {
    const f = fixture(t);
    await f.listen();
    const result = await f.start({ FAKE_CODES: codes }).exited();
    const expected = codes.split(',').map(Number);
    assert.equal(result.code, expected.at(-1), result.stderr);
    assert.equal(f.agents().length, expected.length, codes);
  }
});

test('FAKE commands: SIGTERM reaches the agent and entry waits for every owned child', async (t) => {
  const f = fixture(t);
  await f.listen();
  const run = f.start({
    CAIRN_ORB_EGRESS_SOCKET: join(f.root, 'egress.sock'),
    FAKE_AGENT_HOLD: '1',
    FAKE_AGENT_TERM_DELAY: '80',
    FAKE_BRIDGE_TERM_DELAY: '400',
  });
  await until(() => f.agents().length === 1, 'agent start');
  f.signalOwned(run.child.pid, 'SIGTERM');
  const result = await run.exited();
  assert.equal(result.code, 0, result.stderr);
  assert.ok(f.events().some(({ event, kind }) => event === 'term' && kind === 'node'));
  assert.deepEqual(
    [...f.ownedPids()].filter(running),
    [],
    'entry exited while its owned child was still running',
  );
});

test('FAKE commands: SIGTERM during restart backoff cannot launch another agent', async (t) => {
  const f = fixture(t);
  await f.listen();
  const run = f.start({ FAKE_CODES: '75,0' });
  await until(
    () => f.events().some(({ event, duration }) => event === 'sleep' && duration === '1'),
    'restart backoff',
  );
  f.signalOwned(run.child.pid, 'SIGTERM');
  await run.exited();
  assert.equal(f.agents().length, 1, 'entry restarted the agent after receiving SIGTERM');
});

test('FAKE commands: SIGTERM while waiting for the Unix socket exits without an agent', async (t) => {
  const f = fixture(t);
  const run = f.start();
  await until(() => f.events().some(({ event }) => event === 'sleep'), 'socket readiness probe');
  f.signalOwned(run.child.pid, 'SIGTERM');
  assert.equal((await run.exited()).code, 143);
  assert.deepEqual(f.agents(), []);
  assert.deepEqual([...f.ownedPids()].filter(running), []);
});

test('FAKE commands: a failed egress bridge cannot launch an agent', async (t) => {
  const f = fixture(t);
  await f.listen();
  const result = await f
    .start({
      CAIRN_ORB_EGRESS_SOCKET: join(f.root, 'egress.sock'),
      FAKE_BRIDGE_FAIL: '1',
    })
    .exited();
  assert.equal(result.code, 1, result.stderr);
  assert.match(result.stderr, /Computer egress bridge failed/);
  assert.deepEqual(f.agents(), []);
});

test('FAKE commands: an unrelated listener cannot mask a failed egress bridge', async (t) => {
  const f = fixture(t);
  await f.listen();
  const result = await f
    .start({
      CAIRN_ORB_EGRESS_SOCKET: join(f.root, 'egress.sock'),
      FAKE_BRIDGE_FAIL: '1',
      FAKE_OTHER_LISTENER: '1',
    })
    .exited();
  assert.equal(result.code, 1, result.stderr);
  assert.deepEqual(f.agents(), []);
});

test('FAKE commands: a healthy local bridge uses fixed loopback proxy argv and environment', async (t) => {
  const f = fixture(t);
  await f.listen();
  const egress = join(f.root, 'egress.sock');
  const result = await f.start({ CAIRN_ORB_EGRESS_SOCKET: egress }).exited();
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(f.events().find(({ kind }) => kind === 'socat').args, [
    'TCP-LISTEN:7890,bind=127.0.0.1,fork,reuseaddr',
    `UNIX-CONNECT:${egress}`,
  ]);
  assert.deepEqual(f.agents()[0].proxies, {
    HTTP_PROXY: 'http://127.0.0.1:7890',
    HTTPS_PROXY: 'http://127.0.0.1:7890',
    http_proxy: 'http://127.0.0.1:7890',
    https_proxy: 'http://127.0.0.1:7890',
    NO_PROXY: 'localhost,127.0.0.1,::1',
    no_proxy: 'localhost,127.0.0.1,::1',
  });
});
