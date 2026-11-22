import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { SessionOpts } from '@cairn/shared';
import { ANTIGRAVITY_CREDENTIAL_FILES, GEMINI_CREDENTIAL_FILES } from '../agent-config.js';
import { contains } from './confine.js';
import { type SeatbeltPolicy, seatbeltCommand } from './confine-seatbelt.js';

export type SessionHarness = 'claude-code' | 'gemini' | 'pi' | 'devin' | 'antigravity';

export interface Launch {
  command: string;
  args: string[];
}

export type SessionConfiner = (
  opts: Pick<SessionOpts, 'cwd' | 'env'>,
  harness: SessionHarness,
  launch: Launch,
  state?: readonly string[],
) => Launch;

export interface SessionConfinerOptions {
  daemonHome: string;
  extraDeniedRoots: string[];
  readable: string[];
  handoffDirectories: string[];
  serverUrl: string;
  platform?: string;
  systemTempDirectory?: string | null;
  home?: string;
  environment?: NodeJS.ProcessEnv;
}

const SHARED_CACHES = ['.cache', '.npm', '.cargo/registry', 'go/pkg/mod', 'Library/pnpm'];

function systemTempDirectory(): string | null {
  try {
    const output = execFileSync('/usr/bin/getconf', ['DARWIN_USER_TEMP_DIR'], {
      encoding: 'utf8',
      timeout: 2000,
    }).trim();
    return output === '' || !existsSync(output) ? null : resolvedTail(resolve(output));
  } catch {
    return null;
  }
}

function resolvedTail(path: string): string {
  let cursor = path;
  const missing: string[] = [];
  while (true) {
    const stat = lstatSync(cursor, { throwIfNoEntry: false });
    if (stat !== undefined) {
      if (stat.isSymbolicLink()) throw new Error('Unsafe confinement symlink');
      break;
    }
    missing.unshift(basename(cursor));
    cursor = dirname(cursor);
  }
  return join(realpathSync(cursor), ...missing);
}

function resolvedUnder(root: string, path: string): string {
  const rel = relative(root, path);
  if (rel === '' || isAbsolute(rel) || rel.split(sep).includes('..'))
    throw new Error('Unsafe confinement path');
  const anchor = resolvedTail(root);
  const tail: string[] = [];
  for (const part of rel.split(sep)) {
    tail.push(part);
    const stat = lstatSync(join(anchor, ...tail), { throwIfNoEntry: false });
    if (stat === undefined) break;
    if (stat.isSymbolicLink()) throw new Error('Unsafe confinement symlink');
  }
  return join(anchor, ...rel.split(sep));
}

function gitDirectoriesOf(workspace: string): string[] {
  const dotGit = join(workspace, '.git');
  const stat = lstatSync(dotGit, { throwIfNoEntry: false });
  if (stat === undefined || stat.isSymbolicLink()) return [];
  if (stat.isDirectory()) return [realpathSync(dotGit)];
  if (!stat.isFile()) return [];
  const text = readGitPointer(dotGit);
  if (text === null) return [];
  try {
    const gitdir = realpathSync(resolve(workspace, text));
    const common = dirname(dirname(gitdir));
    if (basename(dirname(gitdir)) !== 'worktrees' || basename(common) !== '.git') return [];
    const back = readRawPointer(join(gitdir, 'gitdir'));
    if (back === null || realpathSync(resolve(gitdir, back)) !== realpathSync(dotGit)) {
      return [];
    }
    return [realpathSync(common)];
  } catch {
    return [];
  }
}

