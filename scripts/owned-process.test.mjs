import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  ownedScopeAvailable,
  ownerChain,
  parsePsInfo,
  processInfo,
  spawnOwned,
} from './owned-process.mjs';
import { makeTestTempDir } from './test-tmpdir.mjs';

const CLI = join(import.meta.dirname, 'owned-process.mjs');
const scopeAvailable = ownedScopeAvailable();
const modes = scopeAvailable ? ['scope', 'group'] : ['group'];

function token() {
  return `86${randomInt(100000, 999999)}.${randomInt(1, 9)}`;
}

function pidsRunning(marker) {
  const ps = spawnSync('ps', ['-axo', 'pid=,args='], { encoding: 'utf8' });
  return ps.stdout
    .split('\n')
    .filter((line) => new RegExp(`^\\s*\\d+ sleep ${marker.replace('.', '\\.')}$`).test(line))
    .map((line) => Number.parseInt(line, 10));
}

async function waitFor(predicate, ms = 15_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(100);
  }
  return predicate();
}

function started(t, child) {
  t.after(() => child.kill('SIGKILL'));
  return child;
}

function modeEnv(mode) {
  return { ...process.env, CAIRN_OWNED_MODE: mode === 'group' ? 'group' : '' };
}

function treeScript(marker) {
  return `setsid sleep ${marker} & sleep ${marker} & wait`;
}

for (const mode of modes) {
  test(`${mode}: the whole tree dies when the owner is SIGKILLed`, async (t) => {
    const marker = token();
    const owner = started(
      t,
      spawn(
        'bash',
        [
          '-c',
          `node ${JSON.stringify(CLI)} -- bash -c ${JSON.stringify(treeScript(marker))}; true`,
        ],
        { env: modeEnv(mode), stdio: 'ignore' },
      ),
    );
    assert.ok(await waitFor(() => pidsRunning(marker).length === 2), 'tree started');
    owner.kill('SIGKILL');
    assert.ok(await waitFor(() => pidsRunning(marker).length === 0), 'tree reaped');
  });

  test(`${mode}: the whole tree dies when the helper itself is SIGKILLed`, async (t) => {
    const marker = token();
    const helper = started(
      t,
      spawn('node', [CLI, '--', 'bash', '-c', treeScript(marker)], {
        env: modeEnv(mode),
        stdio: 'ignore',
      }),
    );
    assert.ok(await waitFor(() => pidsRunning(marker).length === 2), 'tree started');
    helper.kill('SIGKILL');
    assert.ok(await waitFor(() => pidsRunning(marker).length === 0), 'tree reaped');
  });

  test(`${mode}: a detached grandchild dies when the main child exits`, async () => {
    const marker = token();
    const result = spawnSync(
      'node',
      [CLI, '--', 'bash', '-c', `setsid sleep ${marker} & sleep 0.5; exit 3`],
      { env: modeEnv(mode), stdio: 'ignore' },
    );
    assert.equal(result.status, 3);
    assert.ok(await waitFor(() => pidsRunning(marker).length === 0), 'grandchild reaped');
  });

  test(`${mode}: SIGTERM to the helper stops the tree and exits 143`, async (t) => {
    const marker = token();
    const helper = started(
      t,
      spawn('node', [CLI, '--', 'bash', '-c', treeScript(marker)], {
        env: modeEnv(mode),
        stdio: 'ignore',
      }),
    );
    assert.ok(await waitFor(() => pidsRunning(marker).length === 2), 'tree started');
    const exit = new Promise((resolveExit) => helper.once('exit', (code) => resolveExit(code)));
    helper.kill('SIGTERM');
    assert.equal(await exit, 143);
    assert.equal(pidsRunning(marker).length, 0);
  });

  test(`${mode}: --timeout-ms stops the tree and exits 124`, async () => {
    const marker = token();
    const result = spawnSync(
      'node',
      [CLI, '--timeout-ms', '800', '--', 'bash', '-c', treeScript(marker)],
      { env: modeEnv(mode), stdio: 'ignore' },
    );
    assert.equal(result.status, 124);
    assert.equal(pidsRunning(marker).length, 0);
  });
}

