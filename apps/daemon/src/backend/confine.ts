import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export interface ConfinementPolicy {
  home: string;
  daemonHome: string;
  workspace: string;
  gitDirectories: string[];
  taskTemp: string;
  state: string[];
  caches: string[];
}

const DENIED_DIRECTORIES = [
  '.ssh',
  '.gnupg',
  '.aws',
  '.config/gh',
  '.docker',
  '.kube',
  '.password-store',
  '.config/google-chrome',
  '.config/chromium',
  '.claude',
  '.codex',
  '.pi',
  '.gemini',
];
const DENIED_FILES = ['.netrc', '.git-credentials', '.claude.json'];

function contains(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function canonical(path: string, required = false): string {
  if (!isAbsolute(path) || resolve(path) !== path) throw new Error('Unsafe confinement path');
  let cursor = path;
  const missing: string[] = [];
  while (true) {
    try {
      if (lstatSync(cursor).isSymbolicLink()) throw new Error('Unsafe confinement symlink');
      break;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT') || required)
        throw error;
      missing.unshift(relative(dirname(cursor), cursor));
      cursor = dirname(cursor);
    }
  }
  if (realpathSync(cursor) !== cursor) throw new Error('Unsafe confinement symlink');
  return join(cursor, ...missing);
}

export function confinementArgs(
  policy: ConfinementPolicy,
  platform: string = process.platform,
): string[] {
  if (platform !== 'linux') throw new Error('Harness confinement requires Linux');
  const home = canonical(policy.home, true);
  const daemonHome = canonical(policy.daemonHome, true);
  const deniedDirectories = [...DENIED_DIRECTORIES.map((path) => join(home, path)), daemonHome];
  const deniedFiles = DENIED_FILES.map((path) => join(home, path));
  const denied = [...deniedDirectories, ...deniedFiles].map((path) => canonical(path));
  const writable = [
    policy.workspace,
    ...policy.gitDirectories,
    policy.taskTemp,
    ...policy.state,
    ...policy.caches,
  ].map((path) => canonical(path, true));
  for (const path of writable) {
    if (
      denied.some(
        (secret) =>
          contains(path, secret) &&
          !(path === secret && secret !== daemonHome && policy.state.includes(path)),
      )
    )
      throw new Error('Unsafe confinement overlap');
    if (
      denied.some((secret) => contains(secret, path)) &&
      !contains(daemonHome, path) &&
      !policy.state.includes(path)
    )
      throw new Error('Unsafe confinement overlap');
  }
  for (const path of policy.caches) {
    if (denied.some((secret) => contains(secret, path) || contains(path, secret)))
      throw new Error('Unsafe confinement cache overlap');
  }
  for (const path of policy.state) {
    if (
      denied.some((secret) => contains(secret, path)) &&
      !contains(daemonHome, path) &&
      !['.claude', '.codex', '.pi', '.gemini', '.claude.json'].some((name) =>
        contains(join(home, name), path),
      )
    )
      throw new Error('Unsafe confinement state overlap');
  }
  const args = [
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
  ];
  for (const path of deniedDirectories) {
    if (existsSync(path)) args.push('--tmpfs', path);
  }
  for (const path of writable) args.push('--bind', path, path);
  for (const path of deniedDirectories) {
    if (existsSync(path) && !policy.state.includes(path)) args.push('--remount-ro', path);
  }
  for (const path of [
    ...deniedFiles.filter((path) => !policy.state.includes(path)),
    '/run/dbus/system_bus_socket',
    '/run/systemd/private',
    `/run/user/${process.getuid?.()}/systemd/private`,
    `/run/user/${process.getuid?.()}/bus`,
  ]) {
    canonical(path);
    if (existsSync(path)) args.push('--ro-bind', '/dev/null', path);
  }
  for (const directory of policy.gitDirectories) {
    for (const name of ['config', 'config.worktree', 'hooks']) {
      const path = canonical(join(directory, name));
      if (name === 'hooks' && !existsSync(path)) args.push('--tmpfs', path, '--remount-ro', path);
      else args.push('--ro-bind', existsSync(path) ? path : '/dev/null', path);
    }
  }
  args.push('--chdir', policy.workspace);
  return args;
}
