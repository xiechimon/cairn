import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { SessionOpts } from '@cairn/shared';
import { contains } from './confine.js';
import { type SeatbeltPolicy, seatbeltCommand } from './confine-seatbelt.js';

export type SessionHarness = 'claude-code' | 'codex' | 'gemini' | 'pi' | 'devin' | 'antigravity';

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
  if (!existsSync(dotGit)) return [];
  const text = readGitPointer(dotGit);
  if (text === null) return [realpathSync(dotGit)];
  const gitdir = resolve(workspace, text);
  const common = dirname(dirname(gitdir));
  return [realpathSync(common)];
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

function ownState(harness: SessionHarness, home: string, env: NodeJS.ProcessEnv): string[] {
  const explicit =
    harness === 'claude-code' ? env.CLAUDE_CONFIG_DIR : harness === 'codex' ? env.CODEX_HOME : null;
  if (explicit !== undefined && explicit !== null && isAbsolute(explicit)) return [explicit];
  if (harness === 'pi') return [];
  if (harness === 'antigravity') {
    if (env.GEMINI_HOME !== undefined && isAbsolute(env.GEMINI_HOME)) return [env.GEMINI_HOME];
    return [join(home, '.gemini')];
  }
  if (harness === 'devin') {
    if (env.HOME === undefined || !isAbsolute(env.HOME) || realpathSync(env.HOME) === home)
      return [];
    const base = env.HOME;
    return [
      base,
      join(base, '.local', 'share', 'devin'),
      join(base, '.cache', 'devin'),
      join(base, '.config', 'devin'),
    ];
  }
  const name = harness === 'claude-code' ? '.claude' : harness === 'codex' ? '.codex' : '.gemini';
  const defaults = [join(home, name)];
  if (harness === 'claude-code') defaults.push(join(home, '.claude.json'));
  return defaults;
}

export function createSessionConfiner(options: SessionConfinerOptions): SessionConfiner | null {
  if ((options.platform ?? process.platform) !== 'darwin') return null;
  const environment = options.environment ?? process.env;
  const home = realpathSync(options.home ?? homedir());
  const port = Number(new URL(options.serverUrl).port);
  return (opts, harness, launch, extraState = []) => {
    const env = { ...environment, ...opts.env };
    const workspace = realpathSync(opts.cwd);
    const state = ownState(harness, home, env)
      .filter((path) => !path.endsWith('.claude.json') || existsSync(path))
      .map((path) => {
        if (!path.endsWith('.claude.json')) mkdirSync(path, { recursive: true });
        return realpathSync(path);
      });
    const handoff = options.handoffDirectories.map((path) => {
      mkdirSync(path, { recursive: true });
      return realpathSync(path);
    });
    const explicitState = [...handoff, ...extraState.map((path) => realpathSync(path))];
    const temp = realpathSync(env.TMPDIR ?? tmpdir());
    const deniedRoots = [options.daemonHome, ...options.extraDeniedRoots]
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
    const policy: SeatbeltPolicy = {
      home,
      deniedRoots,
      workspace,
      gitDirectories: gitDirectoriesOf(workspace),
      taskTemp: temp,
      state: [...state, ...explicitState],
      caches: [
        ...userDirectories,
        ...SHARED_CACHES.map((path) => join(home, path)).filter((path) => existsSync(path)),
      ],
      readable: [
        ...options.readable,
        ...(harness === 'antigravity' && env.GEMINI_HOME === undefined
          ? [join(home, 'Library', 'Keychains')]
          : []),
      ].filter((path) => existsSync(path)),
      ...(Number.isInteger(port) && port > 0 ? { serverPort: port } : {}),
    };
    return seatbeltCommand(policy, launch.command, launch.args);
  };
}
