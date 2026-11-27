import { dirname } from 'node:path';
import { CONTAINER_SOCKETS } from './confine.js';
import { MAC_SHELL_DENIED_PORTS } from './loopback-ports.js';

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

export const MAC_DENIED_ROOTS = ['/Library/Keychains'];
export const MAC_AGENT_SOCKETS = ['Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock'];

const MACH_SERVICE_DENIALS = [
  '(deny mach-lookup (global-name-prefix "com.apple.coreservices") (global-name-prefix "com.apple.lsd"))',
  '(deny mach-lookup (global-name-prefix "com.apple.windowserver") (global-name-prefix "com.apple.hiservices") (global-name-prefix "com.apple.pasteboard"))',
];

const HOST_SHELL_KEYCHAIN_MACH_DENIALS = [
  '(deny mach-lookup (global-name-prefix "com.apple.securityd") (global-name-prefix "com.apple.SecurityServer") (global-name-prefix "com.apple.secd"))',
];

const ESCAPE_BINARIES = [
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

const TEMP_SOCKET_DENY =
  '(regex #"^(/private)?/(tmp|var/tmp|var/run|var/folders/[^/]+/[^/]+/T)/(com\\.apple\\.launchd\\.|ssh-|tmux-|uscreens|screens/|zellij-)")';

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

function portDenies(lines: string[], port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid server port');
  for (const denied of ['localhost', '*']) {
    lines.push(`(deny network-outbound (remote tcp "${denied}:${port}"))`);
    lines.push(`(deny network-inbound (local tcp "${denied}:${port}"))`);
    lines.push(`(deny network-bind (local tcp "${denied}:${port}"))`);
  }
}

interface HostShellPolicy {
  deniedDirectories: string[];
  deniedFiles: string[];
  stagingRoot?: string;
  serverPort?: number;
  agentDesktopDirs?: string[];
  agentBrowserDirs?: string[];
}

const SYSTEM_CHROME_APP = '/Applications/Google Chrome.app';

function hostShellProfile(policy: HostShellPolicy): string {
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
    `(deny file-write* (literal ${quoted(SYSTEM_CHROME_APP)}) (subpath ${quoted(SYSTEM_CHROME_APP)}))`,
    `(deny file-write-unlink (literal ${quoted(SYSTEM_CHROME_APP)}))`,
    ...ruleLines(
      'deny file-write-unlink',
      deniedAncestors.map((path) => `(literal ${quoted(path)})`),
    ),
  );
  for (const dir of new Set([
    ...(policy.agentDesktopDirs ?? []),
    ...(policy.agentBrowserDirs ?? []),
  ])) {
    lines.push(`(deny process-exec (subpath ${quoted(dir)}))`);
  }
  lines.push(...unixSocketDenies(policy.deniedDirectories, policy.deniedFiles));
  lines.push(...ESCAPE_DENIALS);
  lines.push(...MACH_SERVICE_DENIALS, ...HOST_SHELL_KEYCHAIN_MACH_DENIALS);
  for (const port of MAC_SHELL_DENIED_PORTS) portDenies(lines, port);
  if (policy.serverPort !== undefined) portDenies(lines, policy.serverPort);
  return `${lines.join('\n')}\n`;
}

export function hostShellCommand(
  policy: HostShellPolicy,
  command: string,
  args: string[],
): { command: string; args: string[] } {
  return { command: SANDBOX_EXEC, args: ['-p', hostShellProfile(policy), command, ...args] };
}
