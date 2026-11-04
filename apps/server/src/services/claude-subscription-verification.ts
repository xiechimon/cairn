import { type ExecFileException, execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ClaudeSubscriptionVerifyResult } from '@cairn/shared';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 64 * 1024;
const FORWARDED_ENV = [
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'https_proxy',
  'http_proxy',
  'all_proxy',
  'no_proxy',
  'LANG',
  'TZ',
];
const AUTH_FAILURE = /authentication|401|invalid|expired|login/i;

type ExecOutput = { stdout: string; stderr: string };

function childEnv(home: string, token: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { HOME: home, CLAUDE_CODE_OAUTH_TOKEN: token };
  if (process.env.PATH !== undefined) env.PATH = process.env.PATH;
  for (const name of FORWARDED_ENV) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

function classify(failure: ExecFileException, output: ExecOutput): ClaudeSubscriptionVerifyResult {
  if (failure.code === 'ENOENT') return { ok: false, reason: 'unavailable' };
  if (failure.killed === true || failure.code === 'ABORT_ERR') {
    return { ok: false, reason: 'timeout' };
  }
  if (AUTH_FAILURE.test(`${output.stdout}\n${output.stderr}`)) {
    return { ok: false, reason: 'auth' };
  }
  return { ok: false, reason: 'failed' };
}

function runClaude(
  token: string,
  home: string,
  timeoutMs: number,
): Promise<ClaudeSubscriptionVerifyResult> {
  return new Promise((resolve) => {
    execFile(
      process.env.CLAUDE_BIN || 'claude',
      ['-p', 'Reply with OK', '--output-format', 'json', '--no-session-persistence', '--tools', ''],
      {
        cwd: home,
        env: childEnv(home, token),
        timeout: timeoutMs,
        killSignal: 'SIGKILL',
        signal: AbortSignal.timeout(timeoutMs + 2_000),
        maxBuffer: MAX_OUTPUT_BYTES,
        windowsHide: true,
      },
      (error, stdout, stderr) =>
        resolve(error ? classify(error, { stdout, stderr }) : { ok: true }),
    );
  });
}

export async function verifyClaudeSubscription(
  token: string,
  options: { timeoutMs?: number } = {},
): Promise<ClaudeSubscriptionVerifyResult> {
  const home = await mkdtemp(join(tmpdir(), 'cairn-claude-verify-'));
  try {
    return await runClaude(token, home, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}
