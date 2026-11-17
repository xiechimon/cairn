import { join } from 'node:path';
import { canonical, contains, DENIED_DIRECTORIES, DENIED_FILES } from './confine.js';

export const SANDBOX_EXEC = '/usr/bin/sandbox-exec';

const MAC_DENIED_DIRECTORIES = [
  'Library/Keychains',
  'Library/Application Support/Google/Chrome',
  'Library/Application Support/Chromium',
  'Library/Application Support/Firefox',
  'Library/Safari',
  'Library/Cookies',
  'Library/Mail',
  'Library/Messages',
];
const OWN_STATE_NAMES = ['.claude', '.codex', '.pi', '.gemini', '.claude.json'];
const DEVICE_WRITES = ['/dev/null', '/dev/dtracehelper'];

const LAUNCH_SERVICE_DENIALS = [
  '(deny mach-lookup (global-name-prefix "com.apple.coreservices") (global-name-prefix "com.apple.lsd"))',
];

export interface SeatbeltPolicy {
  home: string;
  deniedRoots: string[];
  workspace: string;
  gitDirectories: string[];
  taskTemp: string;
  state: string[];
  caches: string[];
  readable?: string[];
  serverPort?: number;
}

function quoted(path: string): string {
  if (/["\\\n\r\0]/.test(path)) throw new Error('Unsafe seatbelt path');
  return `"${path}"`;
}

function subpaths(paths: string[]): string {
  return paths.map((path) => `(subpath ${quoted(path)})`).join(' ');
}

export function seatbeltProfile(policy: SeatbeltPolicy): string {
  const home = canonical(policy.home, true);
  const deniedRoots = policy.deniedRoots.map((path) => canonical(path));
  const deniedDirectories = [
    ...deniedRoots,
    ...[...DENIED_DIRECTORIES, ...MAC_DENIED_DIRECTORIES].map((path) =>
      canonical(join(home, path)),
    ),
  ];
  const deniedFiles = DENIED_FILES.map((path) => canonical(join(home, path)));
  const state = policy.state.map((path) => canonical(path, true));
  const readable = (policy.readable ?? []).map((path) => canonical(path, true));
  const reexposed = [
    canonical(policy.workspace, true),
    ...policy.gitDirectories.map((path) => canonical(path, true)),
    ...state,
  ];
  const writable = [
    ...reexposed,
    canonical(policy.taskTemp, true),
    ...policy.caches.map((path) => canonical(path, true)),
  ];
  const everythingDenied = [...deniedDirectories, ...deniedFiles];
  for (const path of writable) {
    if (everythingDenied.some((secret) => contains(path, secret) && path !== secret))
      throw new Error('Unsafe confinement overlap');
  }
  for (const path of policy.caches.map((value) => canonical(value))) {
    if (everythingDenied.some((secret) => contains(secret, path) || contains(path, secret)))
      throw new Error('Unsafe confinement cache overlap');
  }
  for (const path of state) {
    const own = OWN_STATE_NAMES.some((name) => contains(join(home, name), path));
    const insideRoot = deniedRoots.some((root) => contains(root, path));
    if (everythingDenied.some((secret) => contains(secret, path)) && !own && !insideRoot)
      throw new Error('Unsafe confinement state overlap');
  }
  const protectedGit = policy.gitDirectories.flatMap((directory) =>
    ['config', 'config.worktree', 'hooks'].map((name) => canonical(join(directory, name))),
  );
  const workspaceGit = canonical(join(policy.workspace, '.git'));
  const lines = [
    '(version 1)',
    '(allow default)',
    '(deny file-write*)',
    `(allow file-write* ${subpaths(writable)} ${DEVICE_WRITES.map((path) => `(literal ${quoted(path)})`).join(' ')} (regex #"^/dev/tty") (subpath "/dev/fd"))`,
    `(deny file-read* file-write* ${subpaths(deniedDirectories)} ${deniedFiles.map((path) => `(literal ${quoted(path)})`).join(' ')})`,
    `(allow file-read* file-write* ${subpaths(reexposed)})`,
    ...(readable.length > 0 ? [`(allow file-read* ${subpaths(readable)})`] : []),
    `(deny file-write* ${subpaths(protectedGit)} (literal ${quoted(workspaceGit)}))`,
    ...LAUNCH_SERVICE_DENIALS,
  ];
  if (policy.serverPort !== undefined) {
    if (!Number.isInteger(policy.serverPort) || policy.serverPort < 1 || policy.serverPort > 65535)
      throw new Error('Invalid server port');
    lines.push(`(deny network-outbound (remote ip "localhost:${policy.serverPort}"))`);
  }
  return `${lines.join('\n')}\n`;
}

export function seatbeltCommand(
  policy: SeatbeltPolicy,
  command: string,
  args: string[],
): { command: string; args: string[] } {
  return { command: SANDBOX_EXEC, args: ['-p', seatbeltProfile(policy), command, ...args] };
}
