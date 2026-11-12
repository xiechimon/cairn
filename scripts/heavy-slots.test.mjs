import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import {
  foreignPortHolderReport,
  probeAnswers,
  skipsQueue,
  slotCount,
  slotLockDir,
  slotPortHolder,
  slotResources,
} from './heavy-slots.mjs';
import { prepushModules } from './prepush.mjs';
import { scrubGateEnv } from './scrub-git-env.mjs';

const moduleUrl = pathToFileURL(resolve('scripts/heavy-slots.mjs')).href;
const cli = resolve('scripts/heavy-slots.mjs');
const children = new Set();

test.afterEach(() => {
  for (const child of children) child.kill('SIGKILL');
  children.clear();
});

function sandbox(slots) {
  const dir = mkdtempSync(join(tmpdir(), 'heavy-slots-test-'));
  const env = {
    ...scrubGateEnv(),
    CAIRN_OWNED_MODE: 'group',
    CAIRN_HEAVY_SLOTS: String(slots),
    CAIRN_HEAVY_SLOTS_DIR: join(dir, 'locks'),
    TMPDIR: join(dir, 'tmp'),
  };
  mkdirSync(env.TMPDIR, { recursive: true });
  delete env.CI;
  delete env.CAIRN_HEAVY_SLOT;
  delete env.CAIRN_HEAVY_SLOT_OWNER;
  delete env.E2E_PORT;
  return { dir, env, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function watch(command, args, options) {
  const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  const watched = {
    child,
    out: '',
    err: '',
    closed: false,
    exited: new Promise((done) =>
      child.on('close', (code) => {
        watched.closed = true;
        done(code);
      }),
    ),
  };
  child.stdout.on('data', (chunk) => {
    watched.out += chunk;
  });
  child.stderr.on('data', (chunk) => {
    watched.err += chunk;
  });
  return watched;
}

async function until(watched, stream, pattern, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (!pattern.test(watched[stream])) {
    if (watched.closed || Date.now() > deadline)
      assert.fail(
        `${pattern} never appeared on ${stream} (exit ${watched.child.exitCode}, signal ${watched.child.signalCode}): ${watched.out}${watched.err}`,
      );
    await sleep(20);
  }
}

const startSquatter = (env, cwd) =>
  watch(
    process.execPath,
    [
      '-e',
      `require('node:net')
        .createServer(() => {})
        .listen(0, '127.0.0.1', function () { console.log('SQUATTER-READY ' + this.address().port); })
        .on('error', (error) => {
          console.log('SQUATTER-ERROR ' + error.code);
          process.exit(3);
        });
      setInterval(() => {}, 1000);`,
    ],
    { env, cwd },
  );

const startHolder = (env, { wait = true, lingerMs = 60_000 } = {}) =>
  watch(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { acquireSlot } from ${JSON.stringify(moduleUrl)};
if (process.env.START_GATE) console.log('READY');
while (process.env.START_GATE && !existsSync(process.env.START_GATE)) await sleep(20);
const lease = await acquireSlot({ env: process.env, wait: ${wait} });
console.log(lease ? 'SLOT ' + lease.slot : 'NONE');
while (process.env.START_GATE && !existsSync(process.env.START_GATE + '.release')) await sleep(20);
setTimeout(() => process.exit(0), ${lingerMs});
`,
    ],
    { env },
  );

test('an overridden TMPDIR on macOS does not move the shared lock directory', () => {
  const failed = () => ({ status: 71, stdout: '' });
  assert.equal(
    slotLockDir({ TMPDIR: '/private/tmp/sandbox-override' }, 'darwin', () => ({
      status: 0,
      stdout: '/var/folders/ab/T/\n',
    })),
    '/var/folders/ab/T/cairn-heavy-slots',
  );
  assert.throws(
    () => slotLockDir({ TMPDIR: '/private/tmp/sandbox-override' }, 'darwin', failed),
    /set CAIRN_HEAVY_SLOTS_DIR/,
  );
  assert.equal(slotLockDir({}, 'darwin', failed), join(tmpdir(), 'cairn-heavy-slots'));
  assert.equal(
    slotLockDir({ TMPDIR: '/x', CAIRN_HEAVY_SLOTS_DIR: '/locks' }, 'darwin', failed),
    '/locks',
  );
  assert.equal(slotLockDir({ TMPDIR: '/x' }, 'linux'), join(tmpdir(), 'cairn-heavy-slots'));
});

test('slot count defaults to 2 and falls back to 1 with a warning for bad values', () => {
  assert.deepEqual(slotCount({}), { count: 2 });
  assert.deepEqual(slotCount({ CAIRN_HEAVY_SLOTS: '' }), { count: 2 });
  assert.deepEqual(slotCount({ CAIRN_HEAVY_SLOTS: '3' }), { count: 3 });
  for (const bad of ['0', 'abc', '-2', '2.5', 'NaN']) {
    const { count, warning } = slotCount({ CAIRN_HEAVY_SLOTS: bad });
    assert.equal(count, 1, bad);
    assert.match(warning, /CAIRN_HEAVY_SLOTS/, bad);
  }
});

test('CI skips only when its slot directory is absent', () => {
  const { dir, cleanup } = sandbox(1);
  try {
    assert.equal(skipsQueue({ CI: 'true', CAIRN_HEAVY_SLOTS_DIR: dir }), false);
    assert.equal(skipsQueue({ CI: 'true', CAIRN_HEAVY_SLOTS_DIR: join(dir, 'absent') }), true);
  } finally {
    cleanup();
  }
  assert.equal(
    skipsQueue({ CI: 'true', CAIRN_HEAVY_SLOTS_DIR: '/does-not-exist-heavy-slots' }),
    true,
  );
  assert.equal(skipsQueue({ CI: '1', CAIRN_HEAVY_SLOTS_DIR: '/does-not-exist-heavy-slots' }), true);
  assert.equal(skipsQueue({}), false);
  assert.equal(skipsQueue({ CI: '' }), false);
  assert.equal(skipsQueue({ CI: 'false' }), false);
  assert.equal(skipsQueue({ CI: '0' }), false);
});

test('each slot owns its own e2e port and build directory', () => {
  const one = slotResources(1, {});
  const two = slotResources(2, {});
  assert.equal(one.port, 8398);
  assert.notEqual(one.port, two.port);
  assert.notEqual(one.distDir, two.distDir);
  assert.match(one.distDir, /cairn-heavy-slot-1/);
  assert.equal(slotResources(2, { E2E_AFFECTED_PORT: '9000' }).port, 9000 + (two.port - one.port));
  assert.equal(slotResources(1, { E2E_PORT: '7777', E2E_AFFECTED_PORT: '9000' }).port, 7777);
  assert.equal(slotResources(2, { E2E_PORT: '7777' }).port, 7777 + (two.port - one.port));
});

test('slotPortHolder names the pid, cwd and command of whatever listens on the port', async () => {
  const { dir, env, cleanup } = sandbox(1);
  try {
    mkdirSync(join(dir, 'squatter'));
    const squatterCwd = realpathSync(join(dir, 'squatter'));
    const squatter = startSquatter(env, squatterCwd);
    await until(squatter, 'out', /SQUATTER-READY/);
    env.E2E_AFFECTED_PORT = squatter.out.match(/SQUATTER-READY (\d+)/)[1];
    const holder = slotPortHolder(Number(env.E2E_AFFECTED_PORT));
    assert.equal(holder.pid, squatter.child.pid);
    assert.equal(holder.cwd, squatterCwd);
    assert.match(holder.command, /node/);
  } finally {
    cleanup();
  }
});

test('foreignPortHolderReport accepts a free port and a holder from the same checkout', () => {
  const toplevel = '/repo/.claude/worktrees/mine';
  assert.equal(foreignPortHolderReport({ port: 8399, toplevel, holderOf: () => null }), null);
  assert.equal(
    foreignPortHolderReport({
      port: 8399,
      toplevel,
      holderOf: () => ({ pid: 7, cwd: `${toplevel}/apps/web`, command: 'node vite preview' }),
      toplevelOf: () => toplevel,
    }),
    null,
  );
});

test('foreignPortHolderReport names the pid, cwd and command of a holder from another checkout', () => {
  const report = foreignPortHolderReport({
    port: 8398,
    toplevel: '/repo/.claude/worktrees/mine',
    holderOf: () => ({
      pid: 4242,
      cwd: '/repo/.claude/worktrees/nice-faraday-984028/apps/web',
      command: 'node vite preview --port 8398',
    }),
    toplevelOf: () => '/repo/.claude/worktrees/nice-faraday-984028',
  });
  assert.match(report, /port 8398/);
  assert.match(report, /pid 4242/);
  assert.match(report, /cwd \/repo\/\.claude\/worktrees\/nice-faraday-984028\/apps\/web/);
  assert.match(report, /command node vite preview --port 8398/);
});

test('foreignPortHolderReport rejects a holder whose checkout cannot be resolved', () => {
  const unknownCwd = foreignPortHolderReport({
    port: 8399,
    toplevel: '/repo',
    holderOf: () => ({ pid: 9, cwd: undefined, command: undefined }),
  });
  assert.match(unknownCwd, /pid 9, cwd unknown/);
  const outsideGit = foreignPortHolderReport({
    port: 8399,
    toplevel: '/repo',
    holderOf: () => ({ pid: 9, cwd: '/tmp', command: 'python3 -m http.server' }),
    toplevelOf: () => undefined,
  });
  assert.match(outsideGit, /not a git checkout/);
  const neitherInGit = foreignPortHolderReport({
    port: 8399,
    toplevel: undefined,
    holderOf: () => ({ pid: 9, cwd: '/tmp', command: 'python3 -m http.server' }),
    toplevelOf: () => undefined,
  });
  assert.match(neitherInGit, /not a git checkout/);
});

test('a bad slot count gets a warning and a single slot', async () => {
  const { env, cleanup } = sandbox('abc');
  try {
    const holder = startHolder(env);
    await until(holder, 'out', /SLOT 1/);
    assert.match(holder.err, /CAIRN_HEAVY_SLOTS.*positive integer/);
    const second = startHolder(env);
    await until(second, 'err', /queued, position 1/);
    assert.doesNotMatch(second.out, /SLOT/);
  } finally {
    cleanup();
  }
});

test('waiters see their queue position and are served first-come first-served', async () => {
  const { env, cleanup } = sandbox(1);
  try {
    const holder = startHolder(env);
    await until(holder, 'out', /SLOT 1/);
    const first = startHolder(env);
    await until(first, 'err', /queued, position 1/);
    const second = startHolder(env);
    await until(second, 'err', /queued, position 2/);
    holder.child.kill('SIGKILL');
    await until(first, 'out', /SLOT 1/, 5_000);
    assert.doesNotMatch(second.out, /SLOT/);
    await until(second, 'err', /queued, position 2[\s\S]*queued, position 1/);
  } finally {
    cleanup();
  }
});

test('kill -9 on the holder frees the slot for the queued process within 5 seconds', async () => {
  const { env, cleanup } = sandbox(1);
  try {
    const holder = startHolder(env);
    await until(holder, 'out', /SLOT 1/);
    const waiter = startHolder(env);
    await until(waiter, 'err', /queued, position/);
    const killedAt = Date.now();
    holder.child.kill('SIGKILL');
    await until(waiter, 'out', /SLOT 1/, 5_000);
    assert.ok(Date.now() - killedAt < 5_000);
  } finally {
    cleanup();
  }
});

test('a clean exit releases the slot too', async () => {
  const { env, cleanup } = sandbox(1);
  try {
    const holder = startHolder(env, { lingerMs: 200 });
    await until(holder, 'out', /SLOT 1/);
    const waiter = startHolder(env);
    await until(waiter, 'out', /SLOT 1/, 5_000);
  } finally {
    cleanup();
  }
});

test('simultaneous grabs for the last slot: exactly one wins, every round', async () => {
  const { dir, env, cleanup } = sandbox(1);
  try {
    for (let round = 0; round < 6; round++) {
      const gate = join(dir, `go-${round}`);
      const roundEnv = {
        ...env,
        CAIRN_HEAVY_SLOTS_DIR: join(dir, `locks-${round}`),
        START_GATE: gate,
      };
      const racers = Array.from({ length: 8 }, () =>
        startHolder(roundEnv, { wait: false, lingerMs: 0 }),
      );
      await Promise.all(racers.map((racer) => until(racer, 'out', /READY/)));
      writeFileSync(gate, '');
      await Promise.all(racers.map((racer) => until(racer, 'out', /SLOT 1|NONE/)));
      writeFileSync(`${gate}.release`, '');
      assert.deepEqual(await Promise.all(racers.map((racer) => racer.exited)), Array(8).fill(0));
      const winners = racers.filter((racer) => /SLOT 1/.test(racer.out));
      const losers = racers.filter((racer) => /NONE/.test(racer.out));
      assert.equal(winners.length, 1, `round ${round}: ${racers.map((r) => r.out).join('|')}`);
      assert.equal(losers.length, 7, `round ${round}`);
    }
  } finally {
    cleanup();
  }
});

test('simultaneous reclaim of one dead holder: exactly one process inherits the slot', async () => {
  const { dir, env, cleanup } = sandbox(1);
  try {
    for (let round = 0; round < 6; round++) {
      const locks = join(dir, `locks-${round}`);
      const gate = join(dir, `go-${round}`);
      mkdirSync(locks, { recursive: true });
      const roundEnv = { ...env, CAIRN_HEAVY_SLOTS_DIR: locks, START_GATE: gate };
      const dead = spawnSync(
        process.execPath,
        [
          '-e',
          'process.stdout.write(JSON.stringify({pid: process.pid, slots: process.env.CAIRN_HEAVY_SLOTS_DIR}))',
        ],
        {
          encoding: 'utf8',
          env: roundEnv,
        },
      ).stdout;
      const probe = JSON.parse(dead);
      assert.equal(probe.slots, locks);
      writeFileSync(join(locks, 'slot-1.lock'), JSON.stringify({ pid: probe.pid }));
      const racers = Array.from({ length: 8 }, () =>
        startHolder(roundEnv, { wait: false, lingerMs: 0 }),
      );
      await Promise.all(racers.map((racer) => until(racer, 'out', /READY/)));
      writeFileSync(gate, '');
      await Promise.all(racers.map((racer) => until(racer, 'out', /SLOT 1|NONE/)));
      writeFileSync(`${gate}.release`, '');
      assert.deepEqual(await Promise.all(racers.map((racer) => racer.exited)), Array(8).fill(0));
      const winners = racers.filter((racer) => /SLOT 1/.test(racer.out));
      assert.equal(
        winners.length,
        1,
        `round ${round}: ${racers.map((r) => r.out + r.err).join('|')}`,
      );
    }
  } finally {
    cleanup();
  }
});

test('two killed holders and several waiters: stale entries are reclaimed without double grants', async () => {
  const { env, cleanup } = sandbox(2);
  try {
    const holders = [startHolder(env), startHolder(env)];
    await Promise.all(holders.map((holder) => until(holder, 'out', /SLOT \d/)));
    const waiters = Array.from({ length: 4 }, () => startHolder(env, { lingerMs: 1_500 }));
    await Promise.all(waiters.map((waiter) => until(waiter, 'err', /queued, position/)));
    for (const holder of holders) holder.child.kill('SIGKILL');
    await Promise.all(waiters.map((waiter) => until(waiter, 'out', /SLOT \d/, 15_000)));
    const early = waiters.map((waiter) => waiter.out.match(/SLOT (\d)/)[1]);
    assert.equal(new Set(early).size, 2, `only two slots exist, saw ${early}`);
  } finally {
    cleanup();
  }
});

const UNTIL_REFUSED = `
  const { createConnection } = require('node:net');
  const attempt = () => {
    const connection = createConnection(process.argv[1]);
    connection.once('connect', () => {
      connection.destroy();
      setTimeout(attempt, 5);
    });
    connection.once('error', () => process.exit(0));
  };
  attempt();
`;

test('a probe whose listener closes before accepting it reads as gone', {
  skip: process.platform !== 'linux',
}, async () => {
  const { dir, cleanup } = sandbox(1);
  try {
    const probe = join(dir, 'probe.sock');
    const listener = watch(process.execPath, [
      '-e',
      `require('node:net').createServer().listen(${JSON.stringify(probe)}, () => {
          process.stdout.write('READY');
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
        });`,
    ]);
    await until(listener, 'out', /READY/);
    const answer = probeAnswers(probe);
    listener.child.kill('SIGKILL');
    execFileSync(process.execPath, ['-e', UNTIL_REFUSED, probe]);
    assert.equal(await answer, false);
  } finally {
    cleanup();
  }
});

test('run wrapper: with 2 slots and 4 jobs at most 2 run at once and all pass', async () => {
  const { dir, env, cleanup } = sandbox(2);
  try {
    const events = join(dir, 'events.log');
    const job = `
      const { appendFileSync } = require('node:fs');
      appendFileSync(${JSON.stringify(events)}, 'start ' + process.env.CAIRN_HEAVY_SLOT + '\\n');
      setTimeout(() => {
        appendFileSync(${JSON.stringify(events)}, 'end ' + process.env.CAIRN_HEAVY_SLOT + '\\n');
      }, 700);
    `;
    const jobs = Array.from({ length: 4 }, () =>
      watch(process.execPath, [cli, 'run', '--', process.execPath, '-e', job], { env }),
    );
    const codes = await Promise.all(jobs.map((j) => j.exited));
    assert.deepEqual(codes, [0, 0, 0, 0], jobs.map((j) => j.out + j.err).join('|'));
    const active = new Set();
    let peak = 0;
    for (const line of readFileSync(events, 'utf8').trim().split('\n')) {
      const [kind, slot] = line.split(' ');
      if (kind === 'start') {
        assert.ok(!active.has(slot), `slot ${slot} handed to two jobs at once`);
        active.add(slot);
      } else active.delete(slot);
      peak = Math.max(peak, active.size);
    }
    assert.equal(peak, 2);
    assert.ok(jobs.filter((j) => /queued, position/.test(j.err)).length >= 2);
  } finally {
    cleanup();
  }
});

test('a run wrapper inside a holder reuses its slot instead of queueing behind itself', () => {
  const { env, cleanup } = sandbox(1);
  try {
    const result = spawnSync(
      process.execPath,
      [
        cli,
        'run',
        '--',
        process.execPath,
        cli,
        'run',
        '--',
        process.execPath,
        '-e',
        'console.log("inner")',
      ],
      { env, encoding: 'utf8', timeout: 10_000 },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /inner/);
  } finally {
    cleanup();
  }
});

test('an inherited slot variable that no live process holds is ignored', () => {
  const { env, cleanup } = sandbox(1);
  try {
    const result = spawnSync(
      process.execPath,
      [
        cli,
        'run',
        '--',
        process.execPath,
        '-e',
        'console.log("slot=" + process.env.CAIRN_HEAVY_SLOT)',
      ],
      { env: { ...env, CAIRN_HEAVY_SLOT: '1' }, encoding: 'utf8', timeout: 10_000 },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /slot=1/);
    assert.doesNotMatch(result.stderr, /queued, position/);
  } finally {
    cleanup();
  }
});

test('an inherited slot whose lock belongs to someone else is not reused', async () => {
  const { env, cleanup } = sandbox(1);
  try {
    const holder = startHolder(env);
    await until(holder, 'out', /SLOT 1/);
    const borrower = watch(
      process.execPath,
      [cli, 'run', '--', process.execPath, '-e', 'console.log("ran")'],
      { env: { ...env, CAIRN_HEAVY_SLOT: '1', CAIRN_HEAVY_SLOT_OWNER: String(process.pid) } },
    );
    await until(borrower, 'err', /queued, position 1/);
    assert.doesNotMatch(borrower.out, /ran/);
  } finally {
    cleanup();
  }
});

test('run wrapper passes the exit code through and frees the slot', async () => {
  const { env, cleanup } = sandbox(1);
  try {
    const failing = spawnSync(
      process.execPath,
      [cli, 'run', '--', process.execPath, '-e', 'process.exit(7)'],
      {
        env,
        encoding: 'utf8',
      },
    );
    assert.equal(failing.status, 7);
    const next = startHolder(env);
    await until(next, 'out', /SLOT 1/, 5_000);
  } finally {
    cleanup();
  }
});

test('e2e:affected queues for a slot, but a dry run never waits', async () => {
  const { env, cleanup } = sandbox(1);
  try {
    const holder = startHolder(env);
    await until(holder, 'out', /SLOT 1/);
    const spec = 'apps/web/e2e/dialog-viewport.spec.ts';
    const dry = spawnSync(process.execPath, ['scripts/e2e-affected.mjs', '--dry-run', spec], {
      env,
      encoding: 'utf8',
      timeout: 20_000,
    });
    assert.equal(dry.status, 0, dry.stderr);
    const queued = watch(process.execPath, ['scripts/e2e-affected.mjs', spec], { env });
    await until(queued, 'err', /queued, position 1/);
    assert.doesNotMatch(queued.out + queued.err, /Running \d+ test/);
  } finally {
    cleanup();
  }
});

test('local prepush starts fast checks even when every heavy slot is occupied', async () => {
  const { dir, env, cleanup } = sandbox(1);
  const repo = join(dir, 'repo');
  mkdirSync(join(repo, 'scripts'), { recursive: true });
  const git = (...args) =>
    execFileSync(
      'git',
      ['-c', 'user.name=heavy-slots-test', '-c', 'user.email=heavy@example.invalid', ...args],
      { cwd: repo, stdio: 'pipe' },
    );
  try {
    for (const file of prepushModules) copyFileSync(file, join(repo, file));
    git('init');
    writeFileSync(join(repo, 'README.md'), 'first\n');
    git('add', 'README.md');
    git('commit', '-m', 'initial');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    writeFileSync(join(repo, 'new.ts'), 'export const probe = 1;\n');
    const holder = startHolder(env);
    await until(holder, 'out', /SLOT 1/);
    const prepushEnv = { ...env, PREPUSH_BASE_SHA: 'origin/main' };
    const prepush = watch(process.execPath, ['scripts/prepush.mjs'], {
      cwd: repo,
      env: prepushEnv,
    });
    await until(prepush, 'out', /\[prepush\] node scripts\/ui-debt-gate\.mjs/, 5_000);
    await prepush.exited;
    assert.doesNotMatch(prepush.err, /queued, position|acquired slot/);
    assert.equal(
      JSON.parse(readFileSync(join(env.CAIRN_HEAVY_SLOTS_DIR, 'slot-1.lock'), 'utf8')).pid,
      holder.child.pid,
    );
    appendFileSync(join(repo, 'README.md'), '');
    const ci = spawnSync(process.execPath, ['scripts/prepush.mjs'], {
      cwd: repo,
      env: { ...prepushEnv, CI: 'true' },
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.match(ci.stdout, /\[prepush\] node scripts\/ui-debt-gate\.mjs/);
    assert.equal(existsSync(join(repo, 'scripts/heavy-slots.mjs')), true);
  } finally {
    cleanup();
  }
});

test('local prepush ignores a squatted slot port because fast checks do not bind it', async () => {
  const { dir, env, cleanup } = sandbox(1);
  const repo = join(dir, 'repo');
  mkdirSync(join(repo, 'scripts'), { recursive: true });
  const git = (...args) =>
    execFileSync(
      'git',
      ['-c', 'user.name=heavy-slots-test', '-c', 'user.email=heavy@example.invalid', ...args],
      { cwd: repo, stdio: 'pipe' },
    );
  try {
    for (const file of prepushModules) copyFileSync(file, join(repo, file));
    git('init');
    writeFileSync(join(repo, 'README.md'), 'first\n');
    git('add', 'README.md');
    git('commit', '-m', 'initial');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    writeFileSync(join(repo, 'new.ts'), 'export const probe = 1;\n');
    mkdirSync(join(dir, 'squatter'));
    const squatterCwd = realpathSync(join(dir, 'squatter'));
    const squatter = startSquatter(env, squatterCwd);
    await until(squatter, 'out', /SQUATTER-READY/);
    env.E2E_AFFECTED_PORT = squatter.out.match(/SQUATTER-READY (\d+)/)[1];
    const prepush = watch(process.execPath, ['scripts/prepush.mjs'], {
      cwd: repo,
      env: { ...env, PREPUSH_BASE_SHA: 'origin/main' },
    });
    assert.equal(await prepush.exited, 1, prepush.out + prepush.err);
    assert.doesNotMatch(prepush.err, /is held by pid|acquired slot/);
    assert.match(prepush.out, /\[prepush\] node scripts\/ui-debt-gate\.mjs/);
    assert.equal(existsSync(env.CAIRN_HEAVY_SLOTS_DIR), false);
  } finally {
    cleanup();
  }
});

test('stale owner metadata cannot grant a second lease while the first run is alive', async () => {
  const { env, cleanup } = sandbox(1);
  try {
    const holder = startHolder(env);
    await until(holder, 'out', /SLOT 1/);
    const dead = spawnSync(process.execPath, ['-p', 'process.pid'], { env, encoding: 'utf8' });
    assert.equal(dead.status, 0, dead.stderr);
    writeFileSync(
      join(env.CAIRN_HEAVY_SLOTS_DIR, 'slot-1.lock'),
      JSON.stringify({ pid: Number(dead.stdout) }),
    );
    const contender = startHolder(env, { wait: false, lingerMs: 0 });
    assert.equal(await contender.exited, 0, contender.err);
    assert.match(contender.out, /NONE/);
  } finally {
    cleanup();
  }
});

test('repeated release preserves the guard inode and a later lease', () => {
  const { env, cleanup } = sandbox(1);
  try {
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { acquireSlot } from ${JSON.stringify(moduleUrl)};
const path = process.env.CAIRN_HEAVY_SLOTS_DIR + '/slot-1.lock.guard';
const first = await acquireSlot();
const inode = statSync(path).ino;
first.release();
first.release();
const second = await acquireSlot();
assert.equal(statSync(path).ino, inode);
first.release();
second.release();
`,
      ],
      { env, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
  } finally {
    cleanup();
  }
});

