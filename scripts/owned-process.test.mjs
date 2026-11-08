import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { ownerChain, processInfo, spawnOwned } from './owned-process.mjs';

const CLI = join(import.meta.dirname, 'owned-process.mjs');
const scopeAvailable =
  process.platform === 'linux' &&
  spawnSync(
    'systemd-run',
    ['--user', '--scope', '--quiet', '--collect', '--expand-environment=no', 'true'],
    {
      stdio: 'ignore',
    },
  ).status === 0;
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

test('scope mode ends the child at the runtime ceiling', { skip: !scopeAvailable }, async () => {
  const marker = token();
  const result = spawnSync('node', [CLI, '--max-runtime-sec', '1', '--', 'sleep', marker], {
    stdio: 'ignore',
  });
  assert.notEqual(result.status, 0);
  assert.equal(pidsRunning(marker).length, 0);
});

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

test('processInfo reads this process', () => {
  const me = processInfo(process.pid);
  assert.equal(me.ppid, process.ppid);
  assert.equal(typeof me.start, 'string');
  assert.equal(processInfo(2 ** 22 + 7), null);
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
