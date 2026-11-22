import {
  accessSync,
  constants,
  type Dirent,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { executableOnPath } from '../computer/contained-spawn.js';
import { ComputerRefusal } from '../computer/provider.js';
import { CONTAINER_SOCKETS, contains, DENIED_DIRECTORIES, DENIED_FILES } from './confine.js';
import {
  HOST_SHELL_WRITE_DENY_DIRECTORIES,
  HOST_SHELL_WRITE_DENY_FILES,
  HOST_SHELL_WRITE_DENY_ROOTS,
  hostShellCommand,
  LINUX_WRITE_DENY_MASKED_BINARIES,
  MAC_AGENT_SOCKETS,
  MAC_DENIED_DIRECTORIES,
  MAC_DENIED_ROOTS,
  SANDBOX_EXEC,
} from './confine-seatbelt.js';

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

const MATERIALIZE_MISSING_FILES: Record<string, { content: string; mode: number }> = {
  '.bash_profile': {
    mode: 0o644,
    content:
      'if [ -f ~/.bash_login ]; then . ~/.bash_login; elif [ -f ~/.profile ]; then . ~/.profile; fi\n',
  },
  '.bash_login': { mode: 0o644, content: 'if [ -f ~/.profile ]; then . ~/.profile; fi\n' },
  '.xinitrc': {
    mode: 0o755,
    content:
      '#!/bin/sh\nif [ -x /etc/X11/xinit/xinitrc ]; then exec /etc/X11/xinit/xinitrc; fi\nif [ -x /etc/X11/Xsession ]; then exec /etc/X11/Xsession; fi\n',
  },
  '.xsession': {
    mode: 0o755,
    content: '#!/bin/sh\nif [ -x /etc/X11/Xsession ]; then exec /etc/X11/Xsession; fi\n',
  },
  '.emacs': {
    mode: 0o644,
    content: '(when (file-readable-p "~/.emacs.d/init.el") (load-file "~/.emacs.d/init.el"))\n',
  },
  '.claude.json': { mode: 0o600, content: '{}\n' },
};

const MATERIALIZE_MISSING_DIRS: Record<string, number> = { '.gnupg': 0o700 };

export interface HostShellConfinement {
  denied(target: string): boolean;
  writeDenied(target: string): boolean;
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

function denyVariants(paths: readonly string[]): string[] {
  return [...new Set(paths.flatMap((path) => [path, canonicalDeny(path)]))];
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
  const deniedDirectories = denyVariants([
    ...(options.deniedRoots ?? []),
    ...(desktopDir !== undefined ? [desktopDir] : []),
    ...runtimeDirectories,
    ...(platform === 'darwin'
      ? [...DENIED_DIRECTORIES, ...MAC_DENIED_DIRECTORIES].map((entry) => join(home, entry))
      : DENIED_DIRECTORIES.map((entry) => join(home, entry))),
    ...(platform === 'darwin' ? MAC_DENIED_ROOTS : []),
  ]);
  const deniedFiles = denyVariants([
    ...DENIED_FILES.map((entry) => join(home, entry)),
    ...(platform === 'darwin' ? MAC_AGENT_SOCKETS.map((entry) => join(home, entry)) : []),
    ...(platform !== 'win32' ? CONTAINER_SOCKETS : []),
    ...runtimeFiles,
  ]);
  const deniedWriteDirectories = denyVariants([
    ...(platform === 'darwin' ? HOST_SHELL_WRITE_DENY_ROOTS : []),
    ...HOST_SHELL_WRITE_DENY_DIRECTORIES.map((entry) => join(home, entry)),
  ]);
  const deniedWriteFiles = denyVariants(
    HOST_SHELL_WRITE_DENY_FILES.map((entry) => join(home, entry)),
  );
  const protectedDirs = new Set(
    denyVariants([
      ...(options.deniedRoots ?? []),
      ...(desktopDir !== undefined ? [desktopDir] : []),
    ]),
  );
  const deniedPaths = [...deniedDirectories, ...deniedFiles];
  const fold =
    platform === 'darwin' ? (path: string) => path.toLowerCase() : (path: string) => path;
  const foldedPaths = deniedPaths.map(fold);
  const foldedWriteDirectories = deniedWriteDirectories.map(fold);
  const foldedWriteFiles = new Set(deniedWriteFiles.map(fold));
  const denied = (target: string): boolean => {
    const probe = fold(canonicalDeny(target));
    return foldedPaths.some((root) => contains(root, probe));
  };
  const writeDenied = (target: string): boolean => {
    const gitSegment = (path: string) =>
      path.split('/').some((segment) => segment === '.git' || segment.endsWith('.git'));
    const probe = fold(canonicalDeny(target));
    if (gitSegment(fold(target)) || gitSegment(probe)) return true;
    return (
      foldedWriteDirectories.some((root) => contains(root, probe)) || foldedWriteFiles.has(probe)
    );
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
          deniedWriteDirectories,
          deniedWriteFiles,
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
      const covered = (target: string) => [...mounted].some((root) => contains(root, target));
      const resolvedIsDirectory = (target: string): boolean => {
        try {
          return statSync(target).isDirectory();
        } catch {
          return false;
        }
      };
      const writableAncestor = (target: string): boolean => {
        let cursor = dirname(target);
        for (;;) {
          let stat: ReturnType<typeof lstatSync> | undefined;
          try {
            stat = lstatSync(cursor, { throwIfNoEntry: false });
          } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (!['EACCES', 'EPERM', 'ELOOP', 'ENOTDIR'].includes(code ?? '')) throw error;
            return false;
          }
          if (stat !== undefined) {
            try {
              if (!statSync(cursor).isDirectory()) return false;
              accessSync(cursor, constants.W_OK);
              return true;
            } catch {
              return false;
            }
          }
          const next = dirname(cursor);
          if (next === cursor) return false;
          cursor = next;
        }
      };
      const materialize = (target: string): ReturnType<typeof probe> => {
        const name = basename(target);
        try {
          const fileSpec = MATERIALIZE_MISSING_FILES[name];
          const dirMode = MATERIALIZE_MISSING_DIRS[name];
          if (fileSpec !== undefined) {
            writeFileSync(target, fileSpec.content, { mode: fileSpec.mode, flag: 'wx' });
          } else if (dirMode !== undefined) {
            mkdirSync(target, { mode: dirMode });
          }
        } catch {
          // best effort; the mask below still pins the name
        }
        return probe(target);
      };
      const probeTarget = (target: string) => {
        const stat = probe(target);
        if (stat?.isSymbolicLink() === true && !existsSync(target)) {
          try {
            unlinkSync(target);
          } catch {
            // If the unlink raced or failed, fall through to the missing-path
            // mask; a lingering link makes bwrap resolve the mountpoint
            // target, which fails closed rather than leaving the name open.
          }
          return undefined;
        }
        return stat;
      };
      for (const directory of deniedDirectories) {
        const canon = canonicalDeny(directory);
        if (covered(canon)) continue;
        let stat = probeTarget(directory);
        if (stat === undefined) {
          if (!protectedDirs.has(directory) && !contains(home, directory)) continue;
          if (!writableAncestor(directory)) continue;
          stat = materialize(directory);
        }
        mounted.add(canon);
        if (stat === undefined || stat.isDirectory() || resolvedIsDirectory(directory)) {
          mounts.push('--tmpfs', canon);
        } else {
          mounts.push('--ro-bind', '/dev/null', canon);
        }
      }
      for (const file of deniedFiles) {
        const canon = canonicalDeny(file);
        if (covered(canon)) continue;
        let stat = probeTarget(file);
        if (stat !== undefined && (stat.isDirectory() || resolvedIsDirectory(file))) {
          mounted.add(canon);
          mounts.push('--tmpfs', canon);
          continue;
        }
        if (stat === undefined) {
          if (!contains(home, file) || !writableAncestor(file)) continue;
          stat = materialize(file);
        }
        mounted.add(canon);
        mounts.push('--ro-bind', '/dev/null', canon);
      }
      for (const path of [
        ...deniedWriteDirectories.map((entry) => ({ entry, directory: true })),
        ...deniedWriteFiles.map((entry) => ({ entry, directory: false })),
      ]) {
        const canon = canonicalDeny(path.entry);
        if (covered(canon)) continue;
        let stat = probeTarget(path.entry);
        if (stat === undefined) {
          if (!writableAncestor(path.entry)) continue;
          stat = materialize(path.entry);
        }
        mounted.add(canon);
        if (stat === undefined) {
          if (path.directory) mounts.push('--tmpfs', canon, '--remount-ro', canon);
          else mounts.push('--ro-bind', '/dev/null', canon);
        } else {
          mounts.push('--ro-bind', canon, canon);
        }
      }
      for (const binary of LINUX_WRITE_DENY_MASKED_BINARIES) {
        const canon = canonicalDeny(binary);
        if (covered(canon) || !existsSync(binary)) continue;
        mounted.add(canon);
        mounts.push('--ro-bind', '/dev/null', canon);
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
            const canon = canonicalDeny(target);
            const socket =
              entry.isSocket() ||
              (entry.isSymbolicLink() === true && statSync(target).isSocket() === true);
            if (socket && !mounted.has(canon)) {
              mounted.add(canon);
              mounts.push('--ro-bind', '/dev/null', canon);
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

  return { denied, writeDenied, wrap };
}
