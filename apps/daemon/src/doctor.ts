import { spawnSync } from 'node:child_process';
import { readFileSync, statfsSync } from 'node:fs';
import { userInfo } from 'node:os';
import process from 'node:process';

export type CheckStatus = 'pass' | 'fail' | 'warn' | 'info';

export interface Check {
  id: string;
  label: string;
  status: CheckStatus;
  detail?: string;
  fix?: string;
}

export interface DoctorResult {
  checks: Check[];
  ok: boolean;
}

export interface DoctorEnv {
  platform: string;
  uid: number;
  username: string;
  nodeVersion: string;
  readFile(path: string): string | undefined;
  which(cmd: string): boolean;
  run(cmd: string, args: string[]): { status: number | null; stdout: string };
  statfsType(path: string): string | undefined;
  freeBytes(path: string): number | undefined;
}

type KnownFamily = 'arch' | 'debian' | 'fedora';
type Family = KnownFamily | 'unknown';

interface ToolSpec {
  cmd: string;
  packages: Record<KnownFamily, string>;
}

const SYSTEMD_PACKAGES = {
  arch: 'systemd',
  debian: 'systemd-container',
  fedora: 'systemd-container',
};

const TOOLS: ToolSpec[] = [
  { cmd: 'systemd-nspawn', packages: SYSTEMD_PACKAGES },
  { cmd: 'machinectl', packages: SYSTEMD_PACKAGES },
  { cmd: 'nft', packages: { arch: 'nftables', debian: 'nftables', fedora: 'nftables' } },
  { cmd: 'ip', packages: { arch: 'iproute2', debian: 'iproute2', fedora: 'iproute' } },
  {
    cmd: 'nmcli',
    packages: { arch: 'networkmanager', debian: 'network-manager', fedora: 'NetworkManager' },
  },
  { cmd: 'sudo', packages: { arch: 'sudo', debian: 'sudo', fedora: 'sudo' } },
];

const INSTALL_COMMAND: Record<KnownFamily, string> = {
  arch: 'sudo pacman -S --needed',
  debian: 'sudo apt install',
  fedora: 'sudo dnf install',
};

const FAMILY_IDS: Record<KnownFamily, string[]> = {
  arch: ['arch'],
  debian: ['debian', 'ubuntu'],
  fedora: ['fedora', 'rhel', 'centos'],
};

const MIN_NODE = [22, 19, 0];
const MIN_FREE_BYTES = 10 * 1024 ** 3;
const OWNER_FILE = '/etc/cairn-orb/owner';
const OWNER_PATTERN = /^[a-z_][a-z0-9_-]{0,31}$/;
const BTRFS_MAGIC = 0x9123683e;

