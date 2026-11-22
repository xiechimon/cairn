import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import {
  acquireSlot,
  cpuSaturationPercent,
  cpuUsagePercent,
  cpuUtilizationPercent,
  defaultSlotCount,
  foreignPortHolderReport,
  probeAnswers,
  probePath,
  slotCount,
  slotLockDir,
  slotPortHolder,
  slotResources,
  slotWorkerBudget,
  unreachableProbeError,
} from './heavy-slots.mjs';
import { prepushModules } from './prepush.mjs';
import { scrubGateEnv } from './scrub-git-env.mjs';
import { lightTestRun, selectedTestFiles } from './test-admission.mjs';

const moduleUrl = pathToFileURL(resolve('scripts/heavy-slots.mjs')).href;
const cli = resolve('scripts/heavy-slots.mjs');
const children = new Set();

test.afterEach(() => {
  for (const child of children) child.kill('SIGKILL');
  children.clear();
});

const capacities = new WeakMap();

function sandbox(slots) {
  const dir = mkdtempSync(join(tmpdir(), 'heavy-slots-test-'));
  const env = {
    ...scrubGateEnv(),
    CAIRN_OWNED_MODE: 'group',
    CAIRN_HEAVY_SLOTS_DIR: join(dir, 'locks'),
    CAIRN_CPU_SATURATION_PERCENT: '0',
    TMPDIR: join(dir, 'tmp'),
  };
  capacities.set(env, slots);
  mkdirSync(env.TMPDIR, { recursive: true });
  delete env.CI;
  delete env.CAIRN_HEAVY_SLOT;
  delete env.CAIRN_HEAVY_SLOT_OWNER;
  delete env.CAIRN_HEAVY_GATE_BYPASS;
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

async function until(watched, stream, pattern, timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs;
  while (!pattern.test(watched[stream])) {
    if (watched.closed || Date.now() > deadline)
      assert.fail(
        `${pattern} never appeared on ${stream} (exit ${watched.child.exitCode}, signal ${watched.child.signalCode}): ${watched.out}${watched.err}`,
      );
    await sleep(20);
  }
}

const capacityOf = (env) => capacities.get(env) ?? defaultSlotCount();

const admit = (options = {}) =>
  acquireSlot({
    ...options,
    pool: options.pool ?? { defaultCount: capacityOf(options.env ?? process.env) },
  });

const pinSingleSlot = (file) => {
  const source = readFileSync(file, 'utf8');
  const pinned = source.replace(
    'const CORES_PER_HEAVY_SLOT = 4;',
    'const CORES_PER_HEAVY_SLOT = 4096;',
  );
  assert.notEqual(pinned, source, `${file} still states the cores per heavy slot`);
  writeFileSync(file, pinned);
};

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

const startHolder = (env, { wait = true, lingerMs = 60_000, capacity = capacityOf(env) } = {}) =>
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
const lease = await acquireSlot({ env: process.env, wait: ${wait}, pool: { defaultCount: ${capacity} } });
console.log(lease ? 'SLOT ' + lease.slot : 'NONE');
while (process.env.START_GATE && !existsSync(process.env.START_GATE + '.release')) await sleep(20);
setTimeout(() => process.exit(0), ${lingerMs});
`,
    ],
    { env },
  );

const fillSlots = async (env) => {
  const holders = Array.from({ length: defaultSlotCount() }, () =>
    startHolder(env, { capacity: defaultSlotCount() }),
  );
  await Promise.all(holders.map((holder) => until(holder, 'out', /SLOT \d/)));
  return holders;
};

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

test('slot count comes from the core count, one heavy slot per four cores', () => {
  assert.equal(defaultSlotCount(8), 2);
  assert.equal(defaultSlotCount(16), 4);
  assert.equal(defaultSlotCount(4), 1);
  assert.equal(defaultSlotCount(2), 1);
  assert.equal(defaultSlotCount(1), 1);
  assert.equal(defaultSlotCount(3), 1);
  assert.equal(defaultSlotCount(7), 1);
});

test('cpu utilisation comes from os.cpus() deltas, never from load average', async () => {
  assert.equal(cpuUsagePercent({ busy: 100, total: 400 }, { busy: 400, total: 1000 }), 50);
  assert.equal(cpuUsagePercent({ busy: 100, total: 400 }, { busy: 100, total: 400 }), 0);
  const sampled = await cpuUtilizationPercent({ sampleMs: 60 });
  assert.ok(sampled >= 0 && sampled <= 100, String(sampled));
  assert.deepEqual(cpuSaturationPercent({}), { percent: 90 });
  assert.deepEqual(cpuSaturationPercent({ CAIRN_CPU_SATURATION_PERCENT: '0' }), { percent: 0 });
  assert.deepEqual(cpuSaturationPercent({ CAIRN_CPU_SATURATION_PERCENT: '75.5' }), {
    percent: 75.5,
  });
  const bad = cpuSaturationPercent({ CAIRN_CPU_SATURATION_PERCENT: 'lots' });
  assert.equal(bad.percent, 90);
  assert.match(bad.warning, /CAIRN_CPU_SATURATION_PERCENT/);
});

test('a saturated cpu keeps a waiter queued until the machine drains', async () => {
  const { env, cleanup } = sandbox(1);
  const lines = [];
  const readings = [99, 99, 40];
  let lease;
  try {
    lease = await admit({
      env: { ...env, CAIRN_CPU_SATURATION_PERCENT: '90' },
      log: (line) => lines.push(line),
      cpuProbe: async () => readings.shift() ?? 40,
    });
    assert.ok(lease, lines.join('\n'));
    assert.equal(
      lines.filter((line) => /is at or above the 90% saturation limit/.test(line)).length,
      1,
      lines.join('\n'),
    );
    assert.match(lines.join('\n'), /cpu back to 40%, under the 90% saturation limit/);
    assert.deepEqual(readings, []);
  } finally {
    lease?.release();
    cleanup();
  }
});

test('a cpu saturation probe refuses a non-waiting admission and a disabled limit ignores it', async () => {
  const { env, cleanup } = sandbox(1);
  try {
    assert.equal(
      await admit({
        env: { ...env, CAIRN_CPU_SATURATION_PERCENT: '90' },
        wait: false,
        cpuProbe: async () => 99,
      }),
      null,
    );
    const lease = await admit({
      env: { ...env, CAIRN_CPU_SATURATION_PERCENT: '0' },
      wait: false,
      cpuProbe: async () => 99,
    });
    assert.ok(lease);
    lease.release();
  } finally {
    cleanup();
  }
});

test('a cpu that stays saturated past the max wait starts anyway and says so', async () => {
  const { env, cleanup } = sandbox(1);
  const lines = [];
  let lease;
  try {
    lease = await admit({
      env: {
        ...env,
        CAIRN_CPU_SATURATION_PERCENT: '90',
        CAIRN_CPU_SATURATION_MAX_WAIT_MS: '1',
      },
      log: (line) => lines.push(line),
      cpuProbe: async () => 99,
    });
    assert.ok(lease);
    assert.match(lines.join('\n'), /starting anyway \(CAIRN_CPU_SATURATION_MAX_WAIT_MS=1\)/);
  } finally {
    lease?.release();
    cleanup();
  }
});

test('a lease caps its holder to the cores that slot owns', () => {
  assert.equal(slotWorkerBudget(null), null);
  assert.equal(slotWorkerBudget({ slot: 1 }), 4);
  assert.equal(slotWorkerBudget({ slot: 1 }, 8), 4);
  assert.equal(slotWorkerBudget({ slot: 1 }, 16), 4);
  assert.equal(slotWorkerBudget({ slot: 1 }, 4), 4);
  assert.equal(slotWorkerBudget({ slot: 1 }, 2), 2);
  assert.equal(slotWorkerBudget({ slot: 1 }, 1), 1);
});

test('only the explicit bypass flag skips admission, and it names itself in the log', async () => {
  const { env, cleanup } = sandbox(1);
  try {
    const holder = startHolder(env);
    await until(holder, 'out', /SLOT 1/);
    const bypassed = watch(
      process.execPath,
      [cli, 'run', '--', process.execPath, '-e', 'console.log("ran")'],
      { env: { ...env, CI: 'true', CAIRN_HEAVY_GATE_BYPASS: '1' } },
    );
    assert.equal(await bypassed.exited, 0, bypassed.err);
    assert.match(bypassed.out, /ran/);
    assert.match(bypassed.err, /BYPASS: CAIRN_HEAVY_GATE_BYPASS=1/);
    assert.doesNotMatch(bypassed.err, /queued, position/);
  } finally {
    cleanup();
  }
});

test('CI takes a slot unless it sets the bypass flag', async () => {
  const { dir, env, cleanup } = sandbox(1);
  const absent = join(dir, 'absent');
  try {
    const queued = watch(
      process.execPath,
      [cli, 'run', '--', process.execPath, '-e', 'console.log("ran")'],
      { env: { ...env, CI: 'true', CAIRN_HEAVY_SLOTS_DIR: absent } },
    );
    assert.equal(await queued.exited, 0, queued.err);
    assert.match(queued.err, /acquired slot 1\/\d+/);
    assert.equal(existsSync(join(absent, 'slot-1.lock')), false, 'released on exit');
    const kept = watch(
      process.execPath,
      [cli, 'run', '--', process.execPath, '-e', 'console.log("ran")'],
      {
        env: {
          ...env,
          CI: 'true',
          CAIRN_HEAVY_SLOTS_DIR: join(dir, 'bypassed'),
          CAIRN_HEAVY_GATE_BYPASS: 'true',
        },
      },
    );
    assert.equal(await kept.exited, 0, kept.err);
    assert.equal(
      existsSync(join(dir, 'bypassed')),
      false,
      'a bypassed CI run does not create the slot directory',
    );
  } finally {
    cleanup();
  }
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

test('a queued waiter that can never use a free higher slot does not head-block the queue', async () => {
  const { env, cleanup } = sandbox(2);
  try {
    const holder = startHolder(env, { capacity: 1 });
    await until(holder, 'out', /SLOT 1/);
    const narrowWaiter = startHolder(env, { capacity: 1, lingerMs: 15_000 });
    await until(narrowWaiter, 'err', /queued, position 1/);
    const wideWaiter = startHolder(env, { capacity: 2, lingerMs: 15_000 });
    await until(wideWaiter, 'out', /SLOT 2/, 5_000);
    assert.doesNotMatch(narrowWaiter.out, /SLOT/);
    await until(narrowWaiter, 'err', /queued, position 1/);
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
        startHolder(roundEnv, { wait: false, lingerMs: 0, capacity: 1 }),
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
        startHolder(roundEnv, { wait: false, lingerMs: 0, capacity: 1 }),
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
    await Promise.all(waiters.map((waiter) => until(waiter, 'out', /SLOT \d/, 40_000)));
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

async function droppedSocket(path) {
  const server = createServer();
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(path, done);
  });
  await new Promise((done) => server.close(done));
  return path;
}

function deadPid() {
  const out = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], {
    encoding: 'utf8',
  }).stdout;
  return Number(out);
}

test('probe connect errors a listener could never have answered mark the holder dead', () => {
  for (const code of ['ENOENT', 'ECONNREFUSED', 'ECONNRESET', 'EINVAL', 'ENAMETOOLONG'])
    assert.equal(unreachableProbeError({ code }), true, code);
  for (const code of ['EMFILE', 'EPERM', 'EACCES', 'ENOTSOCK'])
    assert.equal(unreachableProbeError({ code }), false, code);
});

test('a lock directory deeper than the unix socket limit still gets a short probe path', async () => {
  const { env, cleanup } = sandbox(1);
  env.CAIRN_HEAVY_SLOTS_DIR = join(env.CAIRN_HEAVY_SLOTS_DIR, 'a'.repeat(60), 'b'.repeat(60));
  try {
    const locks = env.CAIRN_HEAVY_SLOTS_DIR;
    const holder = startHolder(env, { lingerMs: 200 });
    await until(holder, 'out', /SLOT 1/);
    const record = JSON.parse(readFileSync(join(locks, 'slot-1.lock'), 'utf8'));
    assert.equal(record.probe, probePath(record.token, env.TMPDIR));
    assert.ok(record.probe.length <= 100, record.probe);
    await holder.exited;
  } finally {
    cleanup();
  }
});

test('the liveness probe socket lives under the os tmpdir, bounded in length', async () => {
  const { env, cleanup } = sandbox(1);
  try {
    const locks = env.CAIRN_HEAVY_SLOTS_DIR;
    const holder = startHolder(env, { lingerMs: 200 });
    await until(holder, 'out', /SLOT 1/);
    const record = JSON.parse(readFileSync(join(locks, 'slot-1.lock'), 'utf8'));
    assert.equal(record.probe, probePath(record.token, env.TMPDIR));
    assert.match(record.probe, /cairn-heavy-[a-f0-9]+\.sock$/);
    assert.ok(record.probe.length <= 100, record.probe);
    await holder.exited;
    assert.equal(existsSync(record.probe), false);
  } finally {
    cleanup();
  }
});

test('a dead holder whose probe sits in the locks dir is reclaimed and its socket cleaned', async () => {
  const { env, cleanup } = sandbox(1);
  try {
    const locks = env.CAIRN_HEAVY_SLOTS_DIR;
    mkdirSync(locks, { recursive: true });
    const token = randomUUID();
    const probe = await droppedSocket(join(locks, `cairn-heavy-${token}.sock`));
    writeFileSync(join(locks, 'slot-1.lock'), JSON.stringify({ pid: deadPid(), probe, token }));
    const next = startHolder(env);
    await until(next, 'out', /SLOT 1/);
    assert.equal(existsSync(probe), false);
  } finally {
    cleanup();
  }
});

test('a dead holder with a legacy /tmp probe path is reclaimed and its socket cleaned', async (t) => {
  const { env, cleanup } = sandbox(1);
  try {
    const locks = env.CAIRN_HEAVY_SLOTS_DIR;
    mkdirSync(locks, { recursive: true });
    const token = randomUUID();
    let probe;
    try {
      probe = await droppedSocket(join('/tmp', `cairn-heavy-${token}.sock`));
    } catch (error) {
      if (error.code === 'EPERM' || error.code === 'EACCES')
        return t.skip('this host forbids unix sockets under /tmp');
      throw error;
    }
    try {
      writeFileSync(join(locks, 'slot-1.lock'), JSON.stringify({ pid: deadPid(), probe, token }));
      const next = startHolder(env);
      await until(next, 'out', /SLOT 1/);
      assert.equal(existsSync(probe), false);
    } finally {
      rmSync(probe, { force: true });
    }
  } finally {
    cleanup();
  }
});

test('a holder whose probe cannot be reached and whose pid is dead is still reclaimed', async () => {
  const { dir, env, cleanup } = sandbox(1);
  try {
    const locks = env.CAIRN_HEAVY_SLOTS_DIR;
    mkdirSync(locks, { recursive: true });
    const sealed = join(dir, 'sealed');
    mkdirSync(sealed, { recursive: true });
    const token = randomUUID();
    await droppedSocket(join(sealed, `cairn-heavy-${token}.sock`));
    chmodSync(sealed, 0);
    try {
      writeFileSync(
        join(locks, 'slot-1.lock'),
        JSON.stringify({
          pid: deadPid(),
          probe: join(sealed, `cairn-heavy-${token}.sock`),
          token,
        }),
      );
      const next = startHolder(env);
      await until(next, 'out', /SLOT 1/);
    } finally {
      chmodSync(sealed, 0o700);
    }
  } finally {
    cleanup();
  }
});

test('a holder whose probe cannot be reached but whose pid lives keeps its slot', async () => {
  const { dir, env, cleanup } = sandbox(1);
  try {
    const locks = env.CAIRN_HEAVY_SLOTS_DIR;
    mkdirSync(locks, { recursive: true });
    const sealed = join(dir, 'sealed');
    mkdirSync(sealed, { recursive: true });
    const token = randomUUID();
    await droppedSocket(join(sealed, `cairn-heavy-${token}.sock`));
    chmodSync(sealed, 0);
    try {
      const live = watch(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { env });
      writeFileSync(
        join(locks, 'slot-1.lock'),
        JSON.stringify({
          pid: live.child.pid,
          probe: join(sealed, `cairn-heavy-${token}.sock`),
          token,
        }),
      );
      const waiter = startHolder(env);
      await until(waiter, 'err', /queued, position 1/);
      assert.doesNotMatch(waiter.out, /SLOT/);
    } finally {
      chmodSync(sealed, 0o700);
    }
  } finally {
    cleanup();
  }
});

test('a planted probe path that is not a socket is reclaimed, not crashed', async () => {
  const { dir, env, cleanup } = sandbox(1);
  try {
    const locks = env.CAIRN_HEAVY_SLOTS_DIR;
    mkdirSync(locks, { recursive: true });
    const planted = join(dir, 'planted.sock');
    writeFileSync(planted, 'not a socket');
    const dead = spawnSync(process.execPath, ['-e', ''], { env });
    writeFileSync(
      join(locks, 'slot-1.lock'),
      JSON.stringify({ pid: dead.pid ?? 0x3fffffff, probe: planted, token: randomUUID() }),
    );
    const waiter = startHolder(env);
    await until(waiter, 'out', /SLOT 1/);
  } finally {
    cleanup();
  }
});

test('runs never exceed the machine capacity, and every run finishes', async () => {
  const { dir, env, cleanup } = sandbox(1);
  const capacity = defaultSlotCount();
  try {
    const events = join(dir, 'events.log');
    const job = `
      const { appendFileSync } = require('node:fs');
      appendFileSync(${JSON.stringify(events)}, 'start ' + process.pid + ' ' + Date.now() + '\\n');
      setTimeout(() => {
        appendFileSync(${JSON.stringify(events)}, 'end ' + process.pid + ' ' + Date.now() + '\\n');
      }, 600);
    `;
    const jobs = Array.from({ length: capacity * 2 }, () =>
      watch(process.execPath, [cli, 'run', '--', process.execPath, '-e', job], { env }),
    );
    const codes = await Promise.all(jobs.map((job) => job.exited));
    assert.deepEqual(
      codes,
      Array(capacity * 2).fill(0),
      jobs.map((job) => job.out + job.err).join('|'),
    );
    const starts = new Set();
    const marks = [];
    for (const line of readFileSync(events, 'utf8').trim().split('\n')) {
      const [kind, pid, at] = line.split(' ');
      if (kind === 'start') starts.add(pid);
      marks.push({ at: Number(at), delta: kind === 'start' ? 1 : -1 });
    }
    assert.equal(starts.size, capacity * 2);
    marks.sort((a, b) => a.at - b.at || a.delta - b.delta);
    let active = 0;
    let peak = 0;
    for (const mark of marks) {
      active += mark.delta;
      peak = Math.max(peak, active);
    }
    assert.ok(peak <= capacity, `peak of ${peak} runs exceeds the capacity of ${capacity}`);
  } finally {
    cleanup();
  }
});

test('three prepush runs in three checkouts at capacity 1 serialize', async () => {
  const { dir, env, cleanup } = sandbox(1);
  try {
    const events = join(dir, 'prepush-events.log');
    const stub = `
import { appendFileSync } from 'node:fs';
appendFileSync(${JSON.stringify(events)}, 'start ' + process.pid + ' ' + Date.now() + '\\n');
await new Promise((done) => setTimeout(done, 700));
appendFileSync(${JSON.stringify(events)}, 'end ' + process.pid + ' ' + Date.now() + '\\n');
`;
    const repos = [0, 1, 2].map((index) => {
      const repo = join(dir, `repo-${index}`);
      mkdirSync(join(repo, 'scripts'), { recursive: true });
      const git = (...args) =>
        execFileSync(
          'git',
          ['-c', 'user.name=heavy-slots-test', '-c', 'user.email=heavy@example.invalid', ...args],
          { cwd: repo, stdio: 'pipe' },
        );
      for (const file of prepushModules) {
        mkdirSync(dirname(join(repo, file)), { recursive: true });
        copyFileSync(file, join(repo, file));
      }
      pinSingleSlot(join(repo, 'scripts/heavy-slots.mjs'));
      writeFileSync(join(repo, 'scripts/english-only-gate.mjs'), stub);
      writeFileSync(join(repo, 'scripts/public-content-gate.mjs'), 'process.exit(1);\n');
      git('init');
      writeFileSync(join(repo, 'README.md'), 'first\n');
      git('add', '.');
      git('commit', '-m', 'initial');
      git('update-ref', 'refs/remotes/origin/main', 'HEAD');
      writeFileSync(join(repo, 'notes.md'), 'a note\n');
      return repo;
    });
    const runs = repos.map((repo) =>
      watch(process.execPath, ['scripts/prepush.mjs'], {
        cwd: repo,
        env: { ...env, PREPUSH_BASE_SHA: 'origin/main' },
      }),
    );
    await Promise.all(runs.map((run) => run.exited));
    const output = runs.map((run) => run.out + run.err).join('\n');
    assert.equal(runs.filter((run) => /acquired slot 1\/1/.test(run.err)).length, 3, output);
    assert.ok(runs.filter((run) => /queued, position/.test(run.err)).length >= 2, output);
    const spans = new Map();
    for (const line of readFileSync(events, 'utf8').trim().split('\n')) {
      const [kind, pid, at] = line.split(' ');
      if (kind === 'start') spans.set(pid, { start: Number(at) });
      else spans.get(pid).end = Number(at);
    }
    assert.equal(spans.size, 3, output);
    const ordered = [...spans.values()].sort((a, b) => a.start - b.start);
    for (let index = 1; index < ordered.length; index++)
      assert.ok(
        ordered[index - 1].end <= ordered[index].start,
        `prepush ${index} ran its first check at ${ordered[index].start}, while another ran until ${ordered[index - 1].end}`,
      );
  } finally {
    cleanup();
  }
});

test('test:changed waits for a slot before it starts Vitest', async () => {
  const { dir, env, cleanup } = sandbox(1);
  const repo = join(dir, 'repo-test-changed');
  try {
    mkdirSync(join(repo, 'apps/web/test'), { recursive: true });
    mkdirSync(join(repo, 'apps/server/test'), { recursive: true });
    mkdirSync(join(repo, 'scripts'), { recursive: true });
    copyFileSync('scripts/test-changed.mjs', join(repo, 'scripts/test-changed.mjs'));
    copyFileSync('scripts/heavy-slots.mjs', join(repo, 'scripts/heavy-slots.mjs'));
    pinSingleSlot(join(repo, 'scripts/heavy-slots.mjs'));
    copyFileSync('scripts/owned-process.mjs', join(repo, 'scripts/owned-process.mjs'));
    const git = (...args) =>
      execFileSync(
        'git',
        ['-c', 'user.name=heavy-slots-test', '-c', 'user.email=heavy@example.invalid', ...args],
        { cwd: repo, stdio: 'pipe' },
      );
    git('init');
    writeFileSync(join(repo, 'README.md'), 'first\n');
    writeFileSync(join(repo, 'apps/server/test/migration.test.ts'), 'migrateUpTo(http);\n');
    git('add', 'README.md', 'apps/server/test/migration.test.ts');
    git('commit', '-m', 'initial');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    writeFileSync(join(repo, 'apps/web/test/probe.test.ts'), 'export {};\n');
    const holder = startHolder(env);
    await until(holder, 'out', /SLOT 1/);
    const changed = watch(process.execPath, ['scripts/test-changed.mjs'], { cwd: repo, env });
    await until(changed, 'err', /queued, position 1/);
    assert.match(changed.out, /test:changed: 1 file/);
    assert.doesNotMatch(changed.out + changed.err, /vitest/);
  } finally {
    cleanup();
  }
});

test('a run over a few named test files is light and never waits behind heavy work', async () => {
  const vitest = ['node', '/repo/node_modules/vitest/vitest.mjs', 'run'];
  assert.equal(lightTestRun([...vitest, 'apps/web/test/one.test.ts']), '1 test file');
  assert.equal(lightTestRun([...vitest, 'a.test.ts', 'b.test.ts', 'c.spec.tsx']), '3 test files');
  assert.deepEqual(
    selectedTestFiles([...vitest, '--project', 'web', 'apps/web/test/one.test.ts']),
    ['apps/web/test/one.test.ts'],
  );
  for (const argv of [
    vitest,
    [...vitest, '--project', 'web'],
    ['node', '/repo/node_modules/@playwright/test/cli.js', 'test', 'apps/web/e2e/one.spec.ts'],
    [...vitest, 'a.test.ts', 'b.test.ts', 'c.test.ts', 'd.test.ts', 'e.test.ts'],
  ])
    assert.equal(lightTestRun(argv), null, argv.join(' '));

  const { dir, env, cleanup } = sandbox(1);
  const repo = join(dir, 'repo-light');
  try {
    mkdirSync(join(repo, 'scripts'), { recursive: true });
    for (const file of ['test-admission.mjs', 'heavy-slots.mjs', 'owned-process.mjs'])
      copyFileSync(join('scripts', file), join(repo, 'scripts', file));
    writeFileSync(
      join(repo, 'vitest.mjs'),
      `import { testRunWorkers } from './scripts/test-admission.mjs';\nconsole.log('workers ' + String(await testRunWorkers()));\n`,
    );
    const holder = startHolder(env);
    await until(holder, 'out', /SLOT 1/);
    const light = watch(process.execPath, ['vitest.mjs', 'run', 'apps/web/test/one.test.ts'], {
      cwd: repo,
      env,
    });
    assert.equal(await light.exited, 0, light.err);
    assert.match(light.out, /workers undefined/);
    assert.match(light.err, /1 test file is light work; taking no slot/);
    assert.doesNotMatch(light.err, /queued, position/);
    assert.equal(existsSync(join(env.CAIRN_HEAVY_SLOTS_DIR, 'slot-1.lock')), true, 'still held');
  } finally {
    cleanup();
  }
});

test('a waiter names the lane, command and age of every holder and repeats while it waits', async () => {
  const { env, cleanup } = sandbox(1);
  try {
    const holder = startHolder(env);
    await until(holder, 'out', /SLOT 1/);
    const waiter = startHolder({ ...env, CAIRN_HEAVY_QUEUE_REPRINT_MS: '300' }, { capacity: 1 });
    await until(waiter, 'err', /queued, position 1 of 1 slot/);
    assert.match(waiter.err, new RegExp(`lane [^,]+, pid ${holder.child.pid}, `));
    assert.match(waiter.err, /node /);
    assert.match(waiter.err, /\ds old|\dm old|\dh\d\dm old/);
    await until(waiter, 'err', /still waiting/, 5_000);
    assert.equal(
      (waiter.err.match(/queued, position 1 of 1 slot/g) ?? []).length >= 2,
      true,
      waiter.err,
    );
  } finally {
    cleanup();
  }
});

test('a desktop pack waits for a slot before it builds anything', async () => {
  const { env, cleanup } = sandbox(1);
  try {
    const scripts = JSON.parse(readFileSync('apps/desktop/package.json', 'utf8')).scripts;
    for (const name of ['start', 'dist:mac', 'dist:linux'])
      assert.match(scripts[name], /node scripts\/pack\.mjs/, name);
    await fillSlots(env);
    const pack = watch(process.execPath, ['scripts/pack.mjs', '--mac'], {
      cwd: resolve('apps/desktop'),
      env: { ...env, CAIRN_TEST_TEMP_ROOT: join(env.TMPDIR, 'tmp-root') },
    });
    await until(pack, 'err', /queued, position 1/);
    assert.doesNotMatch(pack.out, /electron-builder|dist\/main\.mjs/);
  } finally {
    cleanup();
  }
});

test('run wrapper: at most the machine capacity runs at once, no slot twice, all pass', async () => {
  const { dir, env, cleanup } = sandbox(2);
  const capacity = defaultSlotCount();
  try {
    const events = join(dir, 'events.log');
    const job = `
      const { appendFileSync } = require('node:fs');
      appendFileSync(${JSON.stringify(events)}, 'start ' + process.env.CAIRN_HEAVY_SLOT + '\\n');
      setTimeout(() => {
        appendFileSync(${JSON.stringify(events)}, 'end ' + process.env.CAIRN_HEAVY_SLOT + '\\n');
      }, 700);
    `;
    const jobs = Array.from({ length: capacity * 2 }, () =>
      watch(process.execPath, [cli, 'run', '--', process.execPath, '-e', job], { env }),
    );
    const codes = await Promise.all(jobs.map((j) => j.exited));
    assert.deepEqual(codes, Array(capacity * 2).fill(0), jobs.map((j) => j.out + j.err).join('|'));
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
    assert.equal(peak, capacity);
    assert.ok(
      jobs.filter((j) => /queued, position/.test(j.err)).length >= capacity,
      jobs.map((j) => j.err).join('|'),
    );
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
      { env, encoding: 'utf8', timeout: 40_000 },
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
      { env: { ...env, CAIRN_HEAVY_SLOT: '1' }, encoding: 'utf8', timeout: 40_000 },
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
    await fillSlots(env);
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
    await fillSlots(env);
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

test('local prepush waits for the heavy slot before it runs a single check', async () => {
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
    pinSingleSlot(join(repo, 'scripts/heavy-slots.mjs'));
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
    await until(prepush, 'err', /queued, position 1/);
    assert.doesNotMatch(prepush.out, /\[prepush\] /);
    holder.child.kill('SIGKILL');
    await until(prepush, 'out', /\[prepush\] node scripts\/english-only-gate\.mjs/, 40_000);
    assert.match(prepush.err, /acquired slot 1\/1/);
    prepush.child.kill('SIGKILL');
    const bypassed = spawnSync(process.execPath, ['scripts/prepush.mjs', '--advisory'], {
      cwd: repo,
      env: { ...prepushEnv, CI: 'true', CAIRN_HEAVY_GATE_BYPASS: '1' },
      encoding: 'utf8',
      timeout: 60_000,
    });
    assert.match(bypassed.stderr, /BYPASS: CAIRN_HEAVY_GATE_BYPASS=1/);
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
    pinSingleSlot(join(repo, 'scripts/heavy-slots.mjs'));
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
    assert.doesNotMatch(prepush.err, /is held by pid/);
    assert.match(prepush.err, /acquired slot 1\/1/);
    assert.match(prepush.out, /\[prepush\] node scripts\/ui-debt-gate\.mjs/);
    assert.equal(existsSync(join(env.CAIRN_HEAVY_SLOTS_DIR, 'slot-1.lock')), false);
  } finally {
    cleanup();
  }
});

test('stale owner metadata cannot grant a second lease while the first run is alive', async () => {
  const { env, cleanup } = sandbox(1);
  try {
    const holder = startHolder(env, { capacity: 1 });
    await until(holder, 'out', /SLOT 1/);
    const dead = spawnSync(process.execPath, ['-p', 'process.pid'], { env, encoding: 'utf8' });
    assert.equal(dead.status, 0, dead.stderr);
    writeFileSync(
      join(env.CAIRN_HEAVY_SLOTS_DIR, 'slot-1.lock'),
      JSON.stringify({ pid: Number(dead.stdout) }),
    );
    const contender = startHolder(env, { wait: false, lingerMs: 0, capacity: 1 });
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

const launchScript = resolve('.claude/skills/verify-cairn/scripts/launch.mjs');

const startLiveStackHolder = (env) =>
  watch(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
import { acquireSlot, LIVE_STACK_POOL } from ${JSON.stringify(moduleUrl)};
const lease = await acquireSlot({ env: process.env, pool: LIVE_STACK_POOL });
console.log(lease ? 'LIVE-SLOT ' + lease.slot : 'NONE');
setInterval(() => {}, 1000);
`,
    ],
    { env },
  );

