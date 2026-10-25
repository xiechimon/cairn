import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { skipsQueue, slotCount, slotResources } from './heavy-slots.mjs';

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
    ...process.env,
    CAIRN_HEAVY_SLOTS: String(slots),
    CAIRN_HEAVY_SLOTS_DIR: join(dir, 'locks'),
  };
  delete env.CI;
  delete env.CAIRN_HEAVY_SLOT;
  return { dir, env, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function watch(command, args, options) {
  const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  const watched = {
    child,
    out: '',
    err: '',
    exited: new Promise((done) => child.on('close', done)),
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
    if (Date.now() > deadline)
      assert.fail(`${pattern} never appeared on ${stream}: ${watched.out}${watched.err}`);
    await sleep(20);
  }
}

const startHolder = (env, { wait = true, lingerMs = 60_000 } = {}) =>
  watch(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
import { existsSync } from 'node:fs';
import { acquireSlot } from ${JSON.stringify(moduleUrl)};
while (process.env.START_GATE && !existsSync(process.env.START_GATE)) {}
const lease = await acquireSlot({ env: process.env, wait: ${wait} });
console.log(lease ? 'SLOT ' + lease.slot : 'NONE');
setTimeout(() => process.exit(0), ${lingerMs});
`,
    ],
    { env },
  );

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

test('CI environments skip the queue', () => {
  assert.equal(skipsQueue({ CI: 'true' }), true);
  assert.equal(skipsQueue({ CI: '1' }), true);
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

test('a bad slot count gets a warning and a single slot', async () => {
  const { env, cleanup } = sandbox('abc');
  try {
    const holder = startHolder(env);
    await until(holder, 'out', /SLOT 1/);
    assert.match(holder.err, /CAIRN_HEAVY_SLOTS.*按 1 处理/);
    const second = startHolder(env);
    await until(second, 'err', /排队中，第 1 位/);
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
    await until(first, 'err', /排队中，第 1 位/);
    const second = startHolder(env);
    await until(second, 'err', /排队中，第 2 位/);
    holder.child.kill('SIGKILL');
    await until(first, 'out', /SLOT 1/, 5_000);
    assert.doesNotMatch(second.out, /SLOT/);
    await until(second, 'err', /排队中，第 2 位[\s\S]*排队中，第 1 位/);
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
    await until(waiter, 'err', /排队中/);
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
        startHolder(roundEnv, { wait: false, lingerMs: 1_500 }),
      );
      await sleep(1_000);
      writeFileSync(gate, '');
      await Promise.all(racers.map((racer) => racer.exited));
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
      const dead = spawnSync(
        process.execPath,
        ['-e', 'process.stdout.write(String(process.pid))'],
        {
          encoding: 'utf8',
        },
      ).stdout;
      writeFileSync(join(locks, 'slot-1.lock'), JSON.stringify({ pid: Number(dead) }));
      const roundEnv = { ...env, CAIRN_HEAVY_SLOTS_DIR: locks, START_GATE: gate };
      const racers = Array.from({ length: 8 }, () =>
        startHolder(roundEnv, { wait: false, lingerMs: 1_500 }),
      );
      await sleep(1_000);
      writeFileSync(gate, '');
      await Promise.all(racers.map((racer) => racer.exited));
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
    await Promise.all(waiters.map((waiter) => until(waiter, 'err', /排队中/)));
    for (const holder of holders) holder.child.kill('SIGKILL');
    await Promise.all(waiters.map((waiter) => until(waiter, 'out', /SLOT \d/, 15_000)));
    const early = waiters.map((waiter) => waiter.out.match(/SLOT (\d)/)[1]);
    assert.equal(new Set(early).size, 2, `only two slots exist, saw ${early}`);
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
    assert.deepEqual(codes, [0, 0, 0, 0]);
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
    assert.ok(jobs.filter((j) => /排队中/.test(j.err)).length >= 2);
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
    assert.doesNotMatch(result.stderr, /排队中/);
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
    await until(borrower, 'err', /排队中，第 1 位/);
    assert.doesNotMatch(borrower.out, /ran/);
  } finally {
    cleanup();
  }
});

test('CI skips the queue even when every slot is taken', async () => {
  const { env, cleanup } = sandbox(1);
  try {
    const holder = startHolder(env);
    await until(holder, 'out', /SLOT 1/);
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
      { env: { ...env, CI: 'true' }, encoding: 'utf8', timeout: 10_000 },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /slot=undefined/);
    assert.doesNotMatch(result.stderr, /排队中/);
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
    const spec = 'apps/web/e2e/branch-button.spec.ts';
    const dry = spawnSync(process.execPath, ['scripts/e2e-affected.mjs', '--dry-run', spec], {
      env,
      encoding: 'utf8',
      timeout: 20_000,
    });
    assert.equal(dry.status, 0, dry.stderr);
    const queued = watch(process.execPath, ['scripts/e2e-affected.mjs', spec], { env });
    await until(queued, 'err', /排队中，第 1 位/);
    assert.doesNotMatch(queued.out + queued.err, /Running \d+ test/);
  } finally {
    cleanup();
  }
});

test('prepush queues for a slot in local mode and starts once the holder is killed', async () => {
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
    for (const file of ['prepush.mjs', 'heavy-slots.mjs', 'english-only-gate.mjs'])
      copyFileSync(join('scripts', file), join(repo, 'scripts', file));
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
    await until(prepush, 'err', /排队中，第 1 位/);
    assert.doesNotMatch(prepush.out, /\[prepush\]/);
    const killedAt = Date.now();
    holder.child.kill('SIGKILL');
    await until(prepush, 'out', /\[prepush\] node scripts\/ui-debt-gate\.mjs/, 5_000);
    assert.ok(Date.now() - killedAt < 5_000);
    await prepush.exited;
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
