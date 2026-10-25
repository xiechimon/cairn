import { execFile } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';

export interface ClaudeBinInfo {
  path: string;
  version: string | null;
  source?: 'PATH' | 'well-known';
}

export type ClaudeBinRun = (
  command: string,
  args: readonly string[],
  opts: { timeoutMs: number },
) => Promise<{ stdout: string }>;

export interface ClaudeBinProbeOpts {
  command?: string;
  timeoutMs?: number;
  run?: ClaudeBinRun;
  env?: { PATH?: string; HOME?: string };
  wellKnownDirs?: readonly string[];
}

const DEFAULT_TIMEOUT_MS = 2_000;

const VERSION_PATTERN = /\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/;

export function parseClaudeVersion(stdout: string): string | null {
  const match = VERSION_PATTERN.exec(stdout);
  return match ? match[0] : null;
}

function isExecutable(p: string): boolean {
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveCommandPath(
  command: string,
  env: { PATH?: string } = process.env,
): string | null {
  if (isAbsolute(command) || command.includes('/')) {
    return isExecutable(command) ? command : null;
  }
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (dir === '') continue;
    const candidate = join(dir, command);
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

// launchd omits login-shell PATH; Homebrew claude needs well-known bin dirs.
export function wellKnownClaudeBinDirs(env: { HOME?: string } = process.env): string[] {
  return ['/opt/homebrew/bin', '/usr/local/bin', join(env.HOME ?? homedir(), '.local/bin')];
}

function resolveWellKnown(command: string, dirs: readonly string[]): string | null {
  for (const dir of dirs) {
    const candidate = join(dir, command);
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

function defaultRun(
  command: string,
  args: readonly string[],
  opts: { timeoutMs: number },
): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, [...args], { timeout: opts.timeoutMs, encoding: 'utf8' }, (err, stdout) => {
      if (typeof stdout === 'string' && stdout.trim() !== '') {
        resolve({ stdout });
        return;
      }
      reject(err ?? new Error('claude --version produced no stdout'));
    });
  });
}

export async function probeClaudeBin(opts: ClaudeBinProbeOpts = {}): Promise<ClaudeBinInfo | null> {
  const command = opts.command ?? process.env.CAIRN_CLAUDE_BIN ?? 'claude';
  if (opts.run === undefined) {
    const env = opts.env ?? process.env;
    const resolved = resolveCommandPath(command, env);
    const fallback =
      resolved === null && !isAbsolute(command) && !command.includes('/')
        ? resolveWellKnown(command, opts.wellKnownDirs ?? wellKnownClaudeBinDirs(env))
        : null;
    const path = resolved ?? fallback;
    if (path === null) return null;
    const source: 'PATH' | 'well-known' = fallback !== null ? 'well-known' : 'PATH';
    const run = defaultRun;
    try {
      const { stdout } = await run(path, ['--version'], {
        timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      });
      return { path, version: parseClaudeVersion(stdout), source };
    } catch {
      return null;
    }
  }
  try {
    const { stdout } = await opts.run(command, ['--version'], {
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    return { path: command, version: parseClaudeVersion(stdout) };
  } catch {
    return null;
  }
}
