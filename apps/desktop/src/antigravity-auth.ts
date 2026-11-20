import { type ChildProcess, spawn } from 'node:child_process';
import {
  accessSync,
  constants,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import {
  type AntigravityLocalStatus,
  type AntigravityLoginOutcome,
  antigravityCliDir,
  antigravityKeyFromText,
  managedVersionedBins,
} from '@cairn/shared';

const STATUS_TIMEOUT_MS = 4_000;
const LOGIN_TIMEOUT_MS = 600_000;

interface ResolvedBinary {
  binPath: string;
  source: 'local' | 'managed';
}

interface JsonRpcMessage {
  id?: unknown;
  result?: {
    agentInfo?: { version?: unknown };
    authMethods?: { id?: unknown }[];
  };
  error?: unknown;
}

function managedVersionsRoot(): string {
  return `${homedir()}/.cairn/tools/antigravity/versions`;
}

function managedVersions(): string[] {
  try {
    return readdirSync(managedVersionsRoot(), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function resolveAntigravityBinary(): ResolvedBinary | null {
  const explicit = process.env.CAIRN_AGY_PATH?.trim();
  const candidates = [
    ...(explicit !== undefined && explicit !== '' ? [explicit] : []),
    ...managedVersionedBins(managedVersionsRoot(), managedVersions(), [
      'bin/antigravity-acp',
      'bin/agy',
    ]),
  ];
  for (const candidate of candidates) {
    if (!isExecutableFile(candidate)) continue;
    return { binPath: candidate, source: 'managed' };
  }
  return null;
}

function acpSpawnArgs(binPath: string, logFile: string): string[] {
  return basename(binPath).startsWith('agy') ? ['acp', '--log-file', logFile] : ['acp'];
}

function sendJsonRpc(child: ChildProcess, message: Record<string, unknown>): void {
  try {
    child.stdin?.write(`${JSON.stringify(message)}\n`);
  } catch {}
}

function attachNdjsonReader(
  child: ChildProcess,
  onMessage: (message: JsonRpcMessage) => void,
): void {
  let buffer = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
      if (line.trim() === '') continue;
      try {
        onMessage(JSON.parse(line) as JsonRpcMessage);
      } catch {}
    }
  });
}

function pickAuthMethod(authMethods: { id?: unknown }[] | undefined): string {
  if (!Array.isArray(authMethods)) return 'oauth-personal';
  if (authMethods.some((method) => method?.id === 'oauth-personal')) return 'oauth-personal';
  const first = authMethods.find((method) => typeof method?.id === 'string')?.id;
  return typeof first === 'string' ? first : 'oauth-personal';
}

export async function antigravityLocalStatus(): Promise<AntigravityLocalStatus> {
  const resolved = resolveAntigravityBinary();
  if (resolved === null) {
    return { installed: false, loggedIn: false, canLogin: false };
  }
  const probeDir = mkdtempSync(join(tmpdir(), 'cairn-agy-status-'));
  let child: ChildProcess | null = null;
  let exited = false;

  try {
    child = spawn(resolved.binPath, acpSpawnArgs(resolved.binPath, join(probeDir, 'probe.log')), {
      cwd: probeDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const activeChild = child;
    activeChild.on('exit', () => {
      exited = true;
    });

    return await new Promise<AntigravityLocalStatus>((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let version: string | undefined;

      const finish = (loggedIn: boolean): void => {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimeout(timer);
        resolve({
          installed: true,
          loggedIn,
          canLogin: true,
          ...(version !== undefined ? { version } : {}),
          source: resolved.source,
        });
      };

      const resetTimer = (): void => {
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(() => finish(false), STATUS_TIMEOUT_MS);
      };

      activeChild.on('exit', () => finish(false));
      activeChild.on('error', () => finish(false));

      attachNdjsonReader(activeChild, (message) => {
        if (message.id === 1) {
          if (message.error !== undefined) {
            finish(false);
            return;
          }
          const rawVersion = message.result?.agentInfo?.version;
          if (typeof rawVersion === 'string' && rawVersion !== '') version = rawVersion;
          resetTimer();
          sendJsonRpc(activeChild, {
            jsonrpc: '2.0',
            id: 2,
            method: 'session/new',
            params: { cwd: probeDir, mcpServers: [] },
          });
        } else if (message.id === 2) {
          finish(message.error === undefined);
        }
      });

      resetTimer();
      sendJsonRpc(activeChild, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: 1,
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
        },
      });
    });
  } catch {
    return { installed: true, loggedIn: false, canLogin: true, source: resolved.source };
  } finally {
    if (child !== null && !exited) child.kill();
    rmSync(probeDir, { recursive: true, force: true });
  }
}

export function antigravityImportKey():
  | { ok: true; key: string }
  | { ok: false; reason: 'no-key' } {
  const home = homedir();
  if (typeof process.env.GEMINI_API_KEY === 'string') {
    const key = antigravityKeyFromText(process.env.GEMINI_API_KEY);
    if (key !== null) return { ok: true, key };
  }
  const files = [
    join(antigravityCliDir(home), 'credentials'),
    join(home, '.gemini', '.env'),
    join(home, '.gemini', 'settings.json'),
  ];
  for (const path of files) {
    try {
      const key = antigravityKeyFromText(readFileSync(path, 'utf8'));
      if (key !== null) return { ok: true, key };
    } catch {}
  }
  return { ok: false, reason: 'no-key' };
}

let flight: { cancel: () => void } | null = null;

export function antigravityCancelLogin(): void {
  flight?.cancel();
}

export function stopAntigravityLogin(): void {
  antigravityCancelLogin();
}

export function antigravityLogin(): Promise<AntigravityLoginOutcome> {
  if (flight !== null) return Promise.resolve({ ok: false, reason: 'busy' });
  const resolved = resolveAntigravityBinary();
  if (resolved === null) return Promise.resolve({ ok: false, reason: 'no-binary' });

  const loginDir = mkdtempSync(join(tmpdir(), 'cairn-agy-login-'));
  let child: ChildProcess;
  try {
    child = spawn(resolved.binPath, acpSpawnArgs(resolved.binPath, join(loginDir, 'login.log')), {
      cwd: loginDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    console.error('Antigravity login failed to spawn:', error);
    rmSync(loginDir, { recursive: true, force: true });
    return Promise.resolve({ ok: false, reason: 'spawn' });
  }

  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-4000);
  });

  return new Promise<AntigravityLoginOutcome>((resolve) => {
    let exited = false;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = (outcome: AntigravityLoginOutcome): void => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      if (flight === token) flight = null;
      if (!exited) child.kill();
      rmSync(loginDir, { recursive: true, force: true });
      resolve(outcome);
    };

    const token = {
      cancel: () => finish({ ok: false, reason: 'cancelled' }),
    };
    flight = token;

    timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), LOGIN_TIMEOUT_MS);

    child.on('exit', () => {
      exited = true;
      console.error(`Antigravity login exited unexpectedly. stderr: ${stderr}`);
      finish({ ok: false, reason: 'exit' });
    });
    child.on('error', (error) => {
      exited = true;
      console.error('Antigravity login process error:', error);
      finish({ ok: false, reason: 'spawn' });
    });

    attachNdjsonReader(child, (message) => {
      if (message.id === 1) {
        if (message.error !== undefined) {
          finish({ ok: false, reason: 'failed' });
          return;
        }
        sendJsonRpc(child, {
          jsonrpc: '2.0',
          id: 2,
          method: 'authenticate',
          params: { methodId: pickAuthMethod(message.result?.authMethods) },
        });
      } else if (message.id === 2) {
        if (message.error === undefined) {
          finish({ ok: true });
        } else {
          console.error(`Antigravity authenticate failed. stderr: ${stderr}`);
          finish({ ok: false, reason: 'failed' });
        }
      }
    });

    sendJsonRpc(child, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: 1, clientCapabilities: {} },
    });
  });
}
