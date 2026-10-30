import { execFileSync, spawnSync } from 'node:child_process';
import {
  accessSync,
  constants,
  copyFileSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { runWorkspaceHook } from '../src/workspace-hooks.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const husky = join(repo, 'node_modules/husky/bin.js');
const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) releaseTestTempDir(root);
});

function fixture(overrides: NodeJS.ProcessEnv = {}, stubs = ['corepack', 'pnpm', 'git']) {
  const allocated = makeTestTempDir('agents-setup-');
  roots.push(allocated);
  const root = realpathSync(allocated);
  const clone = join(root, 'clone');
  const bin = join(root, 'bin');
  const home = join(root, 'home with spaces');
  const log = join(root, 'commands.jsonl');
  mkdirSync(bin);
  mkdirSync(home);
  const env = {
    ...process.env,
    HOME: home,
    HUSKY: '1',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'Setup Test',
    GIT_AUTHOR_EMAIL: 'setup@example.com',
    GIT_COMMITTER_NAME: 'Setup Test',
    GIT_COMMITTER_EMAIL: 'setup@example.com',
    CAIRN_TEST_LOG: log,
    CAIRN_TEST_HUSKY: husky,
    CAIRN_TEST_GIT: realGit,
    ...overrides,
  };
  execFileSync(realGit, ['clone', '--shared', '--quiet', '--sparse', repo, clone], { env });
  execFileSync(realGit, ['sparse-checkout', 'set', '.agents', '.husky'], { cwd: clone, env });
  mkdirSync(join(clone, '.agents'), { recursive: true });
  for (const name of ['setup', 'resume']) {
    copyFileSync(join(repo, '.agents', name), join(clone, '.agents', name));
  }
  execFileSync(realGit, ['add', '.agents/setup', '.agents/resume'], { cwd: clone, env });
  execFileSync(realGit, ['commit', '--quiet', '--allow-empty', '-m', 'ops(2276): setup fixture'], {
    cwd: clone,
    env,
  });
  writeFileSync(log, '');
  for (const name of stubs) {
    writeFileSync(
      join(bin, name),
      String.raw`#!${process.execPath}
import { spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync } from 'node:fs';
const command = ${JSON.stringify(name)};
const args = process.argv.slice(2);
if (command === 'git' && args[0] !== 'fetch') {
  const result = spawnSync(process.env.CAIRN_TEST_GIT, args, { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}
appendFileSync(process.env.CAIRN_TEST_LOG, JSON.stringify({
  command, args, cwd: process.cwd(), browsers: process.env.PLAYWRIGHT_BROWSERS_PATH,
}) + '\n');
if (command === 'git') {
  if (process.env.CAIRN_TEST_FETCH_GRANDCHILD) {
    spawnSync('sh', ['-c', 'sleep 30 &'], { stdio: 'inherit' });
    if (process.env.CAIRN_TEST_FETCH_GRANDCHILD === 'hang') Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    process.exit(0);
  }
  if (process.env.CAIRN_TEST_FETCH_HANG === '1') Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  process.exit(Number(process.env.CAIRN_TEST_FETCH_EXIT || 0));
}
if (command === 'corepack') process.exit(Number(process.env.CAIRN_TEST_COREPACK_EXIT || 0));
if (args[0] === 'install') process.exit(Number(process.env.CAIRN_TEST_INSTALL_EXIT || 0));
if (args.join(' ') === 'exec husky') {
  if (process.env.CAIRN_TEST_SKIP_HUSKY === '1') process.exit(0);
  const result = spawnSync(process.execPath, [process.env.CAIRN_TEST_HUSKY], { stdio: 'inherit' });
  if (result.status) process.exit(result.status);
  if (process.env.CAIRN_TEST_HOOK_MODE === '644') chmodSync('.husky/_/pre-push', 0o644);
  process.exit(0);
}
if (args.join(' ') === 'exec playwright install chromium') process.exit(Number(process.env.CAIRN_TEST_BROWSER_EXIT || 0));
process.exit(1);
`,
      { mode: 0o755 },
    );
  }
  const runEnv: NodeJS.ProcessEnv = {
    ...env,
    PATH: stubs.includes('corepack') ? `${bin}:${process.env.PATH}` : `${bin}:/usr/bin:/bin`,
  };
  return {
    clone,
    home,
    runEnv,
    run(name: string) {
      return spawnSync(join(clone, '.agents', name), [], {
        cwd: home,
        env: runEnv,
        encoding: 'utf8',
        timeout: 12_000,
      });
    },
    commands() {
      return readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(
          (line) =>
            JSON.parse(line) as {
              command: string;
              args: string[];
              cwd: string;
              browsers?: string;
            },
        );
    },
    status() {
      return execFileSync(realGit, ['status', '--porcelain'], {
        cwd: clone,
        env,
        encoding: 'utf8',
      });
    },
  };
}

