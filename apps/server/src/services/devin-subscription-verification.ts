import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DevinSubscriptionVerifyResult } from '@cairn/shared';

const DEFAULT_TIMEOUT_MS = 30_000;
const MANAGED_INSTALL_ROOT = join(homedir(), '.local', 'share', 'cairn', 'devin');
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
const AUTH_FAILURE = /authentication|401|invalid|expired|login|unauthorized|forbidden|auth method/i;

function childEnv(home: string, token: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { HOME: home, WINDSURF_API_KEY: token };
  if (process.env.PATH !== undefined) env.PATH = process.env.PATH;
  for (const name of FORWARDED_ENV) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

function managedBin(): { command: string; args: string[] } | null {
  const versionDirs: string[] = [];
  try {
    const current = JSON.parse(
      readFileSync(join(MANAGED_INSTALL_ROOT, 'current.json'), 'utf8'),
    ) as { version?: unknown };
    if (typeof current.version === 'string') {
      versionDirs.push(join(MANAGED_INSTALL_ROOT, 'versions', current.version));
    }
  } catch {}
  try {
    for (const entry of readdirSync(join(MANAGED_INSTALL_ROOT, 'versions')).sort().reverse()) {
      versionDirs.push(join(MANAGED_INSTALL_ROOT, 'versions', entry));
    }
  } catch {}
  for (const dir of versionDirs) {
    try {
      const marker = JSON.parse(readFileSync(join(dir, '.install-complete'), 'utf8')) as {
        binRelPath?: unknown;
        args?: unknown;
      };
      if (typeof marker.binRelPath !== 'string') continue;
      const binPath = join(dir, marker.binRelPath);
      if (!existsSync(binPath)) continue;
      const args =
        Array.isArray(marker.args) && marker.args.every((arg) => typeof arg === 'string')
          ? marker.args
          : ['acp'];
      return { command: binPath, args };
    } catch {}
  }
  return null;
}

function devinBin(): { command: string; args: string[] } {
  if (process.env.DEVIN_BIN !== undefined && process.env.DEVIN_BIN !== '') {
    return { command: process.env.DEVIN_BIN, args: ['acp'] };
  }
  return managedBin() ?? { command: 'devin', args: ['acp'] };
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

function errorReason(text: string): DevinSubscriptionVerifyResult {
  return AUTH_FAILURE.test(text) ? { ok: false, reason: 'auth' } : { ok: false, reason: 'failed' };
}

function probe(
  token: string,
  home: string,
  timeoutMs: number,
): Promise<DevinSubscriptionVerifyResult> {
  return new Promise((resolve) => {
    const bin = devinBin();
    const child = spawn(bin.command, bin.args, {
      cwd: home,
      env: childEnv(home, token),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let settled = false;
    let output = '';
    let buffer = '';
    const finish = (result: DevinSubscriptionVerifyResult) => {
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
        result?: { authMethods?: { id?: unknown }[] };
        error?: { code?: number; message?: string };
      };
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.id === 1) {
        if (message.error !== undefined) {
          finish(errorReason(message.error.message ?? ''));
          return;
        }
        const methods = (message.result?.authMethods ?? [])
          .map((method) => method.id)
          .filter((id): id is string => typeof id === 'string');
        const methodId = methods.find((id) => /devin|key|token/i.test(id)) ?? methods[0] ?? null;
        if (methodId !== null) {
          write(2, 'authenticate', { methodId, _meta: { api_key: token } });
        } else {
          write(3, 'session/new', { cwd: home, mcpServers: [] });
        }
        return;
      }
      if (message.id === 2 || message.id === 3) {
        finish(
          message.error === undefined ? { ok: true } : errorReason(message.error.message ?? ''),
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
      finish(code === 0 ? { ok: false, reason: 'failed' } : errorReason(output));
    });
    write(1, 'initialize', { protocolVersion: 1, clientCapabilities: {} });
  });
}

export async function verifyDevinSubscription(
  token: string,
  options: { timeoutMs?: number } = {},
): Promise<DevinSubscriptionVerifyResult> {
  const home = await mkdtemp(join(tmpdir(), 'cairn-devin-verify-'));
  try {
    return await probe(token, home, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}
