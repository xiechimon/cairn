import { spawn } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AntigravitySubscriptionVerifyResult } from '@cairn/shared';
import {
  ANTIGRAVITY_ACP_ARGS,
  currentAntigravityManagedInstall,
} from '@cairn/shared/antigravity-install';

const DEFAULT_TIMEOUT_MS = 30_000;
const MANAGED_ROOT = join(homedir(), '.cairn', 'tools', 'antigravity');
export const ANTIGRAVITY_MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
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
const AUTH_FAILURE =
  /authentication|401|invalid|expired|login|unauthorized|forbidden|auth method|api key/i;

function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { HOME: homedir(), AGY_CLI_DISABLE_AUTO_UPDATE: '1' };
  if (process.env.PATH !== undefined) env.PATH = process.env.PATH;
  for (const name of FORWARDED_ENV) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function resolveAgyBinary(): { command: string; args: string[] } {
  const explicit = process.env.AGY_BIN ?? process.env.CAIRN_AGY_PATH;
  if (explicit !== undefined && explicit.trim() !== '' && isExecutableFile(explicit.trim())) {
    return { command: explicit.trim(), args: [...ANTIGRAVITY_ACP_ARGS] };
  }
  const managed = currentAntigravityManagedInstall(MANAGED_ROOT);
  if (managed !== null && isExecutableFile(managed.binPath)) {
    return { command: managed.binPath, args: managed.args };
  }
  const candidates = [
    `${homedir()}/.local/bin/agy`,
    '/opt/homebrew/bin/agy',
    '/usr/local/bin/agy',
    ...(process.env.PATH ?? '')
      .split(':')
      .filter((dir) => dir !== '')
      .map((dir) => join(dir, 'agy')),
  ];
  for (const candidate of candidates) {
    if (isExecutableFile(candidate)) return { command: candidate, args: [...ANTIGRAVITY_ACP_ARGS] };
  }
  return { command: 'agy', args: [...ANTIGRAVITY_ACP_ARGS] };
}

function collectLines(buffer: string): { lines: string[]; rest: string } {
  const lines: string[] = [];
  let rest = buffer;
  let index = rest.indexOf('\n');
  while (index >= 0) {
    lines.push(rest.slice(0, index));
    rest = rest.slice(index + 1);
    index = rest.indexOf('\n');
  }
  return { lines, rest };
}

function errorResult(text: string): AntigravitySubscriptionVerifyResult {
  return AUTH_FAILURE.test(text)
    ? { ok: false, reason: 'missing_local_login' }
    : { ok: false, reason: 'failed' };
}

function probe(home: string, timeoutMs: number): Promise<AntigravitySubscriptionVerifyResult> {
  return new Promise((resolve) => {
    const bin = resolveAgyBinary();
    const args = [...bin.args, '--log-file', join(home, 'probe.log')];
    const child = spawn(bin.command, args, {
      cwd: home,
      env: childEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let settled = false;
    let output = '';
    let buffer = '';
    const finish = (result: AntigravitySubscriptionVerifyResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGKILL');
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), timeoutMs);
    const write = (id: number, method: string, params: unknown) => {
      try {
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      } catch {
        finish({ ok: false, reason: 'failed' });
      }
    };
    const onMessage = (line: string) => {
      let message: {
        id?: number;
        error?: { code?: number; message?: string };
      };
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.id === 1) {
        if (message.error !== undefined) {
          finish(errorResult(message.error.message ?? ''));
          return;
        }
        write(2, 'session/new', { cwd: home, mcpServers: [] });
        return;
      }
      if (message.id === 2) {
        finish(
          message.error === undefined ? { ok: true } : errorResult(message.error.message ?? ''),
        );
      }
    };
    child.on('error', (error: NodeJS.ErrnoException) => {
      finish(
        error.code === 'ENOENT'
          ? { ok: false, reason: 'unavailable' }
          : { ok: false, reason: 'failed' },
      );
    });
    child.stdout.on('data', (chunk: Buffer) => {
      const { lines, rest } = collectLines(buffer + chunk.toString('utf8'));
      buffer = rest;
      for (const line of lines) {
        if (line.trim() !== '') onMessage(line);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.on('close', (code) => {
      if (settled) return;
      finish(code === 0 ? { ok: false, reason: 'failed' } : errorResult(output));
    });
    write(1, 'initialize', { protocolVersion: 1, clientCapabilities: {} });
  });
}

export async function verifyAntigravitySubscription(
  token: string,
  options: { timeoutMs?: number } = {},
): Promise<AntigravitySubscriptionVerifyResult> {
  try {
    const response = await fetch(ANTIGRAVITY_MODELS_URL, {
      headers: { 'x-goog-api-key': token },
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (response.ok || response.status === 429) return { ok: true };
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      return { ok: false, reason: 'auth' };
    }
    return { ok: false, reason: 'failed' };
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    return {
      ok: false,
      reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'unavailable',
    };
  }
}

export async function verifyAntigravityHostLogin(
  options: { timeoutMs?: number } = {},
): Promise<AntigravitySubscriptionVerifyResult> {
  const home = await mkdtemp(join(tmpdir(), 'cairn-antigravity-host-verify-'));
  try {
    return await probe(home, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}
