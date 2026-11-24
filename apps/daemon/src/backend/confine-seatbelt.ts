import { execFile } from 'node:child_process';
import { mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  CONTAINER_SOCKETS,
  canonical,
  canonicalDeny,
  contains,
  DENIED_DIRECTORIES,
  DENIED_FILES,
  deniedVariants,
} from './confine.js';

export const SANDBOX_EXEC = '/usr/bin/sandbox-exec';

export const MAC_HOST_SHELL_CREDENTIAL_DIRECTORIES = [
  'Library/Keychains',
  'Library/Cookies',
  'Library/Containers/com.apple.Safari/Data/Library/Cookies',
  'Library/Application Support/Google/Chrome',
  'Library/Application Support/Chromium',
  'Library/Application Support/BraveSoftware',
  'Library/Application Support/Microsoft Edge',
  'Library/Application Support/Vivaldi',
  'Library/Application Support/Arc',
  'Library/Application Support/Firefox',
  'Library/Application Support/1Password',
  'Library/Group Containers/2BUA8C4S2C.com.1password',
  'Library/Application Support/Claude',
  'Library/Application Support/Code',
  'Library/Application Support/@cairn',
  'Library/pnpm/rc',
];
export const MAC_DENIED_DIRECTORIES = [
  ...MAC_HOST_SHELL_CREDENTIAL_DIRECTORIES,
  'Library/Safari',
  'Library/Mail',
  'Library/Messages',
];
export const MAC_DENIED_ROOTS = ['/Library/Keychains'];
export const MAC_AGENT_SOCKETS = ['Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock'];
const OWN_STATE_NAMES = [
  '.claude',
  '.pi',
  '.gemini',
  '.claude.json',
  '.local/share/devin',
  '.cache/devin',
];
const DEVICE_WRITES = ['/dev/null', '/dev/dtracehelper'];

const MACH_SERVICE_DENIALS = [
  '(deny mach-lookup (global-name-prefix "com.apple.coreservices") (global-name-prefix "com.apple.lsd"))',
  '(deny mach-lookup (global-name-prefix "com.apple.windowserver") (global-name-prefix "com.apple.hiservices") (global-name-prefix "com.apple.pasteboard"))',
];

const KEYCHAIN_MACH_DENIALS = [
  '(deny mach-lookup (global-name-prefix "com.apple.securityd") (global-name-prefix "com.apple.SecurityServer") (global-name-prefix "com.apple.secd") (global-name-prefix "com.apple.trustd"))',
];

const HOST_SHELL_KEYCHAIN_MACH_DENIALS = [
  '(deny mach-lookup (global-name-prefix "com.apple.securityd") (global-name-prefix "com.apple.SecurityServer") (global-name-prefix "com.apple.secd"))',
];

export const ESCAPE_BINARIES = [
  '/bin/launchctl',
  '/usr/bin/osascript',
  '/usr/bin/osacompile',
  '/usr/bin/open',
  '/usr/bin/security',
  '/usr/bin/sudo',
  '/usr/bin/su',
  '/usr/bin/crontab',
  '/usr/bin/shortcuts',
  '/usr/bin/automator',
  '/usr/bin/at',
  '/usr/bin/batch',
  '/usr/sbin/systemsetup',
  '/usr/sbin/spctl',
];

const ESCAPE_DENIALS = [
  '(deny mach-bootstrap)',
  `(deny process-exec ${ESCAPE_BINARIES.map((path) => `(literal "${path}")`).join(' ')})`,
];

export const OUTSIDE_PROCESS_DENIALS = [
  '(deny signal)',
  '(allow signal (target same-sandbox))',
  '(deny process-info*)',
  '(allow process-info* (target same-sandbox))',
];

const TEMP_SOCKET_DENY =
  '(regex #"^(/private)?/(tmp|var/tmp|var/run|var/folders/[^/]+/[^/]+/T)/(com\\.apple\\.launchd\\.|ssh-|tmux-|uscreens|screens/|zellij-)")';

