import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { CLAUDE_CODE_AUTH_FAILURE_MARKER } from '@cairn/shared';
import { bundledClaudeCodePath } from './claude-code-bin.js';

export type ClaudeCodeAuthProbe =
  | { state: 'logged-in'; method: string; provider: string }
  | { state: 'not-logged-in'; provider: string }
  | { state: 'unknown'; reason: string };

export type ClaudeCodeAuthRun = (
  command: string,
  args: readonly string[],
  opts: { timeoutMs: number; env?: NodeJS.ProcessEnv },
) => Promise<{ stdout: string }>;

export interface ClaudeCodeAuthProbeOpts {
  command?: string;
  timeoutMs?: number;
  run?: ClaudeCodeAuthRun;
  env?: NodeJS.ProcessEnv;
  bundledPath?: string | null;
}

const DEFAULT_PROBE_TIMEOUT_MS = 5_000;

export function parseClaudeCodeAuthStatus(stdout: string): ClaudeCodeAuthProbe {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { state: 'unknown', reason: 'claude auth status returned non-JSON output' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { state: 'unknown', reason: 'claude auth status returned a non-object payload' };
  }
  const { loggedIn, authMethod, apiProvider } = parsed as {
    loggedIn?: unknown;
    authMethod?: unknown;
    apiProvider?: unknown;
  };
  if (typeof loggedIn !== 'boolean') {
    return { state: 'unknown', reason: 'claude auth status JSON has no boolean loggedIn' };
  }
  const provider = typeof apiProvider === 'string' ? apiProvider : 'firstParty';
  if (!loggedIn) return { state: 'not-logged-in', provider };
  return {
    state: 'logged-in',
    method: typeof authMethod === 'string' ? authMethod : 'unknown',
    provider,
  };
}

function defaultRun(
  command: string,
  args: readonly string[],
  opts: { timeoutMs: number; env?: NodeJS.ProcessEnv },
): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      { timeout: opts.timeoutMs, encoding: 'utf8', env: opts.env },
      (err, stdout) => {
        if (typeof stdout === 'string' && stdout.trim() !== '') {
          resolve({ stdout });
          return;
        }
        reject(err ?? new Error('claude auth status produced no stdout'));
      },
    );
  });
}

export async function probeClaudeCodeAuth(
  opts: ClaudeCodeAuthProbeOpts = {},
): Promise<ClaudeCodeAuthProbe> {
  const command =
    opts.command ??
    process.env.CAIRN_CLAUDE_BIN ??
    (opts.bundledPath !== undefined ? opts.bundledPath : bundledClaudeCodePath());
  if (command === null) {
    return { state: 'unknown', reason: 'managed claude binary is not installed' };
  }
  const run = opts.run ?? defaultRun;
  try {
    const { stdout } = await run(command, ['auth', 'status'], {
      timeoutMs: opts.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
      env: opts.env,
    });
    return parseClaudeCodeAuthStatus(stdout);
  } catch (err) {
    return {
      state: 'unknown',
      reason: `probe failed (${command} auth status): ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}

export function parseClaudeOauthExpiresAt(raw: string): number | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const oauth = (parsed as { claudeAiOauth?: unknown }).claudeAiOauth;
  if (typeof oauth !== 'object' || oauth === null || Array.isArray(oauth)) return null;
  const {
    expiresAt: accessExpiresAt,
    refreshToken,
    refreshTokenExpiresAt,
  } = oauth as {
    expiresAt?: unknown;
    refreshToken?: unknown;
    refreshTokenExpiresAt?: unknown;
  };
  const refreshable = typeof refreshToken === 'string' && refreshToken.length > 0;
  const expiresAt = refreshable ? refreshTokenExpiresAt : accessExpiresAt;
  if (typeof expiresAt !== 'number' || !Number.isSafeInteger(Math.trunc(expiresAt))) return null;
  if (refreshable && typeof accessExpiresAt === 'number') {
    if (!Number.isSafeInteger(Math.trunc(accessExpiresAt))) return null;
    return Math.trunc(Math.max(expiresAt, accessExpiresAt));
  }
  return Math.trunc(expiresAt);
}

export function readDefaultClaudeOauthExpiresAt(configDir: string): number | null {
  if (!isAbsolute(configDir)) return null;
  try {
    return parseClaudeOauthExpiresAt(
      readFileSync(join(configDir.normalize('NFC'), '.credentials.json'), 'utf8'),
    );
  } catch {
    return null;
  }
}

export function claudeCodeSubscriptionMissingMessage(): string {
  return [
    `${CLAUDE_CODE_AUTH_FAILURE_MARKER} `,
    'claude-code 步骤没有启动：团队暂无可用的 Claude 订阅。执行机自己的 Claude 登录不会被使用。',
    '补法：在终端运行 `claude setup-token`，把 token 添加到 cairn 的「设置 → 模型路由」。',
  ].join('');
}

export function claudeCodeTeamSubscriptionAuthFailureMessage(cliMessage: string): string {
  return [
    `${CLAUDE_CODE_AUTH_FAILURE_MARKER} `,
    '你的 Claude 订阅登录已失效（token 被拒绝或已撤销），Coordinator 和任务暂时无法使用。',
    '补法：在 cairn 的「设置 → 模型路由」里移除这个失效的订阅，',
    '再在终端运行 `claude setup-token` 拿一个新 token 添加回来。',
    `CLI 原因：${cliMessage}`,
  ].join('');
}
