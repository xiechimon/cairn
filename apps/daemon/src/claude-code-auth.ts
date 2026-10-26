import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type ClaudeCodeAuthProbe =
  | { state: 'logged-in'; method: string; provider: string }
  | { state: 'not-logged-in'; provider: string }
  | { state: 'unknown'; reason: string };

export type ClaudeCodeAuthRun = (
  command: string,
  args: readonly string[],
  opts: { timeoutMs: number },
) => Promise<{ stdout: string }>;

export interface ClaudeCodeAuthProbeOpts {
  command?: string;
  timeoutMs?: number;
  run?: ClaudeCodeAuthRun;
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
  opts: { timeoutMs: number },
): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, [...args], { timeout: opts.timeoutMs, encoding: 'utf8' }, (err, stdout) => {
      if (typeof stdout === 'string' && stdout.trim() !== '') {
        resolve({ stdout });
        return;
      }
      reject(err ?? new Error('claude auth status produced no stdout'));
    });
  });
}

export async function probeClaudeCodeAuth(
  opts: ClaudeCodeAuthProbeOpts = {},
): Promise<ClaudeCodeAuthProbe> {
  const command = opts.command ?? process.env.CAIRN_CLAUDE_BIN ?? 'claude';
  const run = opts.run ?? defaultRun;
  try {
    const { stdout } = await run(command, ['auth', 'status'], {
      timeoutMs: opts.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
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
  const expiresAt = (oauth as { expiresAt?: unknown }).expiresAt;
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return null;
  return Math.trunc(expiresAt);
}

export function readDefaultClaudeOauthExpiresAt(): number | null {
  try {
    return parseClaudeOauthExpiresAt(
      readFileSync(join(homedir(), '.claude', '.credentials.json'), 'utf8'),
    );
  } catch {
    return null;
  }
}

export function claudeCodeAuthFailureMessage(machineName: string): string {
  return [
    `claude-code 步骤无法在机器「${machineName}」上执行：该机器没有可用的 Claude Code 凭据`,
    '（预检 `claude auth status` = 未登录）。',
    '补法（在该机器上做，任选其一）：① 运行 `claude` 完成 /login；',
    '② 在 ~/.claude/settings.json 的 env 里配 ANTHROPIC_API_KEY 或 ANTHROPIC_AUTH_TOKEN；',
    '③ 配 apiKeyHelper 输出密钥。',
    '凭据不跨机——每台要跑 claude-code 的机器各自配（cairn 不传登录态）。',
  ].join('');
}
