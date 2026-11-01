import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { build } from 'esbuild';
import { afterEach, expect, test, vi } from 'vitest';
import { NspawnOrbProvider, type OrbCommandRunner } from '../src/orb/provider.js';
import { boot, CLAIMED, FakeMachineApi, waitFor } from './machine-loop-harness.js';
import { createOrbCheckout } from './orb-dist-fixture.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(wrap?: (runner: OrbCommandRunner) => OrbCommandRunner) {
  const root = mkdtempSync(join(tmpdir(), 'orb-dist-'));
  roots.push(root);
  const host = createOrbCheckout(root);
  const distRoot = join(root, 'dist');
  const seedRoot = join(root, 'seed');
  mkdirSync(distRoot);
  mkdirSync(seedRoot);
  const distRunner = wrap ? wrap(host.runner) : host.runner;
  const provider = new NspawnOrbProvider({
    distRoot,
    seedRoot,
    distSource: host.distSource,
    runner: (argv, options) =>
      argv[0] === 'machinectl'
        ? Promise.resolve({ code: 0, stdout: '', stderr: '' })
        : distRunner(argv, options),
  });
  const prepare = async () =>
    provider.prepare(await provider.ensure({ conversationId: 'thread', projectId: 'project' }));
  return { ...host, root, distRoot, provider, prepare };
}

test('publishes the running checkout build and resolves production dependencies through the stable entry', async () => {
  const f = fixture();
  writeFileSync(join(f.distSource, 'cli.mjs'), "import sha from 'host-build'; console.log(sha);");
  await f.prepare();
  const key = basename(readlinkSync(join(f.distRoot, 'current')));
  expect(key).toMatch(new RegExp(`^0\\.2\\.2-${f.sha}-dist-[a-f0-9]{16}$`));
  expect(readlinkSync(join(f.distRoot, 'current'))).toBe(`releases/${key}`);
  expect(readlinkSync(join(f.distRoot, 'cli.mjs'))).toBe('current/dist/cli.mjs');
  expect(JSON.parse(readFileSync(join(f.distRoot, 'current.json'), 'utf8'))).toEqual({
    key,
    version: '0.2.2',
    sha: f.sha,
  });
  expect(
    execFileSync(process.execPath, [join(f.distRoot, 'cli.mjs')], { encoding: 'utf8' }).trim(),
  ).toBe(f.sha);
  expect(f.deployments).toHaveLength(1);
});

test('reuses an identical release key without another deploy or replacing immutable files', async () => {
  const f = fixture();
  await f.prepare();
  const entry = join(f.distRoot, 'cli.mjs');
  const inode = statSync(entry).ino;
  await f.prepare();
  expect(f.deployments).toHaveLength(1);
  expect(statSync(entry).ino).toBe(inode);
  expect(readdirSync(join(f.distRoot, 'releases'))).toEqual([
    basename(readlinkSync(join(f.distRoot, 'current'))),
  ]);
});

test('dirty keys reflect staged, unstaged, deleted and untracked content and are reusable', async () => {
  const f = fixture();
  await f.prepare();
  const keys = new Set([readlinkSync(join(f.distRoot, 'current'))]);
  for (const content of ['second', 'third']) {
    writeFileSync(join(f.checkout, 'source.txt'), content);
    await f.prepare();
    const key = readlinkSync(join(f.distRoot, 'current'));
    expect(key).toMatch(
      new RegExp(`^releases/0\\.2\\.2-${f.sha}-dist-[a-f0-9]{16}-dirty-[a-f0-9]+$`),
    );
    keys.add(key);
  }
  const unstaged = readlinkSync(join(f.distRoot, 'current'));
  execFileSync('git', ['-C', f.checkout, 'add', 'source.txt']);
  await f.prepare();
  expect(readlinkSync(join(f.distRoot, 'current'))).toBe(unstaged);
  writeFileSync(join(f.checkout, 'extra.txt'), 'untracked');
  await f.prepare();
  keys.add(readlinkSync(join(f.distRoot, 'current')));
  rmSync(join(f.checkout, 'source.txt'));
  await f.prepare();
  keys.add(readlinkSync(join(f.distRoot, 'current')));
  expect(keys.size).toBeGreaterThanOrEqual(5);
  const count = f.deployments.length;
  await f.prepare();
  expect(f.deployments).toHaveLength(count);
  expect(readdirSync(join(f.distRoot, 'releases'))).toHaveLength(3);
}, 30_000);

