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
const e2eAffectedCli = resolve('scripts/e2e-affected.mjs');
const children = new Set();

test.afterEach(() => {
  for (const child of children) child.kill('SIGKILL');
  children.clear();
});

const SANDBOX_PORT_BASE = 20000 + (process.pid % 1000) * 20;

function sandbox(slots) {
  const dir = mkdtempSync(join(tmpdir(), 'heavy-slots-test-'));
  const env = {
    ...scrubGateEnv(),
    CAIRN_HEAVY_SLOTS: String(slots),
    CAIRN_HEAVY_SLOTS_DIR: join(dir, 'locks'),
    TMPDIR: join(dir, 'tmp'),
    E2E_AFFECTED_PORT: String(SANDBOX_PORT_BASE),
  };
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

const prepushVitestFixture = (dir) => {
  mkdirSync(join(dir, 'tmp'), { recursive: true });
  const repo = join(dir, 'vitest-repo');
  mkdirSync(join(repo, 'scripts'), { recursive: true });
  for (const file of ['prepush-vitest.mjs', 'heavy-slots.mjs', 'prepush-known-red.json'])
    copyFileSync(join('scripts', file), join(repo, 'scripts', file));
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, 'pnpm'),
    `#!/usr/bin/env node
const { writeFileSync } = require('node:fs');
const output = process.argv.find((arg) => arg.startsWith('--outputFile.json='));
if (!output) process.exit(2);
writeFileSync(output.slice('--outputFile.json='.length), JSON.stringify({ testResults: [] }));
console.log('FAKE-VITEST-RAN');
`,
    { mode: 0o755 },
  );
  return {
    repo,
    withFakePnpm: (env) => ({ ...env, PATH: `${bin}:${process.env.PATH}` }),
  };
};

const fakePnpmFixture = (dir) => {
  const bin = join(dir, 'bin');
  const log = join(dir, 'pnpm-calls.jsonl');
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, 'pnpm'),
    `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
appendFileSync(
  ${JSON.stringify(log)},
  JSON.stringify({
    argv: process.argv.slice(2),
    E2E_PORT: process.env.E2E_PORT,
    E2E_DIST_DIR: process.env.E2E_DIST_DIR,
    CAIRN_HEAVY_SLOT: process.env.CAIRN_HEAVY_SLOT,
  }) + '\\n',
);
console.log('FAKE-PLAYWRIGHT-RAN');
`,
    { mode: 0o755 },
  );
  return {
    log,
    withFakePnpm: (env) => ({ ...env, PATH: `${bin}:${process.env.PATH}` }),
  };
};

const startSquatter = (env, port, cwd) =>
  watch(
    process.execPath,
    [
      '-e',
      `require('node:net')
        .createServer(() => {})
        .listen(${port}, '127.0.0.1', () => console.log('SQUATTER-READY'))
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
import { acquireSlot } from ${JSON.stringify(moduleUrl)};
while (process.env.START_GATE && !existsSync(process.env.START_GATE)) {}
const lease = await acquireSlot({ env: process.env, wait: ${wait} });
console.log(lease ? 'SLOT ' + lease.slot : 'NONE');
setTimeout(() => process.exit(0), ${lingerMs});
`,
    ],
    { env },
  );