test('kernel helper failures propagate and release candidate descriptors', () => {
  const { dir, env, cleanup } = sandbox(1);
  try {
    const python = spawnSync('python3', ['-I', '-c', 'import sys; print(sys.executable)'], {
      env,
      encoding: 'utf8',
    });
    assert.equal(python.status, 0, python.stderr);
    const bin = join(dir, 'bin');
    const missing = join(dir, 'missing');
    mkdirSync(bin);
    mkdirSync(missing);
    writeFileSync(
      join(bin, 'python3'),
      `#!${python.stdout.trim()}\nimport fcntl, sys\nfcntl.flock(3, fcntl.LOCK_EX | fcntl.LOCK_NB)\nsys.exit(7)\n`,
      { mode: 0o755 },
    );
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
import assert from 'node:assert/strict';
import { acquireSlot } from ${JSON.stringify(moduleUrl)};
await assert.rejects(acquireSlot({ wait: false, env: { ...process.env, PATH: ${JSON.stringify(missing)} } }), { code: 'ENOENT' });
await assert.rejects(acquireSlot({ wait: false, env: { ...process.env, PATH: ${JSON.stringify(bin)} } }), /kernel lock failed \\(7\\)/);
const lease = await acquireSlot({ wait: false });
assert.ok(lease);
lease.release();
`,
      ],
      { env, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
  } finally {
    cleanup();
  }
});
