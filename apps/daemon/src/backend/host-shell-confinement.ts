import { type Dirent, existsSync, lstatSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { executableOnPath } from '../computer/contained-spawn.js';
import { ComputerRefusal } from '../computer/provider.js';
import { CONTAINER_SOCKETS, contains, DENIED_DIRECTORIES, DENIED_FILES } from './confine.js';
import { hostShellCommand, MAC_DENIED_DIRECTORIES, SANDBOX_EXEC } from './confine-seatbelt.js';

export interface HostShellConfinementOptions {
  home?: string;
  deniedRoots?: string[];
  serverPort?: number;
  agentDesktop?: string | null;
  platform?: string;
  path?: string;
  xdgRuntimeDir?: string;
}

const SYSTEM_BIN_PATH = '/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:/usr/sbin:/sbin:/snap/bin';

export interface HostShellConfinement {
  denied(target: string): boolean;
  wrap(command: string, args: readonly string[]): { command: string; args: string[] };
}

function canonicalDeny(path: string): string {
  if (!isAbsolute(path)) return path;
  let cursor = path;
  const missing: string[] = [];
  while (true) {
    try {
      const resolved = realpathSync(cursor);
      return join(resolved, ...missing);
    } catch {
      const parent = dirname(cursor);
      if (parent === cursor) return path;
      missing.unshift(basename(cursor));
      cursor = parent;
    }
  }
}

function agentDesktopDir(binary: string): string | undefined {
  if (!isAbsolute(binary)) return undefined;
  const parent = dirname(binary);
  const grandparent = dirname(parent);
  return /^(arm64|x64)$/.test(basename(parent)) ? grandparent : parent;
}

export function createHostShellConfinement(
  options: HostShellConfinementOptions = {},
): HostShellConfinement {
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();
  const desktopDir =
    options.agentDesktop == null ? undefined : agentDesktopDir(options.agentDesktop);
  const xdgRuntimeDir = options.xdgRuntimeDir ?? process.env.XDG_RUNTIME_DIR;
  const runtimeDir =
    platform === 'linux'
      ? xdgRuntimeDir !== undefined && xdgRuntimeDir !== ''
        ? xdgRuntimeDir
        : join('/run/user', String(process.getuid?.() ?? 0))
      : undefined;
  const runtimeDirectories =
    runtimeDir === undefined
      ? []
      : [
          'podman',
          'systemd',
          'keyring',
          'gcr',
          'gnupg',
          'at-spi',
          'dconf',
          'dbus-1',
          'docker',
          'containerd',
          'buildkit',
          'pulse',
        ].map((name) => join(runtimeDir, name));
  const runtimeFiles =
    runtimeDir === undefined
      ? []
      : ['bus', 'ssh-agent.socket', 'docker.sock', 'containerd.sock'].map((name) =>
          join(runtimeDir, name),
        );
  const deniedDirectories = [
    ...new Set(
      [
        ...(options.deniedRoots ?? []),
        ...(desktopDir !== undefined ? [desktopDir] : []),
        ...runtimeDirectories,
        ...(platform === 'darwin'
          ? [...DENIED_DIRECTORIES, ...MAC_DENIED_DIRECTORIES]
          : DENIED_DIRECTORIES
        ).map((entry) => join(home, entry)),
      ].map(canonicalDeny),
    ),
  ];
  const deniedFiles = [
    ...new Set([
      ...DENIED_FILES.map((entry) => join(home, entry)),
      ...(platform !== 'win32' ? CONTAINER_SOCKETS : []),
      ...runtimeFiles,
    ]),
  ].map(canonicalDeny);
  const deniedPaths = [...deniedDirectories, ...deniedFiles];
  const foldedPaths =
    platform === 'darwin' ? deniedPaths.map((root) => root.toLowerCase()) : deniedPaths;
  const denied = (target: string): boolean => {
    const resolved = canonicalDeny(target);
    const probe = platform === 'darwin' ? resolved.toLowerCase() : resolved;
    return foldedPaths.some((root) => contains(root, probe));
  };

  const wrap = (command: string, args: readonly string[]): { command: string; args: string[] } => {
    if (platform === 'darwin') {
      if (!existsSync(SANDBOX_EXEC)) {
        throw new ComputerRefusal('host shell confinement needs sandbox-exec on this machine');
      }
      return hostShellCommand(
        {
          deniedDirectories,
          deniedFiles,
          ...(options.serverPort !== undefined ? { serverPort: options.serverPort } : {}),
          ...(desktopDir !== undefined ? { agentDesktopDir: desktopDir } : {}),
        },
        command,
        [...args],
      );
    }
    if (platform === 'linux') {
      const bwrap = executableOnPath('bwrap', options.path ?? SYSTEM_BIN_PATH);
      if (bwrap === undefined) {
        throw new ComputerRefusal(
          'host shell confinement needs bubblewrap (bwrap) on this machine',
        );
      }
      const probe = (target: string) => {
        try {
          return lstatSync(target, { throwIfNoEntry: false });
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (!['EACCES', 'EPERM', 'ELOOP', 'ENOTDIR'].includes(code ?? '')) throw error;
          return undefined;
        }
      };
      const mounts: string[] = [];
      const mounted = new Set<string>();
      for (const directory of deniedDirectories) {
        const stat = probe(directory);
        if (stat === undefined) continue;
        mounted.add(directory);
        if (stat.isDirectory()) mounts.push('--tmpfs', directory);
        else mounts.push('--ro-bind', '/dev/null', directory);
      }
      for (const file of deniedFiles) {
        const stat = probe(file);
        if (stat !== undefined && !stat.isDirectory() && !mounted.has(file)) {
          mounted.add(file);
          mounts.push('--ro-bind', '/dev/null', file);
        }
      }
      if (runtimeDir !== undefined) {
        let entries: Dirent[];
        try {
          entries = readdirSync(runtimeDir, { withFileTypes: true });
        } catch {
          entries = [];
        }
        for (const entry of entries) {
          try {
            const target = join(runtimeDir, entry.name);
            const socket =
              entry.isSocket() ||
              (entry.isSymbolicLink() === true && statSync(target).isSocket() === true);
            if (socket && !mounted.has(target)) {
              mounted.add(target);
              mounts.push('--ro-bind', '/dev/null', target);
            }
          } catch {}
        }
      }
      return {
        command: bwrap,
        args: [
          '--die-with-parent',
          '--dev-bind',
          '/dev',
          '/dev',
          '--proc',
          '/proc',
          '--bind',
          '/',
          '/',
          '--tmpfs',
          '/tmp',
          '--tmpfs',
          '/var/tmp',
          ...mounts,
          '--',
          command,
          ...args,
        ],
      };
    }
    throw new ComputerRefusal('host shell confinement is unsupported on this platform');
  };

  return { denied, wrap };
}
