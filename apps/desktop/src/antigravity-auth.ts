import { type ChildProcess, spawn } from 'node:child_process';
import { accessSync, constants, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type AntigravityLocalStatus,
  type AntigravityLoginOutcome,
  type AntigravityLoginPhase,
  antigravityCliDir,
  antigravityKeyFromText,
  compareVersions,
} from '@cairn/shared';
import {
  ANTIGRAVITY_ACP_ARGS,
  ANTIGRAVITY_CLI_MIN_VERSION,
  type AntigravityManagedBin,
  antigravityInstallSupported,
  currentAntigravityManagedInstall,
  ensureAntigravityManagedInstall,
} from '@cairn/shared/antigravity-install';

const STATUS_TIMEOUT_MS = 20_000;
const VALIDATE_TIMEOUT_MS = 30_000;
const LOGIN_TIMEOUT_MS = 600_000;

interface ResolvedBinary {
  binPath: string;
  args: string[];
  source: 'local' | 'managed';
}

interface JsonRpcMessage {
  id?: unknown;
  result?: {
    protocolVersion?: unknown;
    agentInfo?: { version?: unknown };
    agentCapabilities?: {
      loadSession?: unknown;
      sessionCapabilities?: { resume?: unknown };
    };
    authMethods?: { id?: unknown }[];
  };
  error?: unknown;
}

function managedToolsRoot(): string {
  return `${homedir()}/.cairn/tools/antigravity`;
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
  if (explicit !== undefined && explicit !== '' && isExecutableFile(explicit)) {
    return { binPath: explicit, args: [...ANTIGRAVITY_ACP_ARGS], source: 'managed' };
  }
  const managed = currentAntigravityManagedInstall(managedToolsRoot());
  if (managed !== null && isExecutableFile(managed.binPath)) {
    return { binPath: managed.binPath, args: managed.args, source: 'managed' };
  }
  return null;
}

function acpSpawnArgs(resolved: ResolvedBinary, logFile: string): string[] {
  return [...resolved.args, '--log-file', logFile];
}

function acpSpawnEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { ...process.env, ...extra, AGY_CLI_DISABLE_AUTO_UPDATE: '1' };
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

function validateCandidate(candidate: AntigravityManagedBin): Promise<boolean> {
  const validationDir = mkdtempSync(join(tmpdir(), 'cairn-agy-validate-'));
  let child: ChildProcess;
  try {
    child = spawn(candidate.binPath, candidate.args, {
      cwd: validationDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: acpSpawnEnv({ HOME: validationDir, TMPDIR: validationDir }),
    });
  } catch {
    rmSync(validationDir, { recursive: true, force: true });
    return Promise.resolve(false);
  }
  return new Promise<boolean>((resolve) => {
    let settled = false;
    let exited = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!exited) child.kill();
      rmSync(validationDir, { recursive: true, force: true });
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), VALIDATE_TIMEOUT_MS);
    child.on('exit', () => {
      exited = true;
      finish(false);
    });
    child.on('error', () => {
      exited = true;
      finish(false);
    });
    child.stdin?.on('error', () => finish(false));
    attachNdjsonReader(child, (message) => {
      if (message.id !== 1) return;
      if (message.error !== undefined || message.result?.protocolVersion !== 1) {
        finish(false);
        return;
      }
      const version = message.result.agentInfo?.version;
      const versionOk =
        typeof version === 'string' &&
        compareVersions(version, ANTIGRAVITY_CLI_MIN_VERSION) >= 0 &&
        (version === candidate.version ||
          version.startsWith(`${candidate.version}-`) ||
          version.startsWith(`${candidate.version}+`));
      const caps = message.result.agentCapabilities;
      const resumeOk =
        caps?.loadSession === true || caps?.sessionCapabilities?.resume !== undefined;
      finish(versionOk && resumeOk);
    });
    sendJsonRpc(child, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
      },
    });
  });
}

export async function antigravityLocalStatus(): Promise<AntigravityLocalStatus> {
  const resolved = resolveAntigravityBinary();
  if (resolved === null) {
    return {
      installed: false,
      loggedIn: false,
      canLogin: antigravityInstallSupported(process.platform, process.arch),
    };
  }
  const probeDir = mkdtempSync(join(tmpdir(), 'cairn-agy-status-'));
  let child: ChildProcess | null = null;
  let exited = false;

  try {
    child = spawn(resolved.binPath, acpSpawnArgs(resolved, join(probeDir, 'probe.log')), {
      cwd: probeDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: acpSpawnEnv(),
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
      activeChild.stdin?.on('error', () => finish(false));

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

export function antigravityLogin(
  onPhase?: (phase: AntigravityLoginPhase) => void,
): Promise<AntigravityLoginOutcome> {
  if (flight !== null) return Promise.resolve({ ok: false, reason: 'busy' });

  let cancelled = false;
  let cancelChild: (() => void) | null = null;
  const token = {
    cancel: (): void => {
      cancelled = true;
      cancelChild?.();
    },
  };
  flight = token;

  return runLogin().finally(() => {
    if (flight === token) flight = null;
  });

  async function runLogin(): Promise<AntigravityLoginOutcome> {
    let resolved = resolveAntigravityBinary();
    if (resolved === null) {
      onPhase?.('installing');
      const installed = await ensureAntigravityManagedInstall({
        root: managedToolsRoot(),
        validate: validateCandidate,
        log: (message) => console.error(`Antigravity install: ${message}`),
      });
      resolved = resolveAntigravityBinary();
      if (installed === null || resolved === null) return { ok: false, reason: 'no-binary' };
    }
    if (cancelled) return { ok: false, reason: 'cancelled' };

    const loginDir = mkdtempSync(join(tmpdir(), 'cairn-agy-login-'));
    let child: ChildProcess;
    try {
      child = spawn(resolved.binPath, acpSpawnArgs(resolved, join(loginDir, 'login.log')), {
        cwd: loginDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: acpSpawnEnv(),
      });
    } catch (error) {
      console.error('Antigravity login failed to spawn:', error);
      rmSync(loginDir, { recursive: true, force: true });
      return { ok: false, reason: 'spawn' };
    }

    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });

    return await new Promise<AntigravityLoginOutcome>((resolve) => {
      let exited = false;
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const finish = (outcome: AntigravityLoginOutcome): void => {
        if (settled) return;
        settled = true;
        cancelChild = null;
        if (timer !== null) clearTimeout(timer);
        if (!exited) child.kill();
        rmSync(loginDir, { recursive: true, force: true });
        resolve(outcome);
      };

      cancelChild = () => finish({ ok: false, reason: 'cancelled' });
      if (cancelled) {
        finish({ ok: false, reason: 'cancelled' });
        return;
      }

      timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), LOGIN_TIMEOUT_MS);

      child.stdin?.on('error', () => finish({ ok: false, reason: 'exit' }));
      child.on('exit', () => {
        exited = true;
        if (settled) return;
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
          onPhase?.('authenticating');
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
}