test('keeps current and metadata intact while a new release is being deployed', async () => {
  let inspect = () => {};
  const f = fixture((runner) => async (argv, options) => {
    if (argv[0] === 'pnpm') inspect();
    return runner(argv, options);
  });
  await f.prepare();
  const previous = readlinkSync(join(f.distRoot, 'current'));
  const metadata = readFileSync(join(f.distRoot, 'current.json'), 'utf8');
  inspect = () => {
    expect(readlinkSync(join(f.distRoot, 'current'))).toBe(previous);
    expect(readFileSync(join(f.distRoot, 'cli.mjs'), 'utf8')).toBe('first');
    expect(readFileSync(join(f.distRoot, 'current.json'), 'utf8')).toBe(metadata);
    expect(readdirSync(join(f.distRoot, 'releases'))).toEqual([
      basename(readlinkSync(join(f.distRoot, 'current'))),
    ]);
  };
  writeFileSync(join(f.checkout, 'source.txt'), 'second');
  writeFileSync(join(f.distSource, 'cli.mjs'), 'second');
  await f.prepare();
  expect(readFileSync(join(f.distRoot, 'cli.mjs'), 'utf8')).toBe('second');
  expect(readdirSync(f.distRoot).some((name) => name.startsWith('.'))).toBe(false);
});

test('prunes releases beyond the newest three while preserving an older current release', async () => {
  const f = fixture();
  await f.prepare();
  const current = basename(readlinkSync(join(f.distRoot, 'current')));
  for (let index = 0; index < 5; index++) {
    const directory = join(f.distRoot, 'releases', `old-${index}`);
    mkdirSync(directory);
    utimesSync(directory, 2_000_000_000 + index, 2_000_000_000 + index);
  }
  await f.prepare();
  expect(readdirSync(join(f.distRoot, 'releases')).sort()).toEqual(
    [current, 'old-2', 'old-3', 'old-4'].sort(),
  );
  expect(readFileSync(join(f.distRoot, 'cli.mjs'), 'utf8')).toBe('first');
});

test.each(['exit', 'stdout', 'timeout'] as const)(
  'pnpm deploy %s preserves the last release and never falls back to a registry install',
  async (kind) => {
    let fail = false;
    const f = fixture((runner) => async (argv, options) => {
      if (fail && argv[0] === 'pnpm') {
        if (kind === 'timeout') throw new DOMException('Timed out', 'TimeoutError');
        return {
          code: 1,
          stdout: kind === 'stdout' ? 'offline store missing' : '',
          stderr: kind === 'exit' ? 'offline store missing' : '',
        };
      }
      return runner(argv, options);
    });
    await f.prepare();
    const previous = readlinkSync(join(f.distRoot, 'current'));
    fail = true;
    writeFileSync(join(f.checkout, 'source.txt'), 'new');
    await expect(f.prepare()).rejects.toThrow(
      kind === 'timeout'
        ? /pnpm deploy timed out after 600 seconds/
        : /pnpm deploy.*offline store missing/,
    );
    expect(readlinkSync(join(f.distRoot, 'current'))).toBe(previous);
    expect(readFileSync(join(f.distRoot, 'cli.mjs'), 'utf8')).toBe('first');
    expect(readdirSync(f.distRoot).some((name) => name.startsWith('.'))).toBe(false);
    expect(existsSync(join(f.distRoot, previous, 'node_modules'))).toBe(true);
  },
);

test('pnpm deploy failure is reported as the orb step failure before machine start', async () => {
  const f = fixture(
    (runner) => async (argv, options) =>
      argv[0] === 'pnpm'
        ? { code: 1, stdout: '', stderr: 'offline store missing' }
        : runner(argv, options),
  );
  const api = new FakeMachineApi();
  api.claimQueue.push(CLAIMED);
  const { handle } = await boot({
    api,
    orbProvider: f.provider,
    capEnv: { CAIRN_EXECUTOR: 'orb' },
  });
  try {
    await waitFor(() => api.doneBodies.length === 1);
    expect(api.doneBodies[0]?.body).toMatchObject({
      status: 'failed',
      errorMessage: expect.stringMatching(/pnpm deploy.*offline store missing/),
    });
  } finally {
    await handle.stop();
    await handle.done;
  }
});

