import { spawnSync } from 'node:child_process';
import { readFileSync, statfsSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
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
  home: string;
  nodeVersion: string;
  readFile(path: string): string | undefined;
  which(cmd: string): boolean;
  run(cmd: string, args: string[]): { status: number | null; stdout: string };
  freeBytes(path: string): number | undefined;
}

type KnownFamily = 'arch' | 'debian' | 'fedora';
type Family = KnownFamily | 'unknown';

interface ToolSpec {
  cmd: string;
  packages: Record<KnownFamily, string>;
}

const LINUX_REQUIRED_TOOLS: ToolSpec[] = [
  {
    cmd: 'systemd-run',
    packages: { arch: 'systemd', debian: 'systemd', fedora: 'systemd' },
  },
  {
    cmd: 'bwrap',
    packages: { arch: 'bubblewrap', debian: 'bubblewrap', fedora: 'bubblewrap' },
  },
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

function nodeCheck(env: DoctorEnv): Check {
  return nodeAtLeastMinimum(env.nodeVersion)
    ? { id: 'node', label: 'Node', status: 'pass', detail: env.nodeVersion }
    : {
        id: 'node',
        label: 'Node',
        status: 'fail',
        detail: env.nodeVersion,
        fix: 'install Node 22.19 or newer',
      };
}

function notRootCheck(env: DoctorEnv): Check {
  return env.uid !== 0
    ? { id: 'not-root', label: 'Not running as root', status: 'pass' }
    : {
        id: 'not-root',
        label: 'Not running as root',
        status: 'fail',
        fix: 'run cairn doctor as the account that will run tasks, without sudo',
      };
}

function diskCheck(env: DoctorEnv): Check {
  const free = env.freeBytes(env.home);
  if (free !== undefined && free >= MIN_FREE_BYTES) {
    return {
      id: 'disk',
      label: 'Free disk space',
      status: 'pass',
      detail: `${formatGib(free)} free under ${env.home}`,
    };
  }
  return {
    id: 'disk',
    label: 'Free disk space',
    status: 'warn',
    detail: free === undefined ? 'free space unknown' : `${formatGib(free)} free under ${env.home}`,
    fix: 'free up space in the home directory (at least 10 GiB recommended)',
  };
}

function darwinChecks(env: DoctorEnv): Check[] {
  const checks: Check[] = [
    { id: 'macos', label: 'macOS host', status: 'pass' },
    nodeCheck(env),
    notRootCheck(env),
    env.which('sandbox-exec')
      ? { id: 'seatbelt', label: 'seatbelt confinement (sandbox-exec)', status: 'pass' }
      : {
          id: 'seatbelt',
          label: 'seatbelt confinement (sandbox-exec)',
          status: 'fail',
          detail: 'sandbox-exec not found; it is required to confine step runs',
          fix: 'sandbox-exec ships with macOS; update or reinstall the OS to restore it',
        },
    env.which('container')
      ? {
          id: 'vm-runtime',
          label: 'Computer VM runtime (container)',
          status: 'pass',
          detail: 'Apple container CLI found',
        }
      : {
          id: 'vm-runtime',
          label: 'Computer VM runtime (container)',
          status: 'info',
          detail: 'not installed; optional — enables the Linux VM Computer feature',
        },
    diskCheck(env),
    {
      id: 'versions',
      label: 'Versions',
      status: 'info',
      detail: `macOS ${env.run('sw_vers', ['-productVersion']).stdout.trim() || 'unknown'}, kernel ${
        env.run('uname', ['-r']).stdout.trim() || 'unknown'
      }`,
    },
  ];
  return checks;
}

function linuxChecks(env: DoctorEnv): Check[] {
  const checks: Check[] = [{ id: 'linux', label: 'Linux host', status: 'pass' }];
  const family = distroFamily(env.readFile('/etc/os-release'));

  checks.push(nodeCheck(env), notRootCheck(env));

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

  for (const tool of LINUX_REQUIRED_TOOLS) {
    checks.push(
      env.which(tool.cmd)
        ? { id: `tool:${tool.cmd}`, label: tool.cmd, status: 'pass' }
        : {
            id: `tool:${tool.cmd}`,
            label: tool.cmd,
            status: 'fail',
            detail: 'not found; required to confine step runs',
            fix: installFix(tool, family),
          },
    );
  }

  const maxUserns = env.readFile('/proc/sys/user/max_user_namespaces')?.trim();
  const usernsClone = env.readFile('/proc/sys/kernel/unprivileged_userns_clone')?.trim();
  checks.push(
    maxUserns === '0' || usernsClone === '0'
      ? {
          id: 'userns',
          label: 'Unprivileged user namespaces',
          status: 'fail',
          detail: 'disabled; bubblewrap confinement cannot create namespaces',
          fix: 'sudo sysctl -w user.max_user_namespaces=28633 kernel.unprivileged_userns_clone=1, and persist it in /etc/sysctl.d',
        }
      : { id: 'userns', label: 'Unprivileged user namespaces', status: 'pass' },
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

  checks.push(diskCheck(env));

  const systemd = /^systemd\s+(\S+)/.exec(
    env.run('systemctl', ['--version']).stdout.split('\n')[0] ?? '',
  )?.[1];
  const kernel = env.run('uname', ['-r']).stdout.trim() || 'unknown';
  checks.push({
    id: 'versions',
    label: 'Versions',
    status: 'info',
    detail: `systemd ${systemd ?? 'unknown'}, kernel ${kernel} (known to work: systemd 262, kernel 7.2)`,
  });

  checks.push(
    env.which('podman')
      ? {
          id: 'orb:podman',
          label: 'podman orb backend',
          status: 'pass',
          detail: 'available for CAIRN_ORB_RUNTIME=podman',
        }
      : {
          id: 'orb:podman',
          label: 'podman orb backend',
          status: 'info',
          detail: 'not installed; optional — enables CAIRN_ORB_RUNTIME=podman containers',
          fix: installFix(
            {
              cmd: 'podman',
              packages: { arch: 'podman', debian: 'podman', fedora: 'podman' },
            },
            family,
          ),
        },
    env.which('systemd-nspawn') && env.which('machinectl')
      ? {
          id: 'orb:nspawn',
          label: 'nspawn orb backend',
          status: 'pass',
          detail: 'available for CAIRN_ORB_RUNTIME=nspawn',
        }
      : {
          id: 'orb:nspawn',
          label: 'nspawn orb backend',
          status: 'info',
          detail: 'not installed; optional — enables CAIRN_ORB_RUNTIME=nspawn',
          fix: installFix(
            {
              cmd: 'systemd-nspawn',
              packages: {
                arch: 'systemd',
                debian: 'systemd-container',
                fedora: 'systemd-container',
              },
            },
            family,
          ),
        },
  );

  return checks;
}

export function runDoctor(env: DoctorEnv): DoctorResult {
  const checks =
    env.platform === 'darwin'
      ? darwinChecks(env)
      : env.platform === 'linux'
        ? linuxChecks(env)
        : [
            {
              id: 'platform',
              label: 'Supported platform',
              status: 'fail' as const,
              detail: `${env.platform} is unsupported; cairn runs on macOS and Linux`,
            },
          ];
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
    home: homedir(),
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