test('setup is executable, installs real hooks twice in a fresh clone and leaves it clean', () => {
  accessSync(join(repo, '.agents/setup'), constants.X_OK);
  const f = fixture({ PLAYWRIGHT_BROWSERS_PATH: '/unused-cache' });
  for (let run = 0; run < 2; run += 1) {
    const result = f.run('setup');
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    accessSync(join(f.clone, '.husky/_/pre-push'), constants.X_OK);
    expect(f.status()).toBe('');
  }
  const commands = f.commands();
  expect(commands.map(({ command, args }) => [command, ...args])).toEqual(
    Array.from({ length: 2 }, () => [
      ['corepack', 'enable'],
      ['pnpm', 'install', '--frozen-lockfile'],
      ['pnpm', 'exec', 'husky'],
      ['pnpm', 'exec', 'playwright', 'install', 'chromium'],
    ]).flat(),
  );
  expect(commands.every(({ cwd }) => cwd === f.clone)).toBe(true);
  expect(
    commands.filter(({ args }) => args.includes('playwright')).map(({ browsers }) => browsers),
  ).toEqual(Array(2).fill(join(f.home, '.cache/ms-playwright')));
});

test('setup skips corepack when the Node runtime no longer ships it', () => {
  const f = fixture({ PLAYWRIGHT_BROWSERS_PATH: '/unused-cache' }, ['pnpm', 'git']);
  const result = f.run('setup');
  expect(result.status, result.stderr).toBe(0);
  expect(f.commands().map(({ command, args }) => [command, ...args])).toEqual([
    ['pnpm', 'install', '--frozen-lockfile'],
    ['pnpm', 'exec', 'husky'],
    ['pnpm', 'exec', 'playwright', 'install', 'chromium'],
  ]);
});

test('setup contains no backgrounding or server launch commands', () => {
  const result = spawnSync(
    'grep',
    ['-En', '&|nohup|setsid|pnpm dev', join(repo, '.agents/setup')],
    {
      encoding: 'utf8',
    },
  );
  expect(result.status, result.stdout + result.stderr).toBe(1);
});

test.each([
  { CAIRN_TEST_COREPACK_EXIT: '2' },
  { CAIRN_TEST_INSTALL_EXIT: '3' },
  { CAIRN_TEST_SKIP_HUSKY: '1' },
  { CAIRN_TEST_HOOK_MODE: '644' },
  { CAIRN_TEST_BROWSER_EXIT: '4' },
])('setup fails rather than reporting incomplete setup as ready: %j', (env) => {
  const f = fixture(env);
  expect(f.run('setup').status).toBeGreaterThan(0);
});

test.each([
  {},
  { CAIRN_TEST_FETCH_EXIT: '2' },
  { CAIRN_TEST_INSTALL_EXIT: '3' },
  { CAIRN_TEST_FETCH_EXIT: '2', CAIRN_TEST_INSTALL_EXIT: '3' },
])('resume fetches and installs offline without blocking the session: %j', (env) => {
  const f = fixture(env);
  const start = performance.now();
  const result = f.run('resume');
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(performance.now() - start).toBeLessThan(10_000);
  expect(f.commands().map(({ command, args, cwd }) => ({ command, args, cwd }))).toEqual([
    { command: 'git', args: ['fetch'], cwd: f.clone },
    { command: 'pnpm', args: ['install', '--frozen-lockfile', '--offline'], cwd: f.clone },
  ]);
  expect(f.status()).toBe('');
});

test('resume stops a stalled fetch within the shared ten-second budget and exits zero', () => {
  const f = fixture({ CAIRN_TEST_FETCH_HANG: '1' });
  const start = performance.now();
  const result = f.run('resume');
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(performance.now() - start).toBeLessThan(10_000);
  expect(f.commands().map(({ command }) => command)).toEqual(['git']);
}, 15_000);

test.each(['exit', 'hang'])(
  'resume through the real hook runner finishes in budget when fetch leaves a grandchild holding the output pipe (%s)',
  async (mode) => {
    const f = fixture({ CAIRN_TEST_FETCH_GRANDCHILD: mode });
    for (const [key, value] of Object.entries(f.runEnv)) vi.stubEnv(key, value);
    try {
      const note = await runWorkspaceHook({
        cwd: f.clone,
        name: 'resume',
        credentials: null,
        timeoutMs: 30_000,
        log: () => {},
      });
      expect(note?.status).toBe('ok');
      expect(note?.ms).toBeLessThan(10_000);
    } finally {
      vi.unstubAllEnvs();
    }
  },
  35_000,
);
