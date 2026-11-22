import { mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { contains } from '../src/backend/confine.js';
import { createSessionConfiner } from '../src/backend/confine-session.js';
import { testTempDir } from './test-temp-dir.js';

interface BatchSettings {
  sandbox: {
    filesystem: {
      denyRead: string[];
      allowRead: string[];
    };
  };
}

const settings = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../../scripts/ops/secret-reach/batch-sandbox.settings.json', import.meta.url),
    ),
    'utf8',
  ),
) as BatchSettings;

const expand = (entry: string, home: string) =>
  entry.startsWith('~/') ? join(home, entry.slice(2)) : entry;

function profilePaths(profile: string, prefix: string): string[] {
  return profile
    .split('\n')
    .filter((line) => line.startsWith(prefix))
    .flatMap((line) =>
      [...line.matchAll(/\((?:subpath|literal) "([^"]+)"\)/g)].map((m) => m[1] as string),
    );
}

function sessionProfile(home: string, daemonHome: string, readable: string[], handoff: string[]) {
  const worktree = join(daemonHome, 'workspaces', 'a');
  for (const path of [
    home,
    join(home, 'tmp', 'T'),
    join(home, '.config'),
    join(home, '.config', 'git'),
    daemonHome,
    worktree,
    `${daemonHome}-web-tools`,
    ...readable,
    ...handoff,
  ])
    mkdirSync(path, { recursive: true });
  const confine = createSessionConfiner({
    daemonHome,
    extraDeniedRoots: [],
    readable,
    handoffDirectories: handoff,
    serverUrl: 'http://127.0.0.1:1',
    platform: 'darwin',
    home,
    environment: { TMPDIR: join(home, 'tmp', 'T') },
  }) as NonNullable<ReturnType<typeof createSessionConfiner>>;
  const profile = confine({ cwd: worktree, env: {} }, 'claude-code', {
    command: '/bin/true',
    args: [],
  }).args[1] as string;
  return { profile, worktree: realpathSync(worktree) };
}

test('every batch denyRead entry is covered by a session profile deny', () => {
  const home = join(realpathSync(testTempDir('batch-parity-')), 'user');
  const daemonHome = join(home, '.cairn');
  const { profile } = sessionProfile(
    home,
    daemonHome,
    [join(daemonHome, 'tools')],
    [join(daemonHome, 'plans')],
  );
  const denied = profilePaths(profile, '(deny file-read* file-write*');
  const uncovered = settings.sandbox.filesystem.denyRead.filter(
    (entry) => !denied.some((deny) => contains(deny, expand(entry, home))),
  );
  expect(uncovered).toEqual([]);
});

test('every batch allowRead entry is covered by an allow in the session profile', () => {
  const home = join(realpathSync(testTempDir('batch-parity-')), 'user');
  const daemonHome = join(home, '.cairn');
  const { profile } = sessionProfile(
    home,
    daemonHome,
    [join(daemonHome, 'tools')],
    [join(daemonHome, 'plans')],
  );
  const allowed = [
    ...profilePaths(profile, '(allow file-read* file-write*'),
    ...profilePaths(profile, '(allow file-read* (subpath'),
  ];
  const desktopRunner = join(home, 'Library', 'Application Support', '@cairn', 'desktop', 'runner');
  const missing = settings.sandbox.filesystem.allowRead.filter((entry) => {
    const expanded = expand(entry, home);
    return (
      !allowed.some((allow) => contains(allow, expanded) || contains(expanded, allow)) &&
      !contains(desktopRunner, expanded) &&
      expanded !== `${desktopRunner}-web-tools`
    );
  });
  expect(missing).toEqual([]);
});

test('the desktop runner layout maps runner/workspaces and runner-web-tools the same way', () => {
  const home = join(realpathSync(testTempDir('batch-parity-')), 'user');
  const runner = join(home, 'Library', 'Application Support', '@cairn', 'desktop', 'runner');
  const { profile, worktree } = sessionProfile(home, runner, [], []);
  const writable = profilePaths(profile, '(allow file-read* file-write*');
  const readable = profilePaths(profile, '(allow file-read* (subpath');
  expect(writable.some((path) => contains(path, worktree))).toBe(true);
  expect(readable.some((path) => contains(path, realpathSync(`${runner}-web-tools`)))).toBe(true);
});
