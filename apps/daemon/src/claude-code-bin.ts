import { execFile } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, isAbsolute, join } from 'node:path';
import { arch, platform } from 'node:process';

export interface ClaudeBinInfo {
  path: string;
  version: string | null;
  source: 'override' | 'bundled';
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
  env?: { PATH?: string };
  bundledPath?: string | null;
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

function sdkBundledCandidates(): string[] {
  const key = `${platform}-${arch}`;
  const candidates = [key];
  if (platform === 'linux') candidates.push(`${key}-musl`);
  return candidates;
}

export function bundledClaudeCodePath(
  resolve: (specifier: string) => string = createRequire(
    createRequire(import.meta.url).resolve('@anthropic-ai/claude-agent-sdk'),
  ).resolve,
): string | null {
  for (const candidate of sdkBundledCandidates()) {
    try {
      return resolve(`@anthropic-ai/claude-agent-sdk-${candidate}/claude`);
    } catch {}
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
  const override = opts.command ?? process.env.CAIRN_CLAUDE_BIN;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (opts.run !== undefined) {
    const command =
      override ??
      (opts.bundledPath !== undefined ? opts.bundledPath : bundledClaudeCodePath()) ??
      'claude';
    try {
      const { stdout } = await opts.run(command, ['--version'], { timeoutMs });
      return {
        path: command,
        version: parseClaudeVersion(stdout),
        source: override !== undefined ? 'override' : 'bundled',
      };
    } catch {
      return null;
    }
  }
  let info: { path: string; source: 'override' | 'bundled' } | null = null;
  if (override !== undefined) {
    const resolved = resolveCommandPath(override, opts.env ?? process.env);
    if (resolved !== null) info = { path: resolved, source: 'override' };
  } else {
    const path = opts.bundledPath !== undefined ? opts.bundledPath : bundledClaudeCodePath();
    if (path !== null) info = { path, source: 'bundled' };
  }
  if (info === null) return null;
  try {
    const { stdout } = await defaultRun(info.path, ['--version'], { timeoutMs });
    return { path: info.path, version: parseClaudeVersion(stdout), source: info.source };
  } catch {
    return null;
  }
}
