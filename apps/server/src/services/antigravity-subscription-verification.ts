import { spawn } from 'node:child_process';
import { accessSync, constants, readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import {
  type AntigravitySubscriptionVerifyResult,
  antigravityBinaryCandidates,
} from '@cairn/shared';

const DEFAULT_TIMEOUT_MS = 30_000;
const MANAGED_ROOT = join(homedir(), '.local', 'share', 'cairn', 'antigravity');
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

function childEnv(home: string, token: string | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    HOME: token !== undefined ? home : homedir(),
    ...(token !== undefined ? { GEMINI_API_KEY: token, GEMINI_HOME: home } : {}),
  };
  if (process.env.PATH !== undefined) env.PATH = process.env.PATH;
  for (const name of FORWARDED_ENV) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

function managedVersions(): string[] {
  const versions: string[] = [];
  try {
    for (const entry of readdirSync(join(MANAGED_ROOT, 'versions'), { withFileTypes: true })) {
      if (entry.isDirectory()) versions.push(entry.name);
    }
  } catch {}
  return versions;
}

function managedMarkerCommand(): { command: string; args: string[] } | null {
  const dirs: string[] = [];
  try {
    const current = JSON.parse(readFileSync(join(MANAGED_ROOT, 'current.json'), 'utf8')) as {
      version?: unknown;
    };
    if (typeof current.version === 'string') {
      dirs.push(join(MANAGED_ROOT, 'versions', current.version));
    }
  } catch {}
  for (const version of managedVersions().sort().reverse()) {
    dirs.push(join(MANAGED_ROOT, 'versions', version));
  }
  for (const dir of dirs) {
    try {
      const marker = JSON.parse(readFileSync(join(dir, '.install-complete'), 'utf8')) as {
        binRelPath?: unknown;
        args?: unknown;
      };
      if (typeof marker.binRelPath !== 'string') continue;
      const binPath = join(dir, marker.binRelPath);
      accessSync(binPath, constants.X_OK);
      if (!statSync(binPath).isFile()) continue;
      const args =
        Array.isArray(marker.args) && marker.args.every((arg) => typeof arg === 'string')
          ? marker.args
          : ['acp'];
      return { command: binPath, args };
    } catch {}
  }
  return null;
}

function resolveAgyBinary(): { command: string; args: string[] } {
  const explicit = process.env.AGY_BIN ?? process.env.CAIRN_AGY_PATH;
  const managed = managedMarkerCommand();
  const candidates = antigravityBinaryCandidates({
    home: homedir(),
    pathEnv: process.env.PATH,
    managedVersions: managedVersions(),
    explicitPath: explicit,
  });
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      if (statSync(candidate).isFile()) return { command: candidate, args: ['acp'] };
    } catch {}
  }
  return managed ?? { command: 'agy', args: ['acp'] };
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

function errorResult(text: string, hostOnly: boolean): AntigravitySubscriptionVerifyResult {
  if (!AUTH_FAILURE.test(text)) return { ok: false, reason: 'failed' };
  return hostOnly ? { ok: false, reason: 'missing_local_login' } : { ok: false, reason: 'auth' };
}

function probe(
  token: string | undefined,
  home: string,
  timeoutMs: number,
): Promise<AntigravitySubscriptionVerifyResult> {
  return new Promise((resolve) => {
    const hostOnly = token === undefined;
    const bin = resolveAgyBinary();
    const args = basename(bin.command).startsWith('agy')
      ? [...bin.args, '--log-file', join(home, 'probe.log')]
      : bin.args;
    const child = spawn(bin.command, args, {
      cwd: home,
      env: childEnv(home, token),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let settled = false;
    let output = '';
    let buffer = '';
    let hasApiKeyMethod = false;
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
          finish(errorResult(message.error.message ?? '', hostOnly));
          return;
        }
        const methods = (message.result?.authMethods ?? [])
          .map((method) => method.id)
          .filter((id): id is string => typeof id === 'string');
        hasApiKeyMethod = methods.includes('gemini-api-key');
        write(2, 'session/new', { cwd: home, mcpServers: [] });
        return;
      }
      if (message.id === 2) {
        if (message.error === undefined) {
          finish({ ok: true });
          return;
        }
        if (
          token !== undefined &&
          hasApiKeyMethod &&
          AUTH_FAILURE.test(message.error.message ?? '')
        ) {
          write(3, 'authenticate', { methodId: 'gemini-api-key', _meta: { api_key: token } });
          return;
        }
        finish(errorResult(message.error.message ?? '', hostOnly));
        return;
      }
      if (message.id === 3) {
        if (message.error !== undefined) {
          finish(errorResult(message.error.message ?? '', hostOnly));
          return;
        }
        write(4, 'session/new', { cwd: home, mcpServers: [] });
        return;
      }
      if (message.id === 4) {
        finish(
          message.error === undefined
            ? { ok: true }
            : errorResult(message.error.message ?? '', hostOnly),
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
      finish(code === 0 ? { ok: false, reason: 'failed' } : errorResult(output, hostOnly));
    });
    write(1, 'initialize', { protocolVersion: 1, clientCapabilities: {} });
  });
}

export async function verifyAntigravitySubscription(
  token: string,
  options: { timeoutMs?: number } = {},
): Promise<AntigravitySubscriptionVerifyResult> {
  const home = await mkdtemp(join(tmpdir(), 'cairn-antigravity-verify-'));
  try {
    return await probe(token, home, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

export async function verifyAntigravityHostLogin(
  options: { timeoutMs?: number } = {},
): Promise<AntigravitySubscriptionVerifyResult> {
  const home = await mkdtemp(join(tmpdir(), 'cairn-antigravity-host-verify-'));
  try {
    return await probe(undefined, home, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}
