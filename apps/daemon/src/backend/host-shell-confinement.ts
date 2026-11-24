import {
  accessSync,
  constants,
  type Dirent,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { realpathOfNearest } from '@cairn/shared/realpath-nearest';
import { executableOnPath } from '../computer/contained-spawn.js';
import { ComputerRefusal } from '../computer/provider.js';
import { isSafeStagingRoot } from '../computer/staging.js';
import {
  CONTAINER_SOCKETS,
  canonicalDeny,
  contains,
  HOST_SHELL_CREDENTIAL_DIRECTORIES,
  HOST_SHELL_CREDENTIAL_FILES,
} from './confine.js';
import {
  hostShellCommand,
  MAC_AGENT_SOCKETS,
  MAC_DENIED_ROOTS,
  MAC_HOST_SHELL_CREDENTIAL_DIRECTORIES,
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
  stagingRoot?: string;
}

const SYSTEM_BIN_PATH = '/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:/usr/sbin:/sbin:/snap/bin';

const MATERIALIZE_MISSING_FILES: Record<string, { content: string; mode: number }> = {
  '.claude.json': { mode: 0o600, content: '{}\n' },
};

const MATERIALIZE_MISSING_DIRS: Record<string, number> = { '.gnupg': 0o700 };

export interface HostShellConfinement {
  denied(target: string): boolean;
  wrap(command: string, args: readonly string[]): { command: string; args: string[] };
}

function canonicalize(path: string): string {
  if (!isAbsolute(path)) return path;
  return resolve(path) === path ? canonicalDeny(path) : realpathOfNearest(path);
}

function existingAncestorsOf(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const raw of paths) {
    let cursor = dirname(raw);
    while (cursor !== '/' && cursor !== dirname(cursor)) {
      if (cursor !== '/tmp' && cursor !== '/var/tmp') {
        try {
          const st = lstatSync(cursor);
          if (!st.isSymbolicLink() && st.isDirectory()) seen.add(cursor);
        } catch {}
      }
      cursor = dirname(cursor);
    }
  }
  return [...seen].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
}

function denyVariants(paths: readonly string[]): string[] {
  return [...new Set(paths.flatMap((path) => [path, canonicalize(path)]))];
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
  const rawDeniedDirectories = [
    ...(options.deniedRoots ?? []),
    ...(desktopDir !== undefined ? [desktopDir] : []),
    ...runtimeDirectories,
    ...(platform === 'darwin'
      ? [...HOST_SHELL_CREDENTIAL_DIRECTORIES, ...MAC_HOST_SHELL_CREDENTIAL_DIRECTORIES].map(
          (entry) => join(home, entry),
        )
      : HOST_SHELL_CREDENTIAL_DIRECTORIES.map((entry) => join(home, entry))),
    ...(platform === 'darwin' ? MAC_DENIED_ROOTS : []),
  ];
  const rawDeniedFiles = [
    ...HOST_SHELL_CREDENTIAL_FILES.map((entry) => join(home, entry)),
    ...(platform === 'darwin' ? MAC_AGENT_SOCKETS.map((entry) => join(home, entry)) : []),
    ...(platform !== 'win32' ? CONTAINER_SOCKETS : []),
    ...runtimeFiles,
  ];
  const deniedDirectories = denyVariants(rawDeniedDirectories);
  const deniedFiles = denyVariants(rawDeniedFiles);
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
  const denied = (target: string): boolean => {
    if (target.includes('\0')) return true;
    const lexical = fold(isAbsolute(target) ? resolve(target) : target);
    if (foldedPaths.some((root) => contains(root, lexical))) return true;
    let probe: string;
    try {
      probe = fold(isAbsolute(target) ? realpathOfNearest(target, { onLoop: 'throw' }) : target);
    } catch {
      return true;
    }
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
          ...(options.stagingRoot !== undefined
            ? { stagingRoot: canonicalize(options.stagingRoot) }
            : {}),
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
      const writableParent = (target: string): boolean => {
        const parent = dirname(target);
        try {
          if (!statSync(parent).isDirectory()) return false;
          accessSync(parent, constants.W_OK);
          return true;
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
        } catch {}
        return probe(target);
      };
      const probeTarget = (target: string) => {
        const stat = probe(target);
        if (stat?.isSymbolicLink() === true && !existsSync(target)) {
          try {
            unlinkSync(target);
          } catch {}
          const after = probe(target);
          if (after?.isSymbolicLink() === true && !existsSync(target)) {
            throw new ComputerRefusal(
              `host shell confinement cannot remove dangling symlink at ${target}`,
            );
          }
          return after;
        }
        return stat;
      };
      for (const directory of rawDeniedDirectories) {
        if (covered(canonicalize(dirname(directory)))) continue;
        let stat = probeTarget(directory);
        const canon = canonicalize(directory);
        if (covered(canon)) continue;
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
      for (const file of rawDeniedFiles) {
        if (covered(canonicalize(dirname(file)))) continue;
        let stat = probeTarget(file);
        const canon = canonicalize(file);
        if (covered(canon)) continue;
        if (stat !== undefined && (stat.isDirectory() || resolvedIsDirectory(file))) {
          mounted.add(canon);
          mounts.push('--tmpfs', canon);
          continue;
        }
        if (stat === undefined) {
          if (!contains(home, file) || !writableParent(file)) continue;
          stat = materialize(file);
        }
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
            const canon = canonicalize(target);
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
      const ancestorPins = existingAncestorsOf([...mounted]).flatMap((dir) => ['--bind', dir, dir]);
      const stagingBind: string[] = [];
      if (options.stagingRoot !== undefined && isSafeStagingRoot(options.stagingRoot)) {
        const stagingCanon = canonicalize(options.stagingRoot);
        if (
          (contains('/tmp', stagingCanon) || contains('/var/tmp', stagingCanon)) &&
          !denied(stagingCanon)
        ) {
          stagingBind.push('--bind', stagingCanon, stagingCanon);
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
          ...stagingBind,
          ...ancestorPins,
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
