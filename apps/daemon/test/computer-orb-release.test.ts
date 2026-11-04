import { mkdirSync, readdirSync, readlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { HostComputerProvider } from '../src/computer/host.js';
import { OrbComputerProvider } from '../src/computer/orb.js';
import { runOrbComputerAgent } from '../src/computer/orb-agent.js';
import { orbDistRelease } from '../src/orb/dist.js';
import { NspawnOrbProvider } from '../src/orb/provider.js';
import { createOrbCheckout } from './orb-dist-fixture.js';

const roots: string[] = [];
const cleanups: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup().catch(() => undefined);
  for (const root of roots.splice(0)) releaseTestTempDir(root);
});

async function setup(connectTimeoutMs = 10_000) {
  const root = makeTestTempDir('cr-');
  roots.push(root);
  const host = createOrbCheckout(root);
  const distRoot = join(root, 'dist');
  const seedRoot = join(root, 'seed');
  const runtime = join(root, 'run');
  const home = join(root, 'home');
  const machine = 'c1';
  for (const directory of [distRoot, seedRoot, home]) mkdirSync(directory);
  mkdirSync(join(runtime, machine), { recursive: true, mode: 0o700 });
  const worker = new NspawnOrbProvider({
    distRoot,
    seedRoot,
    runtimeRoot: runtime,
    distSource: host.distSource,
    runner: (argv, options) =>
      argv[0] === 'machinectl'
        ? Promise.resolve({ code: 0, stdout: '', stderr: '' })
        : host.runner(argv, options),
  });
  const orb = new OrbComputerProvider({
    orbs: { ensure: async () => machine, touch: () => {} },
    runtimeRoot: runtime,
    release: {
      publish: () => worker.publishRelease(),
      authenticated: (name, release) => worker.retainComputerRelease(name, release),
    },
    connectTimeoutMs,
  });
  cleanups.push(() => orb.close());
  return { ...host, root, distRoot, home, runtime, machine, worker, orb };
}

test('a fresh dist root with no worker step publishes on the first computer call, which authenticates and runs', async () => {
  const f = await setup();
  const { key } = await orbDistRelease(f.distSource, f.runner);
  const guest = runOrbComputerAgent({
    socketPath: join(f.runtime, f.machine, 'computer.sock'),
    release: key,
    provider: new HostComputerProvider({
      home: f.home,
      env: { PATH: process.env.PATH, HOME: f.home },
    }),
    heartbeatMs: 1_000,
  });
  cleanups.push(async () => {
    await f.orb.close();
    await guest.catch(() => undefined);
  });
  expect(readdirSync(f.distRoot)).toEqual([]);
  writeFileSync(join(f.home, 'a.txt'), 'hello');
  await expect(f.orb.forScope('chief:1').readFile('a.txt')).resolves.toBe('hello');
  expect(basename(readlinkSync(join(f.distRoot, 'current')))).toBe(key);
});

test('a guest on a release other than the published one is refused', async () => {
  const f = await setup(500);
  const guest = runOrbComputerAgent({
    socketPath: join(f.runtime, f.machine, 'computer.sock'),
    release: '1.0.0-abcd1234-dist-ffffffffffffffff',
    provider: new HostComputerProvider({ home: f.home }),
  });
  cleanups.push(async () => {
    await f.orb.close();
    await guest.catch(() => undefined);
  });
  await expect(f.orb.forScope('chief:1').listFiles('')).rejects.toThrow(/did not connect/);
  await expect(guest).resolves.toBe('stale-release');
});

test('pruning keeps the release a computer guest authenticated with', async () => {
  const f = await setup();
  const { key } = await orbDistRelease(f.distSource, f.runner);
  const guest = runOrbComputerAgent({
    socketPath: join(f.runtime, f.machine, 'computer.sock'),
    release: key,
    provider: new HostComputerProvider({
      home: f.home,
      env: { PATH: process.env.PATH, HOME: f.home },
    }),
    heartbeatMs: 1_000,
  });
  cleanups.push(async () => {
    await f.orb.close();
    await guest.catch(() => undefined);
  });
  await f.orb.forScope('chief:1').listFiles('');
  utimesSync(join(f.distRoot, 'releases', key), 1_000_000_000, 1_000_000_000);
  for (let index = 0; index < 4; index++) {
    const directory = join(f.distRoot, 'releases', `old-${index}`);
    mkdirSync(directory);
    utimesSync(directory, 2_000_000_000 + index, 2_000_000_000 + index);
  }
  writeFileSync(join(f.distSource, 'cli.mjs'), 'second build');
  await f.worker.publishRelease();
  writeFileSync(join(f.distSource, 'cli.mjs'), 'third build');
  const next = await f.worker.publishRelease();
  expect(next).not.toBe(key);
  const kept = readdirSync(join(f.distRoot, 'releases'));
  expect(kept).toContain(key);
  expect(kept).toContain(next);
  expect(kept).not.toContain('old-0');
});

test('a release only the previous publish held is pruned at the next one', async () => {
  const f = await setup();
  const first = await f.worker.publishRelease();
  utimesSync(join(f.distRoot, 'releases', first), 1_000_000_000, 1_000_000_000);
  for (let index = 0; index < 4; index++) {
    const directory = join(f.distRoot, 'releases', `old-${index}`);
    mkdirSync(directory);
    utimesSync(directory, 2_000_000_000 + index, 2_000_000_000 + index);
  }
  writeFileSync(join(f.distSource, 'cli.mjs'), 'second build');
  await f.worker.publishRelease();
  writeFileSync(join(f.distSource, 'cli.mjs'), 'third build');
  const third = await f.worker.publishRelease();
  const kept = readdirSync(join(f.distRoot, 'releases'));
  expect(kept).not.toContain(first);
  expect(kept).toContain(third);
});
