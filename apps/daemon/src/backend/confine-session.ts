import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
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
    return output === '' ? null : realpathSync(output);
  } catch {
    return null;
  }
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

function ownState(harness: SessionHarness, home: string, env: NodeJS.ProcessEnv): string[] {
  switch (harness) {
    case 'claude-code': {
      const explicit = env.CLAUDE_CONFIG_DIR;
      if (explicit !== undefined && isAbsolute(explicit)) return [explicit];
      return [join(home, '.claude'), join(home, '.claude.json')];
    }
    case 'pi':
      return [];
    case 'antigravity': {
      const base = isolatedHome(env.HOME, home);
      if (base === null) return [join(home, '.gemini')];
      return [
        base,
        ...(env.GEMINI_API_KEY === undefined
          ? ANTIGRAVITY_CREDENTIAL_FILES.map((file) => join(home, file))
          : []),
      ];
    }
    case 'gemini': {
      const base = isolatedHome(env.GEMINI_CLI_HOME, home);
      if (base === null) return [join(home, '.gemini')];
      return [base, ...GEMINI_CREDENTIAL_FILES.map((file) => join(home, file))];
    }
    case 'devin': {
      const base = isolatedHome(env.HOME, home) ?? home;
      return [
        ...(base === home ? [] : [base]),
        join(base, '.local', 'share', 'devin'),
        join(base, '.cache', 'devin'),
        join(base, '.config', 'devin'),
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
    const state = ownState(harness, home, env)
      .filter((path) => !isStateFile(home, path) || existsSync(path))
      .map((path) => {
        if (!isStateFile(home, path)) mkdirSync(path, { recursive: true, mode: 0o700 });
        return realpathSync(path);
      });
    const handoff = options.handoffDirectories.map((path) => {
      mkdirSync(path, { recursive: true });
      return realpathSync(path);
    });
    const explicitState = [...handoff, ...extraState.map((path) => realpathSync(path))];
    const temp = realpathSync(env.TMPDIR ?? tmpdir());
    const daemonHome = existsSync(options.daemonHome)
      ? realpathSync(options.daemonHome)
      : options.daemonHome;
    const deniedRoots = [daemonHome, ...options.extraDeniedRoots]
      .filter((path) => existsSync(path))
      .map((path) => realpathSync(path));
    const systemTemp =
      options.systemTempDirectory === undefined
        ? systemTempDirectory()
        : options.systemTempDirectory === null
          ? null
          : realpathSync(options.systemTempDirectory);
    const systemUserDirectory =
      systemTemp === null || deniedRoots.some((root) => contains(dirname(systemTemp), root))
        ? null
        : dirname(systemTemp);
    const userDirectories = [...new Set([dirname(temp), systemUserDirectory])].filter(
      (path): path is string => path !== null,
    );
    const harnessTemp =
      harness === 'claude-code' ? join(realpathSync('/tmp'), `claude-${userInfo().uid}`) : null;
    if (harnessTemp !== null) mkdirSync(harnessTemp, { recursive: true, mode: 0o700 });
    const policy: SeatbeltPolicy = {
      home,
      daemonHome,
      deniedRoots,
      workspace,
      gitDirectories: gitDirectoriesOf(workspace),
      taskTemp: temp,
      state: [...state, ...explicitState],
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
      ].filter((path) => existsSync(path)),
      ...(Number.isInteger(port) && port > 0 ? { serverPort: port } : {}),
    };
    return seatbeltCommand(policy, launch.command, launch.args);
  };
}
