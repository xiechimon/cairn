import { type ChildProcess, spawn } from 'node:child_process';
import { accessSync, constants, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import {
  type DevinLocalStatus,
  type DevinLoginOutcome,
  compareVersions,
  devinCredentialsPath,
  devinKeyFromToml,
} from '@cairn/shared';

const LOGIN_TIMEOUT_MS = 600_000;
const LOGIN_POLL_MS = 500;

function credentialsFile(): { key: string | null; mtimeMs: number } {
  const path = devinCredentialsPath(homedir());
  try {
    return { key: devinKeyFromToml(readFileSync(path, 'utf8')), mtimeMs: statSync(path).mtimeMs };
  } catch {
    return { key: null, mtimeMs: 0 };
  }
}

function managedVersions(): string[] {
  try {
    return readdirSync(`${homedir()}/.cairn/tools/devin/versions`, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function resolveDevinBinary(): string | null {
  for (const version of [...managedVersions()].sort((a, b) => compareVersions(b, a))) {
    const candidate = `${homedir()}/.cairn/tools/devin/versions/${version}/bin/devin`;
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  return null;
}

export function devinLocalStatus(): DevinLocalStatus {
  return { loggedIn: credentialsFile().key !== null, canLogin: resolveDevinBinary() !== null };
}

export function devinImportKey(): { ok: true; key: string } | { ok: false; reason: 'no-key' } {
  const { key } = credentialsFile();
  return key === null ? { ok: false, reason: 'no-key' } : { ok: true, key };
}

let flight: { child: ChildProcess; cancelled: boolean } | null = null;

export function devinCancelLogin(): void {
  if (flight === null) return;
  flight.cancelled = true;
  flight.child.kill();
}

export function stopDevinLogin(): void {
  devinCancelLogin();
}

export function devinLogin(): Promise<DevinLoginOutcome> {
  if (flight !== null) return Promise.resolve({ ok: false, reason: 'busy' });
  const binary = resolveDevinBinary();
  if (binary === null) return Promise.resolve({ ok: false, reason: 'no-binary' });
  const before = credentialsFile().mtimeMs;
  let child: ChildProcess;
  try {
    child = spawn(binary, ['acp'], { stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (error) {
    console.error('Devin login failed to spawn:', error);
    return Promise.resolve({ ok: false, reason: 'spawn' });
  }
  const current = { child, cancelled: false };
  flight = current;
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-4000);
  });
  return new Promise<DevinLoginOutcome>((resolve) => {
    const deadline = Date.now() + LOGIN_TIMEOUT_MS;
    let exited = false;
    let authenticated = false;
    let authFailed = false;
    child.on('exit', () => {
      exited = true;
    });
    child.on('error', (error) => {
      exited = true;
      console.error('Devin login process error:', error);
    });
    const finish = (outcome: DevinLoginOutcome): void => {
      if (flight !== current) return;
      flight = null;
      if (!exited) child.kill();
      resolve(outcome);
    };
    const send = (message: Record<string, unknown>): void => {
      try {
        child.stdin?.write(`${JSON.stringify(message)}\n`);
      } catch {}
    };
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: 1, clientCapabilities: {} },
    });
    let buffer = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        if (flight !== current || line.trim() === '') continue;
        let message: {
          id?: unknown;
          result?: { authMethods?: { id?: unknown }[] };
          error?: unknown;
        };
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.id === 1) {
          if (message.error !== undefined) {
            authFailed = true;
            continue;
          }
          const methodId = message.result?.authMethods?.[0]?.id;
          send({
            jsonrpc: '2.0',
            id: 2,
            method: 'authenticate',
            params: { methodId: typeof methodId === 'string' ? methodId : 'devin-browser' },
          });
        } else if (message.id === 2) {
          if (message.error === undefined) {
            authenticated = true;
          } else {
            authFailed = true;
          }
        }
      }
    });
    const tick = (): void => {
      if (flight !== current) return;
      const file = credentialsFile();
      if (file.key !== null && (file.mtimeMs > before || authenticated)) {
        finish({ ok: true, key: file.key });
        return;
      }
      if (current.cancelled) {
        finish({ ok: false, reason: 'cancelled' });
        return;
      }
      if (exited || authFailed) {
        if (file.key !== null) {
          finish({ ok: true, key: file.key });
        } else {
          console.error(`Devin login failed without writing credentials. stderr: ${stderr}`);
          finish({ ok: false, reason: 'exit' });
        }
        return;
      }
      if (Date.now() >= deadline) {
        finish({ ok: false, reason: 'timeout' });
        return;
      }
      setTimeout(tick, LOGIN_POLL_MS);
    };
    setTimeout(tick, LOGIN_POLL_MS);
  });
}