test('compiled provider locates its own checkout when launched from another working directory', async () => {
  const f = fixture();
  await build({
    entryPoints: [resolve('apps/daemon/src/orb/provider.ts')],
    outfile: join(f.distSource, 'cli.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
  });
  const probe = join(f.root, 'probe.mjs');
  writeFileSync(
    probe,
    `
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { NspawnOrbProvider, runOrbCommand } from './checkout/apps/daemon/dist/cli.mjs';
const provider = new NspawnOrbProvider({
  distRoot: ${JSON.stringify(f.distRoot)},
  seedRoot: ${JSON.stringify(join(f.root, 'seed'))},
  runner: async (argv, options) => {
    if (argv[0] === 'git') return runOrbCommand(argv, options);
    if (argv[0] === 'pnpm') {
      if (argv[2] !== ${JSON.stringify(realpathSync(f.checkout))} || argv[3] !== 'deploy' || !argv.includes('--prefer-offline')) throw new Error('Wrong checkout or registry install');
      mkdirSync(join(argv.at(-1), 'node_modules'));
    } else if (argv[0] !== 'machinectl') throw new Error('Registry install');
    return { code: 0, stdout: '', stderr: '' };
  },
});
await provider.prepare(await provider.ensure({ conversationId: 'thread', projectId: 'project' }));
`,
  );
  execFileSync(process.execPath, [probe], { cwd: f.root, timeout: 10_000 });
  expect(JSON.parse(readFileSync(join(f.distRoot, 'current.json'), 'utf8'))).toEqual({
    key: expect.stringMatching(new RegExp(`^0\\.2\\.2-${f.sha}-dist-[a-f0-9]{16}$`)),
    version: '0.2.2',
    sha: f.sha,
  });
  expect(readFileSync(join(f.distRoot, 'cli.mjs'), 'utf8')).toBe(
    readFileSync(join(f.distSource, 'cli.mjs'), 'utf8'),
  );
}, 30_000);

test('checkout fake rejects registry installs and commands targeting another checkout', async () => {
  const f = fixture();
  await expect(f.runner(['npm', 'install', '@xiechimon/cairn-cli'])).rejects.toThrow(
    'Registry install',
  );
  await expect(f.runner(['git', '-C', f.root, 'rev-parse', '--short', 'HEAD'])).rejects.toThrow(
    'Wrong host checkout',
  );
  await expect(
    f.runner([
      'pnpm',
      '--dir',
      f.root,
      'deploy',
      '--filter',
      '@xiechimon/cairn-cli',
      '--prod',
      '--prefer-offline',
      join(f.root, 'wrong'),
    ]),
  ).rejects.toThrow('Deploy must use the host checkout');
});

test('deployment disables lifecycle scripts in the installed pnpm configuration', async () => {
  const f = fixture((runner) => async (argv, options) => {
    if (argv[0] === 'pnpm') {
      const setting = execFileSync('pnpm', ['config', 'get', 'ignore-scripts'], {
        env: options?.env,
        encoding: 'utf8',
      });
      expect(setting.trim()).toBe('true');
    }
    return runner(argv, options);
  });
  await f.prepare();
});

test('a pull without rebuilding followed by a rebuild publishes distinct built content', async () => {
  const f = fixture();
  await f.prepare();
  writeFileSync(join(f.checkout, 'source.txt'), 'new source');
  execFileSync('git', ['-C', f.checkout, 'add', 'source.txt']);
  execFileSync('git', [
    '-C',
    f.checkout,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.test',
    'commit',
    '-m',
    'New source',
  ]);
  await f.prepare();
  const pulled = readlinkSync(join(f.distRoot, 'current'));
  expect(readFileSync(join(f.distRoot, 'cli.mjs'), 'utf8')).toBe('first');
  writeFileSync(join(f.distSource, 'cli.mjs'), 'rebuilt');
  await f.prepare();
  expect(readlinkSync(join(f.distRoot, 'current'))).not.toBe(pulled);
  expect(readFileSync(join(f.distRoot, 'cli.mjs'), 'utf8')).toBe('rebuilt');
  expect(readFileSync(join(f.distRoot, pulled, 'dist/cli.mjs'), 'utf8')).toBe('first');
  expect(f.deployments).toHaveLength(3);
});

test('a rebuild at the same HEAD hashes nested dist files without git-visible changes', async () => {
  const f = fixture();
  mkdirSync(join(f.distSource, 'assets'));
  writeFileSync(join(f.distSource, 'assets/worker.mjs'), 'first');
  await f.prepare();
  const previous = readlinkSync(join(f.distRoot, 'current'));
  writeFileSync(join(f.distSource, 'assets/worker.mjs'), 'other');
  await f.prepare();
  expect(readlinkSync(join(f.distRoot, 'current'))).not.toBe(previous);
  expect(readFileSync(join(f.distRoot, 'current/dist/assets/worker.mjs'), 'utf8')).toBe('other');
  expect(f.deployments).toHaveLength(2);
});

test('deploy allows 600 seconds for cross-filesystem copies and reports signal abort duration', async () => {
  const original = AbortSignal.timeout.bind(AbortSignal);
  const timeout = vi.spyOn(AbortSignal, 'timeout');
  const controller = new AbortController();
  try {
    const f = fixture((runner) => async (argv, options) => {
      if (argv[0] === 'pnpm') {
        expect(timeout).toHaveBeenLastCalledWith(600_000);
        controller.abort(new DOMException('Deadline reached', 'TimeoutError'));
        throw new DOMException('The operation was aborted', 'AbortError');
      }
      return runner(argv, options);
    });
    timeout.mockImplementation((milliseconds) =>
      milliseconds === 600_000 ? controller.signal : original(milliseconds),
    );
    await expect(f.prepare()).rejects.toThrow('Orb pnpm deploy timed out after 600 seconds');
  } finally {
    timeout.mockRestore();
  }
});
