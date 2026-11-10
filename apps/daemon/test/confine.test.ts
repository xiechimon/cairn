import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { type ConfinementPolicy, confinementArgs } from '../src/backend/confine.js';
import { testTempDir } from './test-temp-dir.js';

const linuxProbes = process.platform === 'linux' && process.env.CAIRN_CONFINE_LINUX_PROBES === '1';
function fixture(): ConfinementPolicy {
  const root = testTempDir('confine-');
  const home = join(root, 'home');
  const daemonHome = join(home, '.cairn');
  const policy: ConfinementPolicy = {
    home,
    daemonHome,
    workspace: join(daemonHome, 'work'),
    gitDirectories: [join(daemonHome, 'git')],
    taskTemp: join(root, 'temp'),
    state: [join(home, '.codex')],
    caches: [join(home, '.cache')],
  };
  for (const path of [
    home,
    daemonHome,
    policy.workspace,
    policy.taskTemp,
    ...policy.gitDirectories,
    ...policy.state,
    ...policy.caches,
    join(home, '.ssh'),
  ])
    mkdirSync(path, { recursive: true });
  writeFileSync(join(home, '.ssh', 'sentinel'), 'secret');
  writeFileSync(join(home, '.netrc'), 'secret');
  writeFileSync(join(daemonHome, 'credentials'), 'secret');
  writeFileSync(join(policy.gitDirectories[0] as string, 'config'), 'protected');
  mkdirSync(join(policy.gitDirectories[0] as string, 'hooks'));
  return policy;
}

function run(policy: ConfinementPolicy, script: string, confined = true) {
  const args = confinementArgs(policy, 'linux');
  return spawnSync(
    confined ? 'bwrap' : '/bin/sh',
    confined
      ? [
          ...args,
          '--',
          '/bin/sh',
          '-c',
          script,
          'probe',
          policy.workspace,
          policy.home,
          policy.daemonHome,
          policy.gitDirectories[0] as string,
          policy.state[0] as string,
          policy.taskTemp,
        ]
      : [
          '-c',
          script,
          'probe',
          policy.workspace,
          policy.home,
          policy.daemonHome,
          policy.gitDirectories[0] as string,
          policy.state[0] as string,
          policy.taskTemp,
        ],
    { encoding: 'utf8' },
  );
}

test('refuses non-Linux instead of returning an unconfined command', () => {
  expect(() => confinementArgs(fixture(), 'darwin')).toThrow('Linux');
});

test('rejects a writable cache overlapping a denied credential tree', () => {
  const policy = fixture();
  policy.caches = [join(policy.home, '.ssh')];
  expect(() => confinementArgs(policy, 'linux')).toThrow('overlap');
});

test('rejects symlink mount sources before spawning', () => {
  const policy = fixture();
  symlinkSync(policy.workspace, join(policy.home, 'alias'));
  policy.workspace = join(policy.home, 'alias');
  expect(() => confinementArgs(policy, 'linux')).toThrow('symlink');
});

test('refuses rebinding the whole daemon home or an ancestor of secrets', () => {
  const policy = fixture();
  for (const workspace of [policy.daemonHome, policy.home, '/']) {
    for (const grant of [
      { workspace },
      { taskTemp: workspace },
      { gitDirectories: [workspace] },
      { state: [workspace] },
      { caches: [workspace] },
    ])
      expect(() => confinementArgs({ ...policy, ...grant }, 'linux')).toThrow('overlap');
  }
});

test('requires existing writable sources without creating absent secrets', () => {
  const policy = fixture();
  expect(() =>
    confinementArgs({ ...policy, taskTemp: join(policy.home, 'missing') }, 'linux'),
  ).toThrow();
  confinementArgs(policy, 'linux');
  expect(() => readFileSync(join(policy.home, '.git-credentials'))).toThrow();
});

test.runIf(linuxProbes)(
  'real bwrap: outside writes fail; nested workspace and private temp work',
  () => {
    const policy = fixture();
    const script = 'touch "$1/inside" "$6/inside" && ! touch "$2/outside"';
    expect(run(policy, script, false).status).toBe(1);
    const result = run(policy, script);
    expect(result.stderr).toContain('Read-only file system');
    expect(result.status, result.stderr).toBe(0);
  },
);

test.runIf(linuxProbes)(
  'real bwrap: credentials and daemon siblings are hidden after narrow rebind',
  () => {
    const policy = fixture();
    const script =
      '! cat "$2/.ssh/sentinel" && test ! -s "$2/.netrc" && ! cat "$3/credentials" && touch "$1/inside"';
    expect(run(policy, script, false).status).toBe(1);
    const result = run(policy, script);
    expect(result.status, result.stderr).toBe(0);
  },
);

test.runIf(linuxProbes)('real bwrap: writable git metadata cannot modify config or hooks', () => {
  const policy = fixture();
  const script =
    'touch "$4/objects-ok" && ! sh -c \'echo unsafe > "$1/config"\' probe "$4" && ! touch "$4/hooks/unsafe"';
  expect(run(policy, script, false).status).toBe(1);
  const result = run(policy, script);
  expect(result.status, result.stderr).toBe(0);
});

test.runIf(linuxProbes)('real bwrap: only the selected harness state is exposed', () => {
  const policy = fixture();
  for (const name of ['.claude', '.codex', '.pi', '.gemini']) {
    const path = join(policy.home, name);
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, 'sentinel'), name);
  }
  for (const name of ['.claude', '.codex', '.pi', '.gemini']) {
    policy.state = [join(policy.home, name)];
    const result = run(
      policy,
      `touch "$5/own" && ! cat "$2/${name === '.codex' ? '.claude' : '.codex'}/sentinel"`,
    );
    expect(result.status, result.stderr).toBe(0);
  }
});

test('bwrap argv preserves the fixed namespace policy without shell prefixes or environment overrides', () => {
  const policy = fixture();
  const args = confinementArgs(policy, 'linux');
  expect(args.slice(0, 15)).toEqual([
    '--die-with-parent',
    '--new-session',
    '--unshare-pid',
    '--ro-bind',
    '/',
    '/',
    '--dev-bind',
    '/dev',
    '/dev',
    '--proc',
    '/proc',
    '--tmpfs',
    '/tmp',
    '--tmpfs',
    join(policy.home, '.ssh'),
  ]);
  expect(args).not.toContain('--unshare-net');
  expect(args).not.toContain('--setenv');
  expect(args.indexOf('--bind')).toBeGreaterThan(args.indexOf('--tmpfs'));
});

test.runIf(linuxProbes)('real bwrap: host PID is not visible', () => {
  const policy = fixture();
  const result = run(policy, `test ! -e /proc/${process.pid}/status`);
  expect(result.status, result.stderr).toBe(0);
});

test('rejects denied descendants whose literal filename starts with two dots', () => {
  const policy = fixture();
  const cache = join(policy.home, '.ssh', '..keys');
  mkdirSync(cache);
  expect(() => confinementArgs({ ...policy, caches: [cache] }, 'linux')).toThrow('overlap');
});

test.runIf(linuxProbes)('real bwrap: absent git hooks and config remain unwritable', () => {
  const policy = fixture();
  rmSync(join(policy.gitDirectories[0] as string, 'hooks'), { recursive: true });
  rmSync(join(policy.gitDirectories[0] as string, 'config'));
  const result = run(
    policy,
    '! touch "$4/hooks/unsafe" && ! sh -c \'echo unsafe > "$1/config"\' probe "$4"',
  );
  expect(result.status, result.stderr).toBe(0);
});
