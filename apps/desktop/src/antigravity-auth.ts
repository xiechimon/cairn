import { type ChildProcess, spawn } from 'node:child_process';
import { accessSync, constants, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type AntigravityLocalStatus,
  type AntigravityLoginOutcome,
  type AntigravityLoginPhase,
  type AntigravityOAuthStepCredential,
  antigravityCliDir,
  antigravityKeyFromText,
  antigravityOAuthStepCredentialSchema,
  compareVersions,
  type DesktopSubscriptionMetadata,
} from '@cairn/shared';
import {
  ANTIGRAVITY_ACP_ARGS,
  ANTIGRAVITY_CLI_MIN_VERSION,
  type AntigravityManagedBin,
  antigravityInstallSupported,
  currentAntigravityManagedInstall,
  ensureAntigravityManagedInstall,
} from '@cairn/shared/antigravity-install';
import { readRegularCredentialFile } from '@cairn/shared/credential-profile';
import { authenticateCredential } from './acp-credential-login.js';

const VALIDATE_TIMEOUT_MS = 30_000;

interface ResolvedBinary {
  binPath: string;
  args: string[];
  source: 'local' | 'managed';
}

interface InitializeMessage {
  id?: unknown;
  result?: {
    protocolVersion?: unknown;
    agentInfo?: { version?: unknown };
    agentCapabilities?: {
      loadSession?: unknown;
      sessionCapabilities?: { resume?: unknown };
    };
  };
  error?: unknown;
}

type AntigravityImportCredential = { token: string; expiresAt?: number };

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
      env: {
        ...process.env,
        HOME: validationDir,
        TMPDIR: validationDir,
        AGY_CLI_DISABLE_AUTO_UPDATE: '1',
      },
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
    let buffer = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      if (settled) return;
      buffer += chunk.toString();
      let newline = buffer.indexOf('\n');
      while (!settled && newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        if (line === '') continue;
        try {
          const message = JSON.parse(line) as InitializeMessage;
          if (message.id !== 1) continue;
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
        } catch {}
      }
    });
    try {
      child.stdin?.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: 1,
            clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
          },
        })}\n`,
      );
    } catch {
      finish(false);
    }
  });
}

export function antigravityLocalStatus(): AntigravityLocalStatus {
  const resolved = resolveAntigravityBinary();
  return {
    installed: resolved !== null,
    loggedIn: readLocalAntigravityCredential() !== null,
    canLogin: resolved !== null || antigravityInstallSupported(process.platform, process.arch),
    ...(resolved !== null ? { source: resolved.source } : {}),
  };
}

function oauthPath(home: string): string {
  return join(home, '.gemini', 'antigravity-acp', 'antigravity-oauth-token');
}

function parseOAuthCredential(text: string | null): AntigravityOAuthStepCredential | null {
  if (text === null) return null;
  try {
    const raw = JSON.parse(text) as { token?: { access_token?: unknown; expiry?: unknown } };
    const expiresAt = typeof raw.token?.expiry === 'string' ? Date.parse(raw.token.expiry) : NaN;
    const parsed = antigravityOAuthStepCredentialSchema.safeParse({
      kind: 'oauth-personal',
      token: raw.token?.access_token,
      expiresAt,
    });
    return parsed.success && expiresAt > Date.now() ? parsed.data : null;
  } catch {
    return null;
  }
}

export function readLocalAntigravityCredential(): AntigravityImportCredential | null {
  const home = homedir();
  const credential = parseOAuthCredential(readRegularCredentialFile(oauthPath(home)));
  if (credential !== null) return { token: credential.token, expiresAt: credential.expiresAt };
  if (typeof process.env.GEMINI_API_KEY === 'string') {
    const token = antigravityKeyFromText(process.env.GEMINI_API_KEY);
    if (token !== null) return { token };
  }
  for (const path of [
    join(antigravityCliDir(home), 'credentials'),
    join(home, '.gemini', '.env'),
    join(home, '.gemini', 'settings.json'),
  ]) {
    try {
      const token = antigravityKeyFromText(readFileSync(path, 'utf8'));
      if (token !== null) return { token };
    } catch {}
  }
  return null;
}

let flight: { cancel: () => void; done: Promise<AntigravityLoginOutcome> } | null = null;

export function antigravityCancelLogin(): void {
  flight?.cancel();
}

export async function stopAntigravityLogin(): Promise<void> {
  const current = flight;
  current?.cancel();
  await current?.done;
}

export function antigravityLogin(
  save: (
    credential: AntigravityOAuthStepCredential,
    signal: AbortSignal,
  ) => Promise<DesktopSubscriptionMetadata>,
  appData: string,
  onPhase?: (phase: AntigravityLoginPhase) => void,
  callerSignal?: AbortSignal,
  workerPath?: string,
): Promise<AntigravityLoginOutcome> {
  if (flight !== null) return Promise.resolve({ ok: false, reason: 'busy' });
  const controller = new AbortController();
  const signal =
    callerSignal === undefined
      ? controller.signal
      : AbortSignal.any([controller.signal, callerSignal]);
  const done = runLogin()
    .catch((): AntigravityLoginOutcome => ({ ok: false, reason: 'failed' }))
    .finally(() => {
      flight = null;
    });
  flight = { cancel: () => controller.abort(), done };
  return done;

  async function runLogin(): Promise<AntigravityLoginOutcome> {
    if (signal.aborted) return { ok: false, reason: 'cancelled' };
    let resolved = resolveAntigravityBinary();
    if (resolved === null) {
      onPhase?.('installing');
      const installed = await ensureAntigravityManagedInstall({
        root: managedToolsRoot(),
        validate: validateCandidate,
        log: (message) => console.error(`Antigravity install: ${message}`),
      });
      if (signal.aborted) return { ok: false, reason: 'cancelled' };
      resolved = resolveAntigravityBinary();
      if (installed === null || resolved === null) return { ok: false, reason: 'no-binary' };
    }
    const target = resolved;
    const auth = await authenticateCredential({
      appData,
      bin: target.binPath,
      args: (home) => acpSpawnArgs(target, join(home, 'login.log')),
      env: (home) => ({
        GEMINI_CLI_HOME: home,
        GEMINI_HOME: join(home, '.gemini'),
        GEMINI_API_KEY: undefined,
        GOOGLE_API_KEY: undefined,
        GOOGLE_APPLICATION_CREDENTIALS: undefined,
        AGY_ACP_FORCE_FILE_STORAGE: '1',
        AGY_CLI_DISABLE_AUTO_UPDATE: '1',
      }),
      credentialPath: oauthPath,
      pickMethod: pickAuthMethod,
      signal,
      onAuthenticating: () => onPhase?.('authenticating'),
      workerPath,
    });
    if (!auth.ok) return auth;
    if (signal.aborted) return { ok: false, reason: 'cancelled' };
    const credential = parseOAuthCredential(auth.text);
    if (credential === null) return { ok: false, reason: 'failed' };
    try {
      return { ok: true, subscription: await save(credential, signal) };
    } catch {
      return { ok: false, reason: signal.aborted ? 'cancelled' : 'save' };
    }
  }
}
