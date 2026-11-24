import { spawn } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
  AntigravityOAuth,
  AntigravitySubscriptionModel,
  AntigravitySubscriptionVerifyResult,
} from '@cairn/shared';
import {
  ANTIGRAVITY_MODEL_NAME_MAX_LENGTH,
  antigravitySubscriptionModelSchema,
  isAntigravityOAuthAccessToken,
  isInternalAntigravityModelId,
  serializeAntigravityOAuthTokenFile,
} from '@cairn/shared';
import {
  ANTIGRAVITY_ACP_ARGS,
  currentAntigravityManagedInstall,
} from '@cairn/shared/antigravity-install';
import { createCredentialProfile } from '@cairn/shared/credential-profile';
import { ACP_PROBE_FORWARDED_ENV, collectLines } from './acp-probe.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_OAUTH_TIMEOUT_MS = 45_000;
const MAX_PROBE_STDERR_BYTES = 8_192;
const MAX_PROBE_STDOUT_BUFFER_BYTES = 1_048_576;
const MAX_PROBED_MODELS = 2000;
const MANAGED_ROOT = join(homedir(), '.cairn', 'tools', 'antigravity');
const DEFAULT_PROFILE_ROOT = join(homedir(), '.cairn', 'server');
export const ANTIGRAVITY_MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const FORWARDED_ENV = [...ACP_PROBE_FORWARDED_ENV, 'SSL_CERT_FILE', 'NODE_EXTRA_CA_CERTS'];
const AUTH_FAILURE =
  /authentication|401|invalid|expired|login|unauthorized|forbidden|auth method|api key/i;

function childEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { HOME: homedir(), AGY_CLI_DISABLE_AUTO_UPDATE: '1' };
  if (process.env.PATH !== undefined) env.PATH = process.env.PATH;
  for (const name of FORWARDED_ENV) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return { ...env, ...overrides };
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
  if (explicit !== undefined && explicit.trim() !== '') {
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

function errorResult(
  code: number | undefined,
  text: string,
  authReason: 'missing_local_login' | 'auth',
): AntigravitySubscriptionVerifyResult {
  return code === -32000 || AUTH_FAILURE.test(text)
    ? { ok: false, reason: authReason }
    : { ok: false, reason: 'failed' };
}

interface AcpSelectItem {
  value?: unknown;
  name?: unknown;
  options?: unknown;
}

interface AcpConfigOption {
  category?: unknown;
  type?: unknown;
  options?: unknown;
}

function extractAcpModels(
  configOptions: unknown,
  secrets: readonly string[],
): AntigravitySubscriptionModel[] {
  if (!Array.isArray(configOptions)) return [];
  const models: AntigravitySubscriptionModel[] = [];
  const seen = new Set<string>();
  const add = (rawId: unknown, rawName: unknown) => {
    if (typeof rawId !== 'string') return;
    const id = rawId.trim();
    if (id === '' || seen.has(id) || isInternalAntigravityModelId(id)) return;
    const name =
      typeof rawName === 'string' && rawName.trim() !== ''
        ? rawName.trim().slice(0, ANTIGRAVITY_MODEL_NAME_MAX_LENGTH)
        : id;
    if (secrets.some((secret) => secret !== '' && (id.includes(secret) || name.includes(secret)))) {
      return;
    }
    const parsed = antigravitySubscriptionModelSchema.safeParse({ id, name });
    if (!parsed.success) return;
    seen.add(parsed.data.id);
    models.push(parsed.data);
  };
  for (const option of configOptions as AcpConfigOption[]) {
    if (
      option?.category !== 'model' ||
      option.type !== 'select' ||
      !Array.isArray(option.options)
    ) {
      continue;
    }
    for (const entry of option.options as AcpSelectItem[]) {
      if (Array.isArray(entry?.options)) {
        for (const nested of entry.options as AcpSelectItem[]) {
          add(nested?.value, nested?.name);
          if (models.length >= MAX_PROBED_MODELS) return models;
        }
      } else {
        add(entry?.value, entry?.name);
        if (models.length >= MAX_PROBED_MODELS) return models;
      }
    }
  }
  return models;
}

interface ProbeOutcome {
  result: AntigravitySubscriptionVerifyResult;
  models: AntigravitySubscriptionModel[];
}

function probe(
  home: string,
  timeoutMs: number,
  envOverrides: NodeJS.ProcessEnv,
  authReason: 'missing_local_login' | 'auth',
  secrets: readonly string[],
  signal?: AbortSignal,
): Promise<ProbeOutcome> {
  if (signal?.aborted)
    return Promise.resolve({ result: { ok: false, reason: 'timeout' }, models: [] });
  return new Promise((resolve) => {
    const bin = resolveAgyBinary();
    const args = [...bin.args, '--log-file', join(home, 'probe.log')];
    let child: ReturnType<typeof spawn> | undefined;
    try {
      child = spawn(bin.command, args, {
        cwd: home,
        env: childEnv(envOverrides),
        stdio: ['pipe', 'pipe', 'pipe'],
        ...(process.platform !== 'win32' ? { detached: true } : {}),
        windowsHide: true,
      });
    } catch {
      resolve({ result: { ok: false, reason: 'unavailable' }, models: [] });
      return;
    }
    if (child?.stdin == null || child.stdout == null || child.stderr == null) {
      resolve({ result: { ok: false, reason: 'unavailable' }, models: [] });
      return;
    }
    const { stdin, stdout, stderr } = child;
    stdin.on('error', () => {});
    let settled = false;
    let closed = false;
    let output = '';
    let buffer = '';
    let updatedModels: AntigravitySubscriptionModel[] = [];
    const killProcessGroup = () => {
      if (process.platform !== 'win32' && typeof child.pid === 'number') {
        try {
          process.kill(-child.pid, 'SIGKILL');
          return;
        } catch {}
      }
      child.kill('SIGKILL');
    };
    const onAbort = () => finish({ result: { ok: false, reason: 'timeout' }, models: [] });
    const finish = (outcome: ProbeOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (closed || typeof child.pid !== 'number') {
        if (!closed) killProcessGroup();
        resolve(outcome);
        return;
      }
      let resolved = false;
      const done = () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(waitTimer);
        resolve(outcome);
      };
      const waitTimer = setTimeout(done, 1_000);
      waitTimer.unref();
      child.once('close', done);
      killProcessGroup();
    };
    const timer = setTimeout(
      () => finish({ result: { ok: false, reason: 'timeout' }, models: [] }),
      timeoutMs,
    );
    signal?.addEventListener('abort', onAbort, { once: true });
    const write = (id: number, method: string, params: unknown) => {
      try {
        stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      } catch {
        finish({ result: { ok: false, reason: 'failed' }, models: [] });
      }
    };
    const onMessage = (line: string) => {
      let message: {
        id?: number;
        method?: string;
        params?: { update?: { sessionUpdate?: string; configOptions?: unknown } };
        result?: { configOptions?: unknown };
        error?: { code?: number; message?: string };
      };
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (
        message.method === 'session/update' &&
        message.params?.update?.sessionUpdate === 'config_option_update'
      ) {
        const models = extractAcpModels(message.params.update.configOptions, secrets);
        if (models.length > 0) updatedModels = models;
        return;
      }
      if (message.id === 1) {
        if (message.error !== undefined) {
          finish({
            result: errorResult(message.error.code, message.error.message ?? '', authReason),
            models: [],
          });
          return;
        }
        write(2, 'session/new', { cwd: home, mcpServers: [] });
        return;
      }
      if (message.id === 2) {
        if (message.error !== undefined) {
          finish({
            result: errorResult(message.error.code, message.error.message ?? '', authReason),
            models: [],
          });
          return;
        }
        const directModels = extractAcpModels(message.result?.configOptions, secrets);
        finish({
          result: { ok: true },
          models: directModels.length > 0 ? directModels : updatedModels,
        });
      }
    };
    child.on('error', (error: NodeJS.ErrnoException) => {
      finish({
        result:
          error.code === 'ENOENT'
            ? { ok: false, reason: 'unavailable' }
            : { ok: false, reason: 'failed' },
        models: [],
      });
    });
    stdout.on('data', (chunk: Buffer) => {
      const next = buffer + chunk.toString('utf8');
      if (next.length > MAX_PROBE_STDOUT_BUFFER_BYTES) {
        finish({ result: { ok: false, reason: 'failed' }, models: [] });
        return;
      }
      const { lines, rest } = collectLines(next);
      buffer = rest;
      for (const line of lines) {
        if (line.trim() !== '') onMessage(line);
      }
    });
    stderr.on('data', (chunk: Buffer) => {
      output = (output + chunk.toString('utf8')).slice(-MAX_PROBE_STDERR_BYTES);
    });
    child.on('close', (code) => {
      closed = true;
      if (settled) return;
      finish({
        result:
          code === 0 ? { ok: false, reason: 'failed' } : errorResult(undefined, output, authReason),
        models: [],
      });
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

export type IsolatedOAuthProbeResult = {
  result: AntigravitySubscriptionVerifyResult;
  accessToken?: string;
  models: AntigravitySubscriptionModel[];
};

async function runIsolatedOAuthFileProbe(
  input: {
    authType: 'oauth-personal' | 'oauth-business';
    tokenFileContent: string;
    secrets: readonly string[];
    readRefreshedAccessToken: boolean;
  },
  options: { timeoutMs?: number; signal?: AbortSignal; dataDir?: string } = {},
): Promise<IsolatedOAuthProbeResult> {
  const profile = createCredentialProfile(options.dataDir ?? DEFAULT_PROFILE_ROOT);
  try {
    const acpDir = join(profile.home, '.gemini', 'antigravity-acp');
    await mkdir(acpDir, { recursive: true, mode: 0o700 });
    const tokenPath = join(acpDir, 'antigravity-oauth-token');
    await writeFile(
      join(acpDir, 'settings.json'),
      `${JSON.stringify({ auth: { type: input.authType } })}\n`,
      { mode: 0o600 },
    );
    await writeFile(tokenPath, input.tokenFileContent, { mode: 0o600 });
    const { result, models } = await probe(
      profile.home,
      options.timeoutMs ?? DEFAULT_OAUTH_TIMEOUT_MS,
      {
        ...profile.env,
        GEMINI_HOME: join(profile.home, '.gemini'),
        GEMINI_CLI_HOME: profile.home,
        TMPDIR: profile.home,
        TMP: profile.home,
        TEMP: profile.home,
        AGY_ACP_FORCE_FILE_STORAGE: '1',
        AGY_CLI_FORCE_FILE_TOKEN_STORAGE: '1',
        SSH_CONNECTION: '127.0.0.1 0 127.0.0.1 0',
      },
      'auth',
      input.secrets,
      options.signal,
    );
    if (!result.ok || !input.readRefreshedAccessToken) return { result, models };
    try {
      const raw = profile.readCredential(tokenPath, true);
      if (raw === null) return { result, models };
      const parsed: unknown = JSON.parse(raw);
      const candidate =
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof (parsed as { token?: { access_token?: unknown } }).token?.access_token === 'string'
          ? (parsed as { token: { access_token: string } }).token.access_token
          : undefined;
      if (candidate !== undefined && isAntigravityOAuthAccessToken(candidate)) {
        return { result, accessToken: candidate, models };
      }
    } catch {
      return { result, models };
    }
    return { result, models };
  } finally {
    profile.cleanup();
  }
}

export async function probeAntigravityOAuth(
  oauth: AntigravityOAuth,
  options: { timeoutMs?: number; signal?: AbortSignal; dataDir?: string } = {},
): Promise<IsolatedOAuthProbeResult> {
  return runIsolatedOAuthFileProbe(
    {
      authType: oauth.authMethod === 'business' ? 'oauth-business' : 'oauth-personal',
      tokenFileContent: serializeAntigravityOAuthTokenFile(oauth),
      secrets: [oauth.refreshToken],
      readRefreshedAccessToken: true,
    },
    options,
  );
}

export async function probeAntigravityOAuthAccessToken(
  input: { token: string; expiresAt: number },
  options: { timeoutMs?: number; signal?: AbortSignal; dataDir?: string } = {},
): Promise<IsolatedOAuthProbeResult> {
  return runIsolatedOAuthFileProbe(
    {
      authType: 'oauth-personal',
      tokenFileContent: `${JSON.stringify({
        token: {
          access_token: input.token,
          token_type: 'Bearer',
          expiry: new Date(input.expiresAt).toISOString(),
        },
        auth_method: 'consumer',
      })}\n`,
      secrets: [input.token],
      readRefreshedAccessToken: false,
    },
    options,
  );
}

export async function refreshAntigravityOAuthAccessToken(
  oauth: AntigravityOAuth,
  options: { timeoutMs?: number; signal?: AbortSignal; dataDir?: string } = {},
): Promise<
  | { status: 'ok'; token: string; models: AntigravitySubscriptionModel[] }
  | { status: 'failed'; failure: 'auth' | 'timeout' | 'upstream' }
> {
  const { result, accessToken, models } = await probeAntigravityOAuth(oauth, options);
  if (result.ok && accessToken !== undefined) return { status: 'ok', token: accessToken, models };
  if (result.reason === 'timeout') return { status: 'failed', failure: 'timeout' };
  if (result.reason === 'auth') return { status: 'failed', failure: 'auth' };
  return { status: 'failed', failure: 'upstream' };
}