function unixSocketDenies(directories: string[], files: string[]): string[] {
  const filters = [
    ...directories.map((path) => `(subpath ${quoted(path)})`),
    ...files.map((path) => `(literal ${quoted(path)})`),
    ...CONTAINER_SOCKETS.map((path) => `(literal ${quoted(path)})`),
    TEMP_SOCKET_DENY,
  ];
  return [
    ...filters.map((filter) => `(deny network-outbound (remote unix-socket ${filter}))`),
    `(deny file-write* ${TEMP_SOCKET_DENY})`,
    `(deny network-bind (local unix-socket ${TEMP_SOCKET_DENY}))`,
    ...CONTAINER_SOCKETS.map(
      (path) => `(deny network-bind (local unix-socket (literal ${quoted(path)})))`,
    ),
  ];
}

function serverPortDenies(lines: string[], port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid server port');
  for (const denied of ['localhost', '*']) {
    lines.push(`(deny network-outbound (remote tcp "${denied}:${port}"))`);
    lines.push(`(deny network-inbound (local tcp "${denied}:${port}"))`);
    lines.push(`(deny network-bind (local tcp "${denied}:${port}"))`);
  }
}

export interface SeatbeltPolicy {
  home: string;
  daemonHome?: string;
  deniedRoots: string[];
  workspace: string;
  gitDirectories: string[];
  taskTemp: string;
  state: string[];
  caches: string[];
  readable?: string[];
  postReadableDenies?: string[];
  traversalLinks?: string[];
  pinnedInodes?: string[];
  serverPort?: number;
}