test('the live-stack pool reads its own count and defaults to one', () => {
  assert.equal(slotCount({}, 'CAIRN_LIVE_STACK_SLOTS', 1).count, 1);
  assert.equal(slotCount({ CAIRN_LIVE_STACK_SLOTS: '3' }, 'CAIRN_LIVE_STACK_SLOTS', 1).count, 3);
  assert.match(
    slotCount({ CAIRN_LIVE_STACK_SLOTS: 'x' }, 'CAIRN_LIVE_STACK_SLOTS', 1).warning,
    /CAIRN_LIVE_STACK_SLOTS/,
  );
});

test('a verify stack launch queues for the shared live-stack slot and releases it on exit', async () => {
  const { dir, env, cleanup } = sandbox(1);
  try {
    const holder = startLiveStackHolder(env);
    await until(holder, 'out', /LIVE-SLOT 1/);
    const squatter = startSquatter(env, dir);
    await until(squatter, 'out', /SQUATTER-READY/);
    const launch = watch(process.execPath, [launchScript], {
      env: {
        ...env,
        CAIRN_LIVE_STACK_SLOTS: '1',
        VERIFY_RUN_DIR: join(dir, 'run'),
        VERIFY_PORT: squatter.out.match(/SQUATTER-READY (\d+)/)[1],
        VERIFY_WEB_PORT: '1',
      },
    });
    await until(launch, 'err', /queued, position 1/);
    assert.match(launch.err, new RegExp(`lane [^,]+, pid ${holder.child.pid}, `));
    const slotFile = join(env.CAIRN_HEAVY_SLOTS_DIR, 'live-stack', 'slot-1.lock');
    assert.equal(existsSync(slotFile), true);
    holder.child.kill('SIGKILL');
    await until(launch, 'err', /acquired slot 1\/1/, 5_000);
    assert.equal(await launch.exited, 1, launch.out + launch.err);
    assert.match(launch.err, /VERIFY_PORT/);
    assert.equal(existsSync(slotFile), false);
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