test('the exit code and output of the command pass through', () => {
  const result = spawnSync('node', [CLI, '--', 'bash', '-c', 'echo hello; exit 7'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 7);
  assert.equal(result.stdout, 'hello\n');
});

test('a command that cannot start exits 127', () => {
  const result = spawnSync('node', [CLI, '--', '/nonexistent/owned-process-probe'], {
    encoding: 'utf8',
    env: { ...process.env, CAIRN_OWNED_MODE: 'group' },
  });
  assert.equal(result.status, 127);
});

test('usage errors exit 2', () => {
  assert.equal(spawnSync('node', [CLI], { stdio: 'ignore' }).status, 2);
  assert.equal(
    spawnSync('node', [CLI, '--owner', 'nobody', '--', 'true'], { stdio: 'ignore' }).status,
    2,
  );
});

test('scope mode runs the command inside its own transient scope with a runtime ceiling', {
  skip: !scopeAvailable,
}, async (t) => {
  const marker = token();
  const helper = started(
    t,
    spawn('node', [CLI, '--name', 'probe', '--', 'sleep', marker], { stdio: 'ignore' }),
  );
  assert.ok(await waitFor(() => pidsRunning(marker).length === 1), 'child started');
  const [pid] = pidsRunning(marker);
  const cgroup = readFileSync(`/proc/${pid}/cgroup`, 'utf8');
  const unit = /\/(cairn-owned-probe-[^/]+)\.scope$/m.exec(cgroup)?.[1];
  assert.ok(unit, cgroup);
  const ceiling = spawnSync(
    'systemctl',
    ['--user', 'show', '-p', 'RuntimeMaxUSec', '--value', `${unit}.scope`],
    {
      encoding: 'utf8',
    },
  ).stdout.trim();
  assert.equal(ceiling, '12h');
  helper.kill('SIGKILL');
  assert.ok(await waitFor(() => pidsRunning(marker).length === 0), 'child reaped');
});

for (const mode of modes) {
  test(`${mode}: the child ends at the runtime ceiling`, () => {
    const marker = token();
    const result = spawnSync('node', [CLI, '--max-runtime-sec', '1', '--', 'sleep', marker], {
      env: modeEnv(mode),
      stdio: 'ignore',
      timeout: 30_000,
    });
    assert.notEqual(result.status, 0);
    assert.equal(pidsRunning(marker).length, 0);
  });
}

test('the parent owner chain is every ancestor up to the subreaper', () => {
  const table = {
    40: { pid: 40, ppid: 30, start: 'd', comm: 'node' },
    30: { pid: 30, ppid: 20, start: 'c', comm: 'bash' },
    20: { pid: 20, ppid: 10, start: 'b', comm: 'claude' },
    10: { pid: 10, ppid: 1, start: 'a', comm: 'systemd' },
  };
  const info = (pid) => table[pid] ?? null;
  assert.deepEqual(
    ownerChain(40, 'parent', info).map((link) => link.pid),
    [30, 20, 10],
  );
  assert.deepEqual(
    ownerChain(40, 'session', info).map((link) => link.pid),
    [20, 10],
  );
  assert.deepEqual(
    ownerChain(30, 'session', (pid) => (pid === 20 ? { ...table[20], comm: 'zsh' } : info(pid))),
    [],
  );
});

test('parsePsInfo reads the macOS ps line, trailing newline included', () => {
  assert.deepEqual(
    parsePsInfo(
      25667,
      '25381 Sat Nov 14 18:20:54 2026     /Users/me/.local/share/fnm/node-versions/v24.14.0/installation/bin/node\n',
    ),
    { pid: 25667, ppid: 25381, start: 'Sat Nov 14 18:20:54 2026', comm: 'node' },
  );
  assert.deepEqual(parsePsInfo(7, '    1 Mon Nov  3 09:05:01 2026     /sbin/launchd\n'), {
    pid: 7,
    ppid: 1,
    start: 'Mon Nov  3 09:05:01 2026',
    comm: 'launchd',
  });
  assert.equal(parsePsInfo(7, ''), null);
});

test('processInfo reads this process', () => {
  const me = processInfo(process.pid);
  assert.equal(me.ppid, process.ppid);
  assert.equal(typeof me.start, 'string');
  assert.equal(processInfo(2 ** 22 + 7), null);
});

test('owner ancestry includes a container init for direct children and descendants', () => {
  const table = {
    1: { pid: 1, ppid: 0, start: 'init', comm: 'node' },
    20: { pid: 20, ppid: 1, start: 'child', comm: 'node' },
    30: { pid: 30, ppid: 20, start: 'worker', comm: 'node' },
  };
  const info = (pid) => table[pid] ?? null;
  assert.deepEqual(
    ownerChain(20, 'parent', info).map((entry) => entry.pid),
    [1],
  );
  assert.deepEqual(
    ownerChain(30, 'parent', info).map((entry) => entry.pid),
    [20, 1],
  );
  assert.deepEqual(ownerChain(1, 'parent', info), []);
});

test('the command sees exactly the environment it was given', async () => {
  const owned = spawnOwned('env', [], {
    env: { PATH: process.env.PATH, ONLY: '1' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let out = '';
  owned.child.stdout.on('data', (chunk) => {
    out += chunk;
  });
  assert.equal((await owned.exited).code, 0);
  const keys = out
    .trim()
    .split('\n')
    .map((line) => line.split('=')[0])
    .sort();
  assert.deepEqual(keys, ['CAIRN_OWNER_ID', 'ONLY', 'PATH']);
});

test('no cairn-owned scope outlives a run, even when its command exits at once', {
  skip: !scopeAvailable,
}, async () => {
  const owned = spawnOwned('true', [], { name: 'instant', stdio: 'ignore' });
  assert.equal((await owned.exited).code, 0);
  const state = spawnSync('systemctl', ['--user', 'is-active', `${owned.unit}.scope`], {
    encoding: 'utf8',
  }).stdout.trim();
  assert.notEqual(state, 'active');
});

for (const mode of modes) {
  test(`${mode}: a nested owned tree whose grandchild ignores SIGTERM dies with the outer owner`, async (t) => {
    const marker = token();
    const stubborn = `trap '' TERM; setsid sleep ${marker} & sleep ${marker} & wait`;
    const outer = started(
      t,
      spawn('node', [CLI, '--', 'node', CLI, '--', 'bash', '-c', stubborn], {
        env: modeEnv(mode),
        stdio: 'ignore',
      }),
    );
    assert.ok(await waitFor(() => pidsRunning(marker).length === 2), 'nested tree started');
    outer.kill('SIGTERM');
    assert.ok(await waitFor(() => pidsRunning(marker).length === 0, 30_000), 'nested tree reaped');
  });
}

test('a detached session job stays bound to the session when the helper starts slowly', {
  skip: process.platform !== 'linux',
}, async (t) => {
  const dir = makeTestTempDir('owned-session-');
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const realRun =
    spawnSync('bash', ['-c', 'command -v systemd-run'], { encoding: 'utf8' }).stdout.trim() ||
    '/nonexistent';
  writeFileSync(join(bin, 'systemd-run'), `#!/bin/sh\nsleep 2\nexec ${realRun} "$@"\n`);
  chmodSync(join(bin, 'systemd-run'), 0o755);
  const marker = token();
  const dispatcher = join(dir, 'dispatch.mjs');
  writeFileSync(
    dispatcher,
    `import { launchOwnedDetached } from ${JSON.stringify(join(import.meta.dirname, 'owned-process.mjs'))};\nlaunchOwnedDetached('sleep', [${JSON.stringify(marker)}]);\n`,
  );
  writeFileSync(
    join(bin, 'claude'),
    `#!/bin/sh\n${JSON.stringify(process.execPath)} ${JSON.stringify(dispatcher)}\nsleep 600\n`,
  );
  chmodSync(join(bin, 'claude'), 0o755);
  const session = started(
    t,
    spawn(join(bin, 'claude'), [], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      stdio: 'ignore',
    }),
  );
  assert.ok(
    await waitFor(() => pidsRunning(marker).length === 1),
    'job started after the dispatcher exited',
  );
  session.kill('SIGKILL');
  assert.ok(await waitFor(() => pidsRunning(marker).length === 0), 'job died with its session');
});