test('an overridden TMPDIR on macOS does not move the shared lock directory', () => {
  const darwinTemp = spawnSync('getconf', ['DARWIN_USER_TEMP_DIR'], {
    encoding: 'utf8',
  }).stdout.trim();
  if (process.platform === 'darwin')
    assert.equal(
      slotLockDir({ TMPDIR: '/private/tmp/sandbox-override' }, 'darwin'),
      join(darwinTemp, 'cairn-heavy-slots'),
    );
  assert.equal(slotLockDir({ TMPDIR: '/x', CAIRN_HEAVY_SLOTS_DIR: '/locks' }, 'darwin'), '/locks');
  assert.equal(slotLockDir({}, 'linux'), join(tmpdir(), 'cairn-heavy-slots'));
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

test('slotPortHolder names the pid, cwd and command of whatever listens on the port', async () => {
  const { dir, env, cleanup } = sandbox(1);
  try {
    mkdirSync(join(dir, 'squatter'));
    const squatterCwd = realpathSync(join(dir, 'squatter'));
    const squatter = startSquatter(env, Number(env.E2E_AFFECTED_PORT), squatterCwd);
    await until(squatter, 'out', /SQUATTER-READY/);
    const holder = slotPortHolder(Number(env.E2E_AFFECTED_PORT));
    assert.equal(holder.pid, squatter.child.pid);
    assert.equal(holder.cwd, squatterCwd);
    assert.match(holder.command, /node/);
    assert.equal(slotPortHolder(Number(env.E2E_AFFECTED_PORT) + 1), null);
  } finally {
    cleanup();
  }
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
    await Promise.all(waiters.map((waiter) => until(waiter, 'err', /queued, position/)));
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
    assert.doesNotMatch(result.stderr, /queued, position/);
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
    await until(queued, 'err', /queued, position 1/);
    assert.doesNotMatch(queued.out + queued.err, /Running \d+ test/);
  } finally {
    cleanup();
  }
});

test('e2e:affected outside prepush uses only the port of the slot it acquired and releases it on exit', async () => {
  const { dir, env, cleanup } = sandbox(2);
  const fake = fakePnpmFixture(dir);
  try {
    const holder = startHolder(env);
    await until(holder, 'out', /SLOT 1/);
    const run = watch(process.execPath, [e2eAffectedCli, 'apps/web/e2e/branch-button.spec.ts'], {
      env: fake.withFakePnpm(env),
    });
    assert.equal(await run.exited, 0, run.out + run.err);
    assert.match(run.out, /FAKE-PLAYWRIGHT-RAN/);
    const slotTwoPort = Number(env.E2E_AFFECTED_PORT) + 10;
    assert.match(run.out, new RegExp(`slot 2: E2E_PORT=${slotTwoPort}`));
    const calls = readFileSync(fake.log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(calls.length, 1);
    const [call] = calls;
    assert.equal(call.E2E_PORT, String(slotTwoPort));
    assert.equal(call.CAIRN_HEAVY_SLOT, '2');
    assert.equal(call.E2E_DIST_DIR, join(env.TMPDIR, 'cairn-heavy-slot-2', 'web-dist'));
    assert.notEqual(call.E2E_PORT, env.E2E_AFFECTED_PORT);
    assert.ok(call.argv.includes('branch-button.spec.ts'));
    const configPath = call.argv[call.argv.indexOf('--config') + 1];
    const config = readFileSync(configPath, 'utf8');
    assert.match(config, new RegExp(`http://127\\.0\\.0\\.1:${slotTwoPort}`));
    assert.ok(!config.includes(`127.0.0.1:${env.E2E_AFFECTED_PORT}`));
    assert.ok(!config.includes('8398'));
    const next = startHolder(env);
    await until(next, 'out', /SLOT 2/, 5_000);
  } finally {
    cleanup();
  }
});

test('a squatted slot port fails e2e:affected before playwright and names the holding process', async () => {
  const { dir, env, cleanup } = sandbox(2);
  const fake = fakePnpmFixture(dir);
  try {
    const holder = startHolder(env);
    await until(holder, 'out', /SLOT 1/);
    mkdirSync(join(dir, 'squatter'));
    const squatterCwd = realpathSync(join(dir, 'squatter'));
    const squatter = startSquatter(env, Number(env.E2E_AFFECTED_PORT) + 10, squatterCwd);
    await until(squatter, 'out', /SQUATTER-READY/);
    const run = watch(process.execPath, [e2eAffectedCli, 'apps/web/e2e/branch-button.spec.ts'], {
      env: fake.withFakePnpm(env),
    });
    assert.equal(await run.exited, 1);
    assert.ok(
      run.err.includes(
        `slot 2's port ${Number(env.E2E_AFFECTED_PORT) + 10} is held by pid ${squatter.child.pid}`,
      ),
      run.out + run.err,
    );
    assert.ok(run.err.includes(squatterCwd), run.out + run.err);
    assert.ok(!run.out.includes('FAKE-PLAYWRIGHT-RAN'));
    assert.equal(existsSync(fake.log), false);
    const next = startHolder(env);
    await until(next, 'out', /SLOT 2/, 5_000);
  } finally {
    cleanup();
  }
});

test('prepush-vitest run directly queues for a slot and only starts vitest once the holder exits', async () => {
  const { dir, env, cleanup } = sandbox(1);
  const { repo, withFakePnpm } = prepushVitestFixture(dir);
  try {
    const holder = startHolder(env);
    await until(holder, 'out', /SLOT 1/);
    const run = watch(process.execPath, ['scripts/prepush-vitest.mjs'], {
      cwd: repo,
      env: withFakePnpm(env),
    });
    await until(run, 'err', /queued, position 1/);
    assert.doesNotMatch(run.out + run.err, /FAKE-VITEST-RAN/);
    holder.child.kill('SIGKILL');
    await until(run, 'out', /FAKE-VITEST-RAN/, 5_000);
    assert.equal(await run.exited, 0);
    const next = startHolder(env);
    await until(next, 'out', /SLOT 1/, 5_000);
  } finally {
    cleanup();
  }
});

test('prepush-vitest reuses the lease inherited from pnpm prepush without queueing', async () => {
  const { dir, env, cleanup } = sandbox(1);
  const { repo, withFakePnpm } = prepushVitestFixture(dir);
  try {
    const holder = startHolder(env);
    await until(holder, 'out', /SLOT 1/);
    const inherited = withFakePnpm({
      ...env,
      CAIRN_HEAVY_SLOT: '1',
      CAIRN_HEAVY_SLOT_OWNER: String(holder.child.pid),
    });
    const run = watch(process.execPath, ['scripts/prepush-vitest.mjs'], {
      cwd: repo,
      env: inherited,
    });
    await until(run, 'out', /FAKE-VITEST-RAN/, 10_000);
    assert.doesNotMatch(run.err, /queued, position/);
    assert.equal(await run.exited, 0);
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
    await until(prepush, 'err', /queued, position 1/);
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

test('prepush reports a squatted slot port before running any check', async () => {
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
    const squatter = startSquatter(env, Number(env.E2E_AFFECTED_PORT), squatterCwd);
    await until(squatter, 'out', /SQUATTER-READY/);
    const prepush = watch(process.execPath, ['scripts/prepush.mjs'], {
      cwd: repo,
      env: { ...env, PREPUSH_BASE_SHA: 'origin/main' },
    });
    assert.equal(await prepush.exited, 1, prepush.out + prepush.err);
    assert.ok(
      prepush.err.includes(`is held by pid ${squatter.child.pid}`),
      prepush.out + prepush.err,
    );
    assert.ok(prepush.err.includes(squatterCwd), prepush.out + prepush.err);
    assert.doesNotMatch(prepush.out, /\[prepush\] node scripts/);
  } finally {
    cleanup();
  }
});
