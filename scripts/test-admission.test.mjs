import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { selectSpecs } from './e2e-affected-select.mjs';
import { makeTestTempDir, releaseTestTempDir } from './test-tmpdir.mjs';

const repo = resolve('.');
const require = createRequire(import.meta.url);
const runners = {
  vitest: join(require.resolve('vitest/package.json'), '../vitest.mjs'),
  playwright: join(require.resolve('@playwright/test/package.json'), '../cli.js'),
  node: undefined,
};
function deadPid(env) {
  const result = spawnSync(
    process.execPath,
    [
      '-e',
      'console.log(JSON.stringify({pid:process.pid,slots:process.env.CAIRN_HEAVY_SLOTS_DIR}))',
    ],
    { encoding: 'utf8', env },
  );
  const probe = JSON.parse(result.stdout);
  assert.equal(probe.slots, env.CAIRN_HEAVY_SLOTS_DIR);
  return String(probe.pid);
}
function fixture(t) {
  const root = makeTestTempDir('heavy-admission-');
  const children = [];
  t.after(async () => {
    for (const child of children) child.process.kill('SIGKILL');
    await Promise.all(children.map((child) => child.done));
    releaseTestTempDir(root);
  });
  mkdirSync(join(root, 'scripts'));
  for (const dir of ['apps/server', 'apps/web', 'apps/daemon', 'integration'])
    mkdirSync(join(root, dir), { recursive: true });
  for (const name of [
    'heavy-slots.mjs',
    'owned-process.mjs',
    'scrub-git-env.mjs',
    'vitest-timed-shard.mjs',
    'timed-partition.mjs',
    'vitest-shard-weights.json',
    'test-admission.mjs',
  ]) {
    if (existsSync(join(repo, 'scripts', name)))
      cpSync(join(repo, 'scripts', name), join(root, 'scripts', name));
  }
  cpSync('vitest.config.ts', join(root, 'vitest.config.ts'));
  symlinkSync(join(repo, 'node_modules'), join(root, 'node_modules'));
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  const packageDir = join(root, 'packages/shared');
  mkdirSync(join(packageDir, 'test'), { recursive: true });
  writeFileSync(join(packageDir, 'package.json'), '{"type":"module","name":"fixture"}');
  writeFileSync(
    join(packageDir, 'test/admission.test.ts'),
    `
import { test, expect } from 'vitest';
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
test('actual worker admission', async () => {
  if (process.env.DEAD_PID) {
    const lock = JSON.parse(readFileSync(process.env.CAIRN_HEAVY_SLOTS_DIR + '/slot-1.lock', 'utf8'));
    expect(lock.pid).not.toBe(Number(process.env.DEAD_PID));
  }
  writeFileSync(process.env.MARKER, 'started');
  while (!existsSync(process.env.RELEASE)) await sleep(20);
}, 30000);
`,
  );
  const env = {
    ...process.env,
    CAIRN_OWNED_MODE: 'group',
    CI: '',
    CAIRN_HEAVY_SLOTS: '1',
    CAIRN_HEAVY_SLOTS_DIR: join(root, 'locks'),
  };
  delete env.CAIRN_HEAVY_SLOT;
  delete env.CAIRN_HEAVY_SLOT_OWNER;
  mkdirSync(env.CAIRN_HEAVY_SLOTS_DIR);
  function start(args, extra = {}, cwd = root) {
    const [, runner, ...rest] = args;
    const child = spawn(process.execPath, runners[runner] ? [runners[runner], ...rest] : rest, {
      cwd,
      env: { ...env, MARKER: join(root, 'started'), RELEASE: join(root, 'release'), ...extra },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const watched = {
      process: child,
      output: '',
      closed: false,
      done: new Promise((done) => child.once('close', done)),
    };
    child.once('close', () => {
      watched.closed = true;
    });
    child.stdout.on('data', (chunk) => {
      watched.output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      watched.output += chunk;
    });
    children.push(watched);
    return watched;
  }
  const writeOwner = (owner = { pid: process.pid, cwd: root }) =>
    writeFileSync(join(env.CAIRN_HEAVY_SLOTS_DIR, 'slot-1.lock'), JSON.stringify(owner));
  const holder = () =>
    start([
      'exec',
      'node',
      'scripts/heavy-slots.mjs',
      'run',
      '--',
      process.execPath,
      '-e',
      'console.log("HOLDER");setInterval(()=>{},1000)',
    ]);
  return { root, env, start, writeOwner, holder };
}
async function until(child, check = () => /queued, position/.test(child.output)) {
  const deadline = Date.now() + 15_000;
  while (!check()) {
    assert.ok(!child.closed && Date.now() < deadline, `runner condition failed\n${child.output}`);
    await sleep(20);
  }
}
const vitestArgs = ['exec', 'vitest', 'run', 'admission.test.ts', '--maxWorkers=4'];
test('two direct Vitest runs serialize with one slot', async (t) => {
  const { root, start } = fixture(t);
  const release = join(root, 'release');
  const first = start(vitestArgs, { MARKER: join(root, 'first'), RELEASE: release });
  await until(first, () => existsSync(join(root, 'first')));
  const second = start(vitestArgs, { MARKER: join(root, 'second'), RELEASE: release });
  await until(
    second,
    () => /queued, position/.test(second.output) || existsSync(join(root, 'second')),
  );
  assert.equal(existsSync(join(root, 'second')), false);
  assert.match(second.output, /pid \d+, cwd /);
  writeFileSync(release, 'go');
  assert.equal(await first.done, 0, first.output);
  assert.equal(await second.done, 0, second.output);
});
test('direct Vitest reclaims a dead lease before starting its worker', async (t) => {
  const { root, env, start, writeOwner } = fixture(t);
  const dead = deadPid(env);
  writeOwner({ pid: Number(dead) });
  writeFileSync(join(root, 'release'), 'go');
  const run = start(vitestArgs, { DEAD_PID: dead });
  assert.equal(await run.done, 0, run.output);
  assert.equal(existsSync(join(root, 'started')), true);
  assert.equal(existsSync(join(env.CAIRN_HEAVY_SLOTS_DIR, 'slot-1.lock')), false);
});
test('CI with an existing directory queues instead of bypassing the holder', async (t) => {
  const { root, start, holder: startHolder } = fixture(t);
  const holder = startHolder();
  await until(holder, () => /HOLDER/.test(holder.output));
  const run = start(vitestArgs, { CI: 'true' });
  await until(run);
  assert.equal(existsSync(join(root, 'started')), false);
});
test('Playwright admission precedes webServer startup and spans the test run', async (t) => {
  const { root, start, env, writeOwner } = fixture(t);
  const web = join(root, 'apps/web');
  mkdirSync(join(web, 'e2e'), { recursive: true });
  for (const name of ['playwright.config.ts', 'package.json'])
    cpSync(join(repo, 'apps/web', name), join(web, name));
  const marker = join(root, 'server-started');
  writeFileSync(
    join(web, 'probe.config.ts'),
    `
import base from './playwright.config.ts';
export default { ...base, globalSetup: undefined, testDir: './e2e', webServer: {
 command: ${JSON.stringify(`${process.execPath} server.cjs`)}, url: 'http://127.0.0.1:0', timeout: 1000
} };
`,
  );
  writeFileSync(
    join(web, 'server.cjs'),
    `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started');setInterval(()=>{},1000);`,
  );
  writeFileSync(
    join(web, 'e2e/probe.spec.ts'),
    "import { test } from '@playwright/test'; test('probe', () => {});\n",
  );
  const dead = deadPid(env);
  writeOwner();
  const run = start(['exec', 'playwright', 'test', '--config=probe.config.ts'], {}, web);
  await until(run);
  assert.equal(existsSync(marker), false);
  writeOwner({ pid: Number(dead) });
  await until(run, () => existsSync(marker));
  assert.notEqual(await run.done, 0);
  assert.equal(existsSync(join(env.CAIRN_HEAVY_SLOTS_DIR, 'slot-1.lock')), false);
});
test('CI skips admission only for an absent slot directory', async (t) => {
  const { root, start } = fixture(t);
  const missing = join(root, 'absent');
  writeFileSync(join(root, 'release'), 'go');
  const run = start(vitestArgs, { CI: 'true', CAIRN_HEAVY_SLOTS_DIR: missing });
  assert.equal(await run.done, 0, run.output);
  assert.equal(existsSync(missing), false);
  assert.equal(existsSync(join(root, 'started')), true);
});
for (const [dir, config] of [
  ['packages/shared', 'vitest.config.ts'],
  ['apps/server', 'vitest.config.ts'],
  ['apps/web', 'vitest.config.ts'],
  ['apps/daemon', 'vitest.config.ts'],
  ['integration', 'vitest.config.ts'],
  ...['', '-live', '-trip', '-compare'].map((suffix) => [
    'apps/web',
    `playwright.pr-screens${suffix}.config.ts`,
  ]),
]) {
  test(`direct configuration admission: ${dir}/${config}`, async (t) => {
    const { root, start, writeOwner } = fixture(t);
    const cwd = join(root, dir);
    const source = join(repo, dir, config);
    if (existsSync(source)) cpSync(source, join(cwd, config));
    writeOwner();
    const args =
      config === 'vitest.config.ts'
        ? vitestArgs
        : ['exec', 'playwright', 'test', '--list', `--config=${config}`];
    await until(start(args, {}, cwd));
  });
}
test('parallel configuration module copies share one pending admission', async (t) => {
  const { root, start } = fixture(t);
  const run = start([
    'exec',
    'node',
    '--input-type=module',
    '-e',
    `
const [a, b] = await Promise.all([import('./scripts/test-admission.mjs?a'), import('./scripts/test-admission.mjs?b')]);
const [first, second] = await Promise.all([a.admitTestRun(), b.admitTestRun()]);
if (first !== second || first.owner !== process.pid) process.exit(1);
console.log('SHARED');
`,
  ]);
  assert.equal(await run.done, 0, run.output);
  assert.match(run.output, /SHARED/);
  assert.equal(existsSync(join(root, 'locks/slot-1.lock')), false);
});

for (const [suffix, defaults, overrides] of [
  ['', [8399], { E2E_PORT: '17399' }],
  ['-trip', [8399], { E2E_PORT: '17399' }],
  ['-live', [8442, 8444], { PR_SCREENS_EMPTY_PORT: '17441', PR_SCREENS_SEEDED_PORT: '17443' }],
]) {
  for (const custom of [false, true]) {
    test(`screenshot ${suffix || 'fixture'} ports follow concurrent leases (${custom ? 'custom' : 'default'})`, async (t) => {
      const { root, env, start } = fixture(t);
      env.CAIRN_HEAVY_SLOTS = '2';
      for (const key of ['E2E_PORT', 'PR_SCREENS_EMPTY_PORT', 'PR_SCREENS_SEEDED_PORT'])
        delete env[key];
      const config = `playwright.pr-screens${suffix}.config.ts`;
      cpSync(join(repo, 'apps/web', config), join(root, 'apps/web', config));
      const args = [
        'exec',
        'node',
        '--input-type=module',
        '-e',
        `
const { default: config } = await import('./apps/web/${config}');
const servers = [config.webServer].flat();
console.log('CONFIG ' + JSON.stringify(servers.map(({url, reuseExistingServer}) => ({port:Number(new URL(url).port),reuseExistingServer}))));
setInterval(() => {}, 1000);
`,
      ];
      const first = start(args, custom ? overrides : {});
      await until(first, () => /CONFIG /.test(first.output));
      const second = start(args, custom ? overrides : {});
      await until(second, () => /CONFIG /.test(second.output));
      const ports = custom ? defaults.map((port) => port + 9000) : defaults;
      for (const [index, run] of [first, second].entries()) {
        const servers = JSON.parse(run.output.match(/CONFIG (.+)/)[1]);
        assert.deepEqual(
          servers.map((server) => server.port),
          ports.map((port) => port + index * 10),
        );
        assert.ok(servers.every((server) => server.reuseExistingServer === false));
      }
    });
  }
}

test('a screenshot runner rejects a server already bound to its leased port', async (t) => {
  const { root, start } = fixture(t);
  const server = createServer((connection) =>
    connection.end('HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok'),
  );
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => server.close());
  const web = join(root, 'apps/web');
  cpSync(
    join(repo, 'apps/web/playwright.pr-screens.config.ts'),
    join(web, 'playwright.pr-screens.config.ts'),
  );
  mkdirSync(join(web, 'pr-screens'));
  writeFileSync(
    join(web, 'pr-screens/capture.shots.ts'),
    "import { test } from '@playwright/test'; test('probe', () => {});\n",
  );
  const run = start(
    ['exec', 'playwright', 'test', '-c', 'playwright.pr-screens.config.ts'],
    { E2E_PORT: String(server.address().port) },
    web,
  );
  assert.notEqual(await run.done, 0, run.output);
  assert.match(run.output, /already used/);
});

test('a forged inherited lease from an unrelated live process still queues', async (t) => {
  const { root, start, holder: startHolder } = fixture(t);
  const holder = startHolder();
  await until(holder, () => /HOLDER/.test(holder.output));
  const run = start(vitestArgs, {
    CAIRN_HEAVY_SLOT: '1',
    CAIRN_HEAVY_SLOT_OWNER: String(holder.process.pid),
  });
  await until(run);
  assert.equal(existsSync(join(root, 'started')), false);
});

test('a descendant reuses a live lease held by container PID 1', {
  skip: process.platform !== 'linux',
}, async (t) => {
  const { root, start, writeOwner } = fixture(t);
  const probe = join(root, 'init.sock');
  const server = createServer((connection) => connection.end());
  await new Promise((done) => server.listen(probe, done));
  t.after(() => server.close());
  writeOwner({ pid: 1, cwd: root, probe });
  writeFileSync(
    join(root, 'init-ancestry.mjs'),
    `
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const read = fs.readFileSync;
fs.readFileSync = (path, ...args) => {
  const text = read(path, ...args);
  if (path !== '/proc/' + process.pid + '/stat') return text;
  return text.replace(/^(.*\\) \\S+ )\\d+/, (_, prefix) => prefix + '1');
};
syncBuiltinESMExports();
`,
  );
  const run = start(
    [
      'exec',
      'node',
      '--import=./init-ancestry.mjs',
      '--input-type=module',
      '-e',
      `
import assert from 'node:assert/strict';
import { acquireSlot } from './scripts/heavy-slots.mjs';
const lease = await acquireSlot({ wait: false });
assert.equal(lease?.owner, 1);
lease.release();
`,
    ],
    { CAIRN_HEAVY_SLOT: '1', CAIRN_HEAVY_SLOT_OWNER: '1' },
  );
  assert.equal(await run.done, 0, run.output);
});

test('admission helper selects every e2e spec when it changes', () => {
  const result = selectSpecs({
    paths: ['scripts/test-admission.mjs'],
    allSpecs: ['one.spec.ts', 'two.spec.ts'],
    workspace: () => () => null,
  });
  assert.equal(result.full, true);
  assert.deepEqual(result.selection, ['one.spec.ts', 'two.spec.ts']);
});

for (const kind of ['slot', 'ticket']) {
  test(`foreign namespace ${kind} stays live through its socket`, async (t) => {
    const { root, env, start } = fixture(t);
    const socket = join(root, 'probe.sock');
    const server = createServer((connection) => connection.end());
    await new Promise((done) => server.listen(socket, done));
    t.after(() => server.close());
    const dead = Number(deadPid(env));
    const path = join(
      env.CAIRN_HEAVY_SLOTS_DIR,
      kind === 'slot' ? 'slot-1.lock' : `queue-000000000000001-${String(dead).padStart(10, '0')}`,
    );
    writeFileSync(
      path,
      JSON.stringify({
        pid: dead,
        cwd: root,
        namespace: 'foreign',
        probe: socket,
        token: 'foreign',
      }),
    );
    writeFileSync(join(root, 'release'), 'go');
    const run = start(vitestArgs);
    await until(run);
    assert.equal(existsSync(join(root, 'started')), false);
    unlinkSync(path);
    assert.equal(await run.done, 0, run.output);
  });
}