function osReleaseIds(content: string | undefined): string[] {
  if (content === undefined) return [];
  const ids: string[] = [];
  for (const line of content.split('\n')) {
    const match = /^(ID|ID_LIKE)=(.*)$/.exec(line.trim());
    if (!match) continue;
    const value = (match[2] ?? '').replace(/^["']|["']$/g, '');
    ids.push(...value.toLowerCase().split(/\s+/).filter(Boolean));
  }
  return ids;
}

function distroFamily(content: string | undefined): Family {
  const ids = osReleaseIds(content);
  for (const family of ['arch', 'debian', 'fedora'] as const) {
    if (FAMILY_IDS[family].some((id) => ids.includes(id))) return family;
  }
  return 'unknown';
}

function installFix(tool: ToolSpec, family: Family): string {
  if (family === 'unknown') return `install the package that provides ${tool.cmd}`;
  return `${INSTALL_COMMAND[family]} ${tool.packages[family]}`;
}

function nodeAtLeastMinimum(version: string): boolean {
  const parts = version.split('.').map((part) => Number.parseInt(part, 10));
  for (let i = 0; i < MIN_NODE.length; i += 1) {
    const have = parts[i] ?? 0;
    const need = MIN_NODE[i] ?? 0;
    if (have !== need) return have > need;
  }
  return true;
}

function formatGib(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}

function versionsDetail(env: DoctorEnv): string {
  const firstLine = env.run('systemctl', ['--version']).stdout.split('\n')[0] ?? '';
  const systemd = /^systemd\s+(\S+)/.exec(firstLine)?.[1] ?? 'unknown';
  const kernel = env.run('uname', ['-r']).stdout.trim() || 'unknown';
  return `systemd ${systemd}, kernel ${kernel} (known to work: systemd 262, kernel 7.2)`;
}

function installCheck(env: DoctorEnv): Check {
  const label = 'Host install';
  const raw = env.readFile(OWNER_FILE);
  if (raw === undefined) {
    return {
      id: 'install',
      label,
      status: 'info',
      detail: 'not installed yet',
      fix: 'sudo bash scripts/ops/orb/install-host.sh',
    };
  }
  const owner = raw.trim();
  if (!OWNER_PATTERN.test(owner)) {
    return { id: 'install', label, status: 'fail', detail: 'invalid owner file' };
  }
  if (owner !== env.username) {
    return {
      id: 'install',
      label,
      status: 'fail',
      detail: `installed for ${owner}; run as ${owner}`,
    };
  }
  return { id: 'install', label, status: 'pass', detail: `installed for ${owner}` };
}

export function runDoctor(env: DoctorEnv): DoctorResult {
  if (env.platform !== 'linux') {
    return {
      ok: false,
      checks: [
        {
          id: 'linux',
          label: 'Linux host',
          status: 'fail',
          detail: 'The Coordinator computer needs a Linux host; this machine can still run tasks',
        },
      ],
    };
  }
  const checks: Check[] = [{ id: 'linux', label: 'Linux host', status: 'pass' }];
  const family = distroFamily(env.readFile('/etc/os-release'));

  const init = env.readFile('/proc/1/comm')?.trim();
  checks.push(
    init === 'systemd'
      ? { id: 'systemd-pid1', label: 'systemd is PID 1', status: 'pass' }
      : {
          id: 'systemd-pid1',
          label: 'systemd is PID 1',
          status: 'fail',
          detail: `PID 1 is ${init ?? 'unreadable'}`,
          fix: 'boot the host with systemd as its init system',
        },
  );

  for (const tool of TOOLS) {
    checks.push(
      env.which(tool.cmd)
        ? { id: `tool:${tool.cmd}`, label: tool.cmd, status: 'pass' }
        : {
            id: `tool:${tool.cmd}`,
            label: tool.cmd,
            status: 'fail',
            detail: 'not found',
            fix: installFix(tool, family),
          },
    );
  }

  checks.push(
    nodeAtLeastMinimum(env.nodeVersion)
      ? { id: 'node', label: 'Node', status: 'pass', detail: env.nodeVersion }
      : {
          id: 'node',
          label: 'Node',
          status: 'fail',
          detail: env.nodeVersion,
          fix: 'install Node 22.19 or newer',
        },
  );

  checks.push(
    env.uid !== 0
      ? { id: 'not-root', label: 'Not running as root', status: 'pass' }
      : {
          id: 'not-root',
          label: 'Not running as root',
          status: 'fail',
          fix: 'run cairn doctor as the account that will own the computer, without sudo',
        },
  );

  checks.push(
    env.readFile('/proc/sys/fs/protected_hardlinks')?.trim() === '1'
      ? { id: 'protected-hardlinks', label: 'fs.protected_hardlinks is enabled', status: 'pass' }
      : {
          id: 'protected-hardlinks',
          label: 'fs.protected_hardlinks is enabled',
          status: 'fail',
          fix: 'sudo sysctl -w fs.protected_hardlinks=1, and persist it with a file in /etc/sysctl.d (for example fs.protected_hardlinks = 1 in /etc/sysctl.d/60-cairn.conf)',
        },
  );

  const fsType = env.statfsType('/var/lib/machines') ?? env.statfsType('/var/lib');
  checks.push(
    fsType === 'btrfs'
      ? {
          id: 'btrfs',
          label: 'Image storage filesystem',
          status: 'pass',
          detail: 'btrfs (image snapshots)',
        }
      : {
          id: 'btrfs',
          label: 'Image storage filesystem',
          status: 'warn',
          detail: 'not btrfs: images are plain directories and rebuilds copy the whole tree',
        },
  );

  const free = env.freeBytes('/var/lib');
  if (free !== undefined && free >= MIN_FREE_BYTES) {
    checks.push({
      id: 'disk',
      label: 'Free disk space',
      status: 'pass',
      detail: `${formatGib(free)} free in /var/lib; the base image is about 2 GiB`,
    });
  } else {
    checks.push({
      id: 'disk',
      label: 'Free disk space',
      status: 'warn',
      detail:
        free === undefined
          ? 'free space unknown; the base image is about 2 GiB'
          : `${formatGib(free)} free in /var/lib; the base image is about 2 GiB`,
      fix: 'free up space under /var/lib (at least 10 GiB recommended)',
    });
  }

  checks.push({ id: 'versions', label: 'Versions', status: 'info', detail: versionsDetail(env) });
  checks.push(installCheck(env));

  return { checks, ok: checks.every((check) => check.status !== 'fail') };
}

const MARKS: Record<CheckStatus, string> = { pass: '✓', fail: '✗', warn: '!', info: '·' };

export function formatDoctor(result: DoctorResult): string {
  const lines: string[] = [];
  for (const check of result.checks) {
    lines.push(`${MARKS[check.status]} ${check.label}${check.detail ? `: ${check.detail}` : ''}`);
    if (check.fix && check.status !== 'pass') lines.push(`  Fix: ${check.fix}`);
  }
  const failures = result.checks.filter((check) => check.status === 'fail').length;
  lines.push(failures === 0 ? 'All required checks passed.' : `${failures} problem(s) found.`);
  return `${lines.join('\n')}\n`;
}

export function runDoctorCommand(
  opts: { json?: boolean },
  io: { env: DoctorEnv; writeOut(text: string): void },
): number {
  const result = runDoctor(io.env);
  io.writeOut(opts.json ? `${JSON.stringify(result, null, 2)}\n` : formatDoctor(result));
  return result.ok ? 0 : 1;
}

function realRun(cmd: string, args: string[]): { status: number | null; stdout: string } {
  const result = spawnSync(cmd, args, {
    encoding: 'utf8',
    timeout: 5_000,
    env: { ...process.env, LC_ALL: 'C' },
  });
  return { status: result.status, stdout: result.stdout ?? '' };
}

export function realDoctorEnv(): DoctorEnv {
  return {
    platform: process.platform,
    uid: process.getuid?.() ?? -1,
    username: userInfo().username,
    nodeVersion: process.versions.node,
    readFile: (path) => {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return undefined;
      }
    },
    which: (cmd) => realRun('sh', ['-c', `command -v ${cmd}`]).status === 0,
    run: realRun,
    statfsType: (path) => {
      try {
        const type = statfsSync(path).type;
        return type === BTRFS_MAGIC ? 'btrfs' : `0x${type.toString(16)}`;
      } catch {
        return undefined;
      }
    },
    freeBytes: (path) => {
      try {
        const stats = statfsSync(path);
        return stats.bavail * stats.bsize;
      } catch {
        return undefined;
      }
    },
  };
}