function quoted(path: string): string {
  if (/["\\\n\r\0]/.test(path)) throw new Error('Unsafe seatbelt path');
  return `"${path}"`;
}

function ancestorsOf(path: string): string[] {
  const found: string[] = [];
  for (let cursor = dirname(path); cursor !== dirname(cursor); cursor = dirname(cursor))
    found.push(cursor);
  return found;
}

const RULE_LINE_LIMIT = 6000;

function ruleLines(head: string, filters: readonly string[]): string[] {
  if (filters.length === 0) return [];
  const lines: string[] = [];
  let current = `(${head}`;
  for (const filter of filters) {
    if (current.length + filter.length + 2 > RULE_LINE_LIMIT && current !== `(${head}`) {
      lines.push(`${current})`);
      current = `(${head}`;
    }
    current += ` ${filter}`;
  }
  lines.push(`${current})`);
  return lines;
}

function regexEscaped(path: string): string {
  return path.replace(/[\\^$.|?*+()[\]{}]/g, '\\$&');
}

function resolvedParentLeaf(path: string): string {
  if (!isAbsolute(path) || resolve(path) !== path) throw new Error('Unsafe confinement path');
  return join(realpathSync(dirname(path)), basename(path));
}

function postDenyVariants(path: string): string[] {
  const variants = new Set(deniedVariants(path));
  try {
    variants.add(resolvedParentLeaf(path));
  } catch {}
  return [...variants];
}

export function seatbeltProfile(policy: SeatbeltPolicy): string {
  const home = canonical(policy.home, true);
  const deniedRoots = policy.deniedRoots.flatMap((path) => deniedVariants(path));
  const deniedDirectories = [
    ...deniedRoots,
    ...[...DENIED_DIRECTORIES, ...MAC_DENIED_DIRECTORIES].flatMap((path) =>
      deniedVariants(join(home, path)),
    ),
    ...MAC_DENIED_ROOTS.flatMap((path) => deniedVariants(path)),
  ];
  const deniedFiles = DENIED_FILES.flatMap((path) => deniedVariants(join(home, path)));
  const state = policy.state.map((path) => canonical(path));
  const readable = [
    ...new Set(
      (policy.readable ?? []).flatMap((path) => {
        const variants = [resolvedParentLeaf(path)];
        try {
          const resolved = realpathSync(path);
          if (!variants.includes(resolved)) variants.push(resolved);
        } catch {}
        return variants;
      }),
    ),
  ];
  const reexposed = [
    canonical(policy.workspace, true),
    ...policy.gitDirectories.map((path) => canonical(path, true)),
    ...state,
  ];
  const writable = [
    ...reexposed,
    canonical(policy.taskTemp, true),
    ...policy.caches.map((path) => canonical(path)),
  ];
  const everythingDenied = [...deniedDirectories, ...deniedFiles];
  const postReadableDenies = [
    ...new Set([
      ...(policy.postReadableDenies ?? []).flatMap((path) => postDenyVariants(path)),
      ...everythingDenied.filter((secret) =>
        readable.some((dir) => dir !== secret && contains(dir, secret)),
      ),
    ]),
  ];
  const cachePaths = new Set(policy.caches.map((value) => canonical(value)));
  for (const path of cachePaths) {
    if (everythingDenied.some((secret) => contains(secret, path)))
      throw new Error('Unsafe confinement cache overlap');
  }
  const daemonRoot = policy.daemonHome === undefined ? null : canonical(policy.daemonHome);
  for (const path of writable) {
    const statePath = state.includes(path);
    if (
      everythingDenied.some(
        (secret) =>
          contains(path, secret) &&
          !(cachePaths.has(path) && path !== home && contains(home, path)) &&
          !(path === secret && statePath && !deniedRoots.includes(secret)),
      )
    )
      throw new Error(
        `Unsafe confinement overlap: ${path} contains ${everythingDenied.find((secret) => contains(path, secret))}`,
      );
    if (
      everythingDenied.some((secret) => contains(secret, path)) &&
      !statePath &&
      !(daemonRoot !== null && contains(daemonRoot, path))
    )
      throw new Error(
        `Unsafe confinement overlap: ${path} inside ${everythingDenied.find((secret) => contains(secret, path))}`,
      );
  }
  const ownTargets = OWN_STATE_NAMES.map((name) => canonicalDeny(join(home, name)));
  for (const path of state) {
    const own = ownTargets.some(
      (target) =>
        contains(target, path) &&
        !everythingDenied.some((secret) => secret !== target && contains(secret, target)),
    );
    const insideRoot = deniedRoots.some((root) => root !== path && contains(root, path));
    if (everythingDenied.some((secret) => contains(secret, path)) && !own && !insideRoot)
      throw new Error('Unsafe confinement state overlap');
  }
  for (const path of readable) {
    if (everythingDenied.includes(path)) throw new Error('Unsafe confinement readable overlap');
  }
  const traversable = [
    ...new Set(
      [...reexposed, ...readable]
        .flatMap(ancestorsOf)
        .filter((path) => deniedDirectories.some((secret) => contains(secret, path))),
    ),
  ];
  const protectedGit = policy.gitDirectories.flatMap((directory) =>
    [
      'config',
      'config.worktree',
      'hooks',
      'commondir',
      'gitdir',
      'rebase-merge',
      'rebase-apply',
      'sequencer',
    ].map((name) => canonical(join(directory, name))),
  );
  const protectedGitPatterns = policy.gitDirectories.flatMap((directory) => {
    const resolved = canonical(directory);
    if (/["\n\r\0]/.test(resolved)) throw new Error('Unsafe seatbelt path');
    const escaped = regexEscaped(resolved);
    return [
      `(regex #"^${escaped}/(worktrees|modules)(/[^/]+)?$")`,
      `(regex #"^${escaped}/(worktrees|modules)/(.*/)?(commondir|gitdir|config(\\..*)?|hooks.*|rebase-merge.*|rebase-apply.*|sequencer.*)$")`,
    ];
  });
  const workspaceGit = canonical(join(policy.workspace, '.git'));
  const lines = [
    '(version 1)',
    '(allow default)',
    '(deny file-write*)',
    ...ruleLines('allow file-write*', [
      ...writable.map((path) => `(subpath ${quoted(path)})`),
      ...DEVICE_WRITES.map((path) => `(literal ${quoted(path)})`),
      '(regex #"^/dev/tty")',
      '(subpath "/dev/fd")',
    ]),
    ...ruleLines('deny file-read* file-write*', [
      ...deniedDirectories.map((path) => `(subpath ${quoted(path)})`),
      ...deniedFiles.map((path) => `(literal ${quoted(path)})`),
    ]),
    ...ruleLines(
      'allow file-read* file-write*',
      reexposed.map((path) => `(subpath ${quoted(path)})`),
    ),
    ...ruleLines(
      'deny file-write-unlink',
      (policy.pinnedInodes ?? []).map((path) => `(literal ${quoted(path)})`),
    ),
    ...ruleLines(
      'allow file-read-metadata',
      traversable.map((path) => `(literal ${quoted(path)})`),
    ),
    ...ruleLines(
      'allow file-read*',
      readable.map((path) => `(subpath ${quoted(path)})`),
    ),
    ...ruleLines(
      'allow file-read*',
      (policy.traversalLinks ?? []).map((path) => `(literal ${quoted(path)})`),
    ),
    ...ruleLines(
      'deny file-read* file-write*',
      postReadableDenies.map((path) => `(subpath ${quoted(path)})`),
    ),
    ...ruleLines('deny file-write*', [
      ...protectedGit.map((path) => `(subpath ${quoted(path)})`),
      `(literal ${quoted(workspaceGit)})`,
      ...protectedGitPatterns,
    ]),
    ...unixSocketDenies(deniedDirectories, [
      ...deniedFiles,
      ...MAC_AGENT_SOCKETS.map((path) => join(home, path)),
    ]),
    ...ESCAPE_DENIALS,
    ...MACH_SERVICE_DENIALS,
    ...KEYCHAIN_MACH_DENIALS,
    ...OUTSIDE_PROCESS_DENIALS,
  ];
  if (policy.serverPort !== undefined) serverPortDenies(lines, policy.serverPort);
  return `${lines.join('\n')}\n`;
}

export function seatbeltCommand(
  policy: SeatbeltPolicy,
  command: string,
  args: string[],
): { command: string; args: string[] } {
  return { command: SANDBOX_EXEC, args: ['-p', seatbeltProfile(policy), command, ...args] };
}

export interface HostShellPolicy {
  deniedDirectories: string[];
  deniedFiles: string[];
  stagingRoot?: string;
  serverPort?: number;
  agentDesktopDir?: string;
}

export function hostShellProfile(policy: HostShellPolicy): string {
  const deniedAncestors = [
    ...new Set([
      ...[...policy.deniedDirectories, ...policy.deniedFiles].flatMap(ancestorsOf),
      ...(policy.stagingRoot !== undefined ? [policy.stagingRoot] : []),
    ]),
  ];
  const lines = ['(version 1)', '(allow default)'];
  lines.push(
    ...ruleLines('deny file-read* file-write*', [
      ...policy.deniedDirectories.map((path) => `(subpath ${quoted(path)})`),
      ...policy.deniedFiles.map((path) => `(literal ${quoted(path)})`),
    ]),
    ...ruleLines(
      'deny file-write-unlink',
      deniedAncestors.map((path) => `(literal ${quoted(path)})`),
    ),
  );
  if (policy.agentDesktopDir !== undefined) {
    lines.push(`(deny process-exec (subpath ${quoted(policy.agentDesktopDir)}))`);
  }
  lines.push(...unixSocketDenies(policy.deniedDirectories, policy.deniedFiles));
  lines.push(...ESCAPE_DENIALS);
  lines.push(...MACH_SERVICE_DENIALS, ...HOST_SHELL_KEYCHAIN_MACH_DENIALS);
  if (policy.serverPort !== undefined) serverPortDenies(lines, policy.serverPort);
  return `${lines.join('\n')}\n`;
}

export function hostShellCommand(
  policy: HostShellPolicy,
  command: string,
  args: string[],
): { command: string; args: string[] } {
  return { command: SANDBOX_EXEC, args: ['-p', hostShellProfile(policy), command, ...args] };
}

export class SeatbeltProbeError extends Error {
  constructor(readonly kind: 'seatbelt-missing' | 'seatbelt-probe-failed') {
    super(kind);
  }
}

const execute = promisify(execFile);

export async function runSeatbeltProbe(directory: string): Promise<void> {
  const root = realpathSync(directory);
  const denied = join(root, 'probe-denied');
  const scratch = join(root, 'probe-scratch');
  mkdirSync(denied, { recursive: true });
  mkdirSync(scratch, { recursive: true });
  writeFileSync(join(denied, 'sentinel'), 'secret');
  const launch = seatbeltCommand(
    {
      home: realpathSync(homedir()),
      deniedRoots: [denied],
      workspace: scratch,
      gitDirectories: [],
      taskTemp: scratch,
      state: [],
      caches: [],
    },
    '/bin/sh',
    [
      '-c',
      'if cat "$1" >/dev/null 2>&1; then exit 3; fi; echo ok > "$2" || exit 4',
      'probe',
      join(denied, 'sentinel'),
      join(scratch, 'written'),
    ],
  );
  try {
    await execute(launch.command, launch.args, { timeout: 10000 });
  } catch (error) {
    const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT';
    throw new SeatbeltProbeError(missing ? 'seatbelt-missing' : 'seatbelt-probe-failed');
  } finally {
    rmSync(denied, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
}