function readGitPointer(dotGit: string): string | null {
  try {
    const text = readFileSync(dotGit, 'utf8');
    const match = /^gitdir:\s*(.+)$/m.exec(text);
    return match?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

function readRawPointer(path: string): string | null {
  try {
    const text = readFileSync(path, 'utf8').trim();
    return text === '' ? null : text;
  } catch {
    return null;
  }
}

function isolatedHome(dir: string | undefined, home: string): string | null {
  if (dir === undefined || !isAbsolute(dir)) return null;
  return existsSync(dir) && realpathSync(dir) === home ? null : dir;
}

interface StateEntry {
  path: string;
  root?: string;
}

function ownState(harness: SessionHarness, home: string, env: NodeJS.ProcessEnv): StateEntry[] {
  switch (harness) {
    case 'claude-code': {
      const explicit = env.CLAUDE_CONFIG_DIR;
      if (explicit !== undefined && isAbsolute(explicit)) return [{ path: explicit }];
      return [
        { path: join(home, '.claude'), root: home },
        { path: join(home, '.claude.json'), root: home },
      ];
    }
    case 'pi':
      return [];
    case 'antigravity': {
      const base = isolatedHome(env.HOME, home);
      if (base === null) return [{ path: join(home, '.gemini'), root: home }];
      return [
        { path: base },
        ...(env.GEMINI_API_KEY === undefined
          ? ANTIGRAVITY_CREDENTIAL_FILES.map((file) => ({
              path: join(home, file),
              root: home,
            }))
          : []),
      ];
    }
    case 'gemini': {
      const base = isolatedHome(env.GEMINI_CLI_HOME, home);
      if (base === null) return [{ path: join(home, '.gemini'), root: home }];
      return [
        { path: base },
        ...GEMINI_CREDENTIAL_FILES.map((file) => ({ path: join(home, file), root: home })),
      ];
    }
    case 'devin': {
      const base = isolatedHome(env.HOME, home) ?? home;
      return [
        ...(base === home ? [] : [{ path: base }]),
        { path: join(base, '.local', 'share', 'devin'), root: base },
        { path: join(base, '.cache', 'devin'), root: base },
        { path: join(base, '.config', 'devin'), root: base },
      ];
    }
  }
}

const STATE_FILES = new Set<string>([
  '.claude.json',
  ...ANTIGRAVITY_CREDENTIAL_FILES,
  ...GEMINI_CREDENTIAL_FILES,
]);

function isStateFile(home: string, path: string): boolean {
  return [...STATE_FILES].some((file) => path === join(home, file));
}

export function createSessionConfiner(options: SessionConfinerOptions): SessionConfiner | null {
  if ((options.platform ?? process.platform) !== 'darwin') return null;
  const environment = options.environment ?? process.env;
  const home = realpathSync(options.home ?? homedir());
  const serverUrl = new URL(options.serverUrl);
  const port =
    serverUrl.port === '' ? (serverUrl.protocol === 'https:' ? 443 : 80) : Number(serverUrl.port);
  return (opts, harness, launch, extraState = []) => {
    const env = { ...environment, ...opts.env };
    const workspace = realpathSync(opts.cwd);
    const tempInput = resolve(env.TMPDIR ?? tmpdir());
    const systemTempInput =
      options.systemTempDirectory === undefined || options.systemTempDirectory === null
        ? null
        : resolve(options.systemTempDirectory);
    const stateEntries = ownState(harness, home, env).filter(
      (entry) => !isStateFile(home, entry.path) || existsSync(entry.path),
    );
    const harnessTemp =
      harness === 'claude-code' ? join(realpathSync('/tmp'), `claude-${userInfo().uid}`) : null;
    const writableRoots = new Set([
      workspace,
      tempInput,
      dirname(tempInput),
      ...(systemTempInput === null ? [] : [systemTempInput, dirname(systemTempInput)]),
      ...(harnessTemp === null ? [] : [harnessTemp]),
      ...stateEntries
        .filter((entry) => !isStateFile(home, entry.path))
        .map((entry) => resolve(entry.path)),
      ...options.handoffDirectories.map((path) => resolve(path)),
      ...extraState.map((path) => resolve(path)),
      ...SHARED_CACHES.map((path) => join(home, path)).filter((path) => existsSync(path)),
    ]);
    const grantPath = (path: string, root?: string): string => {
      const lexical = resolve(path);
      let anchor = root === undefined ? undefined : resolve(root);
      if (anchor === undefined) {
        for (const candidate of writableRoots) {
          const rel = relative(candidate, lexical);
          if (rel === '' || isAbsolute(rel) || rel.split(sep).includes('..')) continue;
          if (anchor === undefined || candidate.length > anchor.length) anchor = candidate;
        }
      }
      return anchor === undefined ? resolvedTail(lexical) : resolvedUnder(anchor, lexical);
    };
    const temp = grantPath(tempInput);
    writableRoots.add(temp);
    writableRoots.add(dirname(temp));
    const daemonHome = existsSync(options.daemonHome)
      ? realpathSync(options.daemonHome)
      : options.daemonHome;
    const deniedRoots = [daemonHome, ...options.extraDeniedRoots]
      .filter((path) => existsSync(path))
      .map((path) => realpathSync(path));
    const systemTemp =
      options.systemTempDirectory === undefined
        ? systemTempDirectory()
        : systemTempInput === null
          ? null
          : grantPath(systemTempInput);
    if (systemTemp !== null) {
      writableRoots.add(systemTemp);
      writableRoots.add(dirname(systemTemp));
    }
    const systemUserDirectory =
      systemTemp === null || deniedRoots.some((root) => contains(dirname(systemTemp), root))
        ? null
        : dirname(systemTemp);
    const userDirectories = [...new Set([dirname(temp), systemUserDirectory])].filter(
      (path): path is string => path !== null,
    );
    const state = stateEntries.map((entry) => ({
      lexical: grantPath(entry.path, entry.root),
      dir: !isStateFile(home, entry.path),
    }));
    const handoff = options.handoffDirectories.map((path) => grantPath(path));
    const explicitState = [...handoff, ...extraState.map((path) => grantPath(path))];
    const policy: SeatbeltPolicy = {
      home,
      daemonHome,
      deniedRoots,
      workspace,
      gitDirectories: gitDirectoriesOf(workspace),
      taskTemp: temp,
      state: [...state.map((entry) => entry.lexical), ...explicitState],
      caches: [
        ...userDirectories,
        ...(harnessTemp === null ? [] : [harnessTemp]),
        ...SHARED_CACHES.map((path) => join(home, path)).filter((path) => existsSync(path)),
      ],
      readable: [
        ...options.readable,
        ...(harness === 'antigravity' && opts.env?.GEMINI_API_KEY === undefined
          ? [join(home, 'Library', 'Keychains')]
          : []),
      ]
        .filter((path) => existsSync(path))
        .map((path) => realpathSync(path)),
      ...(Number.isInteger(port) && port > 0 ? { serverPort: port } : {}),
    };
    const confined = seatbeltCommand(policy, launch.command, launch.args);
    for (const entry of state) {
      if (entry.dir) mkdirSync(entry.lexical, { recursive: true, mode: 0o700 });
    }
    for (const dir of handoff) mkdirSync(dir, { recursive: true });
    if (harnessTemp !== null && !existsSync(harnessTemp))
      mkdirSync(harnessTemp, { recursive: true, mode: 0o700 });
    return confined;
  };
}
